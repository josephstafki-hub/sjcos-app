"use client";

// The browser phone: lets a click-to-call use this tab as the caller's leg
// instead of their cell. Mounted once in the (os) layout, so a call survives
// moving between pages.
//
// How a call runs: log this tab in to Telnyx (short-lived token for the
// user's own credential, lib/voice-browser.ts), then place the call with
// via "browser". The OS dials this tab FIRST (same flow as a cell, see
// lib/comms/voice-flow.ts); we answer that one expected call automatically,
// then hear ringback while the OS dials the client and bridges. Recording,
// transcript and notes are unchanged. Anything else that rings this tab is
// declined.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Grid3x3, Mic, MicOff, PhoneOff, Phone, X } from "lucide-react";
import type { Call, INotification, TelnyxRTC } from "@telnyx/webrtc";
import { browserPhoneTokenAction, loadCall, placeCallAction } from "@/lib/actions/calls";

export type CallVia = "browser" | "cell";
type Phase = "idle" | "connecting" | "live" | "ended";

export interface StartCallResult {
  ok: boolean;
  callId?: string;
  error?: string;
  via: CallVia;
}

interface BrowserPhoneApi {
  /** Browser calling is set up on the server and this browser can do it. */
  available: boolean;
  via: CallVia;
  setVia: (v: CallVia) => void;
  /** A browser call is in progress. */
  busy: boolean;
  /** Place a call the way the user picked (browser or cell). */
  startCall: (phone: string, contactName?: string | null) => Promise<StartCallResult>;
}

const Ctx = createContext<BrowserPhoneApi | null>(null);
const VIA_KEY = "sjcos.callVia";
const ANSWER_WINDOW_MS = 45_000;

/** Null outside the provider (portal pages, users without the comms area). */
export function useBrowserPhone(): BrowserPhoneApi | null {
  return useContext(Ctx);
}

/** Calls through the browser phone when mounted; otherwise rings the cell. */
export function useStartCall(): (phone: string, contactName?: string | null) => Promise<StartCallResult> {
  const phone = useBrowserPhone();
  return useCallback(
    async (p: string, name?: string | null) => {
      if (phone) return phone.startCall(p, name);
      const r = await placeCallAction(p, name, "cell");
      return { ...r, via: "cell" as const };
    },
    [phone],
  );
}

function readVia(): CallVia | null {
  try {
    const v = window.localStorage.getItem(VIA_KEY);
    return v === "browser" || v === "cell" ? v : null;
  } catch {
    return null;
  }
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function headerOf(call: Call, name: string): string | null {
  const list = (call.options as { customHeaders?: { name: string; value: string }[] }).customHeaders ?? [];
  const hit = list.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? null;
}

export function BrowserPhoneProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [via, setViaState] = useState<CallVia>("browser");
  const [phase, setPhase] = useState<Phase>("idle");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("");
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [muted, setMuted] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [bridgedAt, setBridgedAt] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<TelnyxRTC | null>(null);
  const readyRef = useRef<Promise<TelnyxRTC> | null>(null);
  const callRef = useRef<Call | null>(null);
  const expectRef = useRef<{ callId: string | null; until: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browser capability + the remembered choice; read after mount (no SSR access).
  useEffect(() => {
    const ok = typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof RTCPeerConnection !== "undefined";
    const saved = readVia();
    queueMicrotask(() => {
      setSupported(ok);
      if (saved) setViaState(saved);
    });
  }, []);

  const available = enabled && supported;
  const effectiveVia: CallVia = available ? via : "cell";

  const setVia = useCallback((v: CallVia) => {
    setViaState(v);
    try {
      window.localStorage.setItem(VIA_KEY, v);
    } catch {
      /* private window: choice lasts for this page only */
    }
  }, []);

  const teardown = useCallback((message?: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    expectRef.current = null;
    callRef.current = null;
    setMuted(false);
    setKeypad(false);
    setLiveAt(null);
    setBridgedAt(null);
    setCallId(null);
    if (message) setError(message);
    setPhase("ended");
    // Log the tab out between calls: nothing should be able to ring it idle.
    const client = clientRef.current;
    clientRef.current = null;
    readyRef.current = null;
    if (client) void client.disconnect().catch(() => {});
    setTimeout(() => setPhase((p) => (p === "ended" ? "idle" : p)), message ? 6000 : 1500);
  }, []);

  const onNotification = useCallback(
    (n: INotification) => {
      if (n.type !== "callUpdate" || !n.call) return;
      const call = n.call;
      const mine = callRef.current && callRef.current.id === call.id;
      if (!mine) {
        if (call.state !== "ringing" || call.direction !== "inbound") return;
        const expect = expectRef.current;
        const tag = headerOf(call, "X-SJC-Call");
        const wanted = expect && Date.now() < expect.until && (!tag || !expect.callId || tag === expect.callId);
        if (!wanted) {
          void call.hangup().catch(() => {});
          return;
        }
        callRef.current = call;
        expectRef.current = null;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setStatus("Dialing…");
        void call.answer({ audio: true, video: false }).catch((e: unknown) => teardown(`Could not answer in the browser: ${(e as Error)?.message ?? e}`));
        return;
      }
      if (call.state === "active") {
        setPhase("live");
        setStatus("");
        setLiveAt((t) => t ?? Date.now());
      } else if (call.state === "hangup" || call.state === "destroy" || call.state === "purge") {
        if (callRef.current) teardown();
      }
    },
    [teardown],
  );

  const login = useCallback(async (): Promise<TelnyxRTC> => {
    if (clientRef.current && readyRef.current) return readyRef.current;
    const ready = (async () => {
      const tok = await browserPhoneTokenAction();
      if (!tok.ok || !tok.token) throw new Error(tok.error ?? "Could not start the browser phone.");
      const { TelnyxRTC: Client } = await import("@telnyx/webrtc");
      const client = new Client({ login_token: tok.token, hangupOnBeforeUnload: true });
      clientRef.current = client;
      if (audioRef.current) client.remoteElement = audioRef.current;
      client.on("telnyx.notification", onNotification);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("The browser phone did not connect to Telnyx in time.")), 12_000);
        client.on("telnyx.ready", () => {
          clearTimeout(t);
          resolve();
        });
        client.on("telnyx.error", (e: unknown) => {
          clearTimeout(t);
          reject(new Error((e as { error?: { message?: string } })?.error?.message ?? "Telnyx refused the browser phone login."));
        });
        void client.connect().catch((e: unknown) => {
          clearTimeout(t);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      return client;
    })();
    readyRef.current = ready;
    try {
      return await ready;
    } catch (e) {
      const c = clientRef.current;
      clientRef.current = null;
      readyRef.current = null;
      if (c) void c.disconnect().catch(() => {});
      throw e;
    }
  }, [onNotification]);

  const startCall = useCallback(
    async (phone: string, contactName?: string | null): Promise<StartCallResult> => {
      if (effectiveVia === "cell") {
        const r = await placeCallAction(phone, contactName, "cell");
        return { ...r, via: "cell" };
      }
      if (phase === "connecting" || phase === "live") return { ok: false, error: "You are already on a call in this browser.", via: "browser" };
      setError(null);
      setLabel(contactName?.trim() || phone);
      setStatus("Getting the microphone…");
      setPhase("connecting");
      try {
        // Ask for the mic up front so the permission prompt comes while the
        // user is looking, not mid-ring.
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        teardown("The browser has no microphone access. Allow it for this site, or switch to ringing your cell.");
        return { ok: false, error: "Microphone access was blocked.", via: "browser" };
      }
      try {
        setStatus("Connecting…");
        await login();
      } catch (e) {
        const msg = (e as Error).message;
        teardown(msg);
        return { ok: false, error: msg, via: "browser" };
      }
      expectRef.current = { callId: null, until: Date.now() + ANSWER_WINDOW_MS };
      let r: Awaited<ReturnType<typeof placeCallAction>>;
      try {
        r = await placeCallAction(phone, contactName, "browser");
      } catch (e) {
        teardown("Could not place the call.");
        throw e;
      }
      if (!r.ok) {
        teardown(r.error ?? "Could not place the call.");
        return { ok: false, error: r.error, via: "browser" };
      }
      if (expectRef.current) expectRef.current.callId = r.callId ?? null;
      setCallId(r.callId ?? null);
      timeoutRef.current = setTimeout(() => {
        if (!callRef.current) teardown("The call never reached this browser. Try again, or switch to ringing your cell.");
      }, ANSWER_WINDOW_MS);
      return { ok: true, callId: r.callId, via: "browser" };
    },
    [effectiveVia, phase, login, teardown],
  );

  // Clock for the live bar.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Our leg is up while the OS is still ringing the client: watch the call
  // row until it bridges so the bar says "Ringing…" vs "On the line".
  useEffect(() => {
    if (phase !== "live" || bridgedAt || !callId) return;
    let stop = false;
    const tick = async () => {
      const d = await loadCall(callId).catch(() => null);
      if (stop || !d) return;
      if (d.call.bridged) setBridgedAt(Date.now());
      else if (d.call.status === "no_answer") setStatus("No answer");
    };
    const t = setInterval(tick, 2000);
    void tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [phase, bridgedAt, callId]);

  // Leaving the app ends the call cleanly (the SDK also hangs up on unload).
  useEffect(() => () => {
    const c = clientRef.current;
    if (c) void c.disconnect().catch(() => {});
  }, []);

  function hangup() {
    const call = callRef.current;
    if (call) void call.hangup().catch(() => {});
    teardown();
  }

  function toggleMute() {
    const call = callRef.current;
    if (!call) return;
    call.toggleAudioMute();
    setMuted((m) => !m);
  }

  function press(d: string) {
    callRef.current?.dtmf(d);
  }

  const api = useMemo<BrowserPhoneApi>(
    () => ({ available, via: effectiveVia, setVia, busy: phase === "connecting" || phase === "live", startCall }),
    [available, effectiveVia, setVia, phase, startCall],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Remote audio for the browser phone. Must stay mounted for the whole session. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      {phase !== "idle" && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-md flex-col gap-2 rounded-lg border border-rule bg-card p-3 shadow-card sm:inset-x-auto sm:right-4 sm:w-[360px]"
        >
          <div className="flex items-center gap-3">
            <span className={`flex size-8 flex-none items-center justify-center rounded-full ${phase === "live" ? "bg-ok-soft text-ok" : phase === "ended" ? "bg-paper-2 text-ink-3" : "bg-accent-soft text-accent"}`}>
              <Phone className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-semibold text-ink">{label}</div>
              <div className="truncate text-meta text-ink-3">
                {phase === "live"
                  ? bridgedAt
                    ? `On the line · ${fmtClock((now || Date.now()) - bridgedAt)}`
                    : `${status || "Ringing…"} · ${fmtClock((now || Date.now()) - (liveAt ?? Date.now()))}`
                  : phase === "ended" ? (error ? "Call failed" : "Call ended") : status || "Connecting…"}
              </div>
            </div>
            {(phase === "connecting" || phase === "live") && (
              <>
                <button
                  type="button"
                  onClick={() => setKeypad((k) => !k)}
                  disabled={phase !== "live"}
                  aria-pressed={keypad}
                  aria-label="Keypad"
                  title="Keypad"
                  className={`flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40 ${keypad ? "bg-paper-2" : ""}`}
                >
                  <Grid3x3 className="size-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  disabled={phase !== "live"}
                  aria-pressed={muted}
                  aria-label={muted ? "Unmute" : "Mute"}
                  title={muted ? "Unmute" : "Mute"}
                  className={`flex size-9 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 ${muted ? "bg-flag-soft text-flag" : "text-ink-2"}`}
                >
                  {muted ? <MicOff className="size-4" strokeWidth={1.75} /> : <Mic className="size-4" strokeWidth={1.75} />}
                </button>
                <button
                  type="button"
                  onClick={hangup}
                  aria-label="Hang up"
                  title="Hang up"
                  className="flex size-9 items-center justify-center rounded-md bg-flag text-paper hover:opacity-90"
                >
                  <PhoneOff className="size-4" strokeWidth={1.75} />
                </button>
              </>
            )}
            {phase === "ended" && (
              <button type="button" onClick={() => setPhase("idle")} aria-label="Close" title="Close" className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover">
                <X className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
          {phase === "ended" && error && <p className="text-meta text-flag">{error}</p>}
          {keypad && phase === "live" && (
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                <button key={d} type="button" onClick={() => press(d)} className="h-10 rounded-md border border-rule bg-paper text-subheading font-semibold text-ink hover:bg-paper-2">
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** "Ring: This browser | My cell" switch for the Call buttons. Renders nothing
 *  when browser calling isn't available. */
export function CallViaSwitch({ className = "" }: { className?: string }) {
  const phone = useBrowserPhone();
  if (!phone?.available) return null;
  const opt = (v: CallVia, text: string) => (
    <button
      type="button"
      aria-pressed={phone.via === v}
      onClick={() => phone.setVia(v)}
      className={`inline-flex h-7 items-center rounded-[5px] px-2.5 text-label font-medium transition-colors hover:text-ink ${phone.via === v ? "bg-card text-ink shadow-card" : "text-ink-3"}`}
    >
      {text}
    </button>
  );
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-meta text-ink-3">Ring</span>
      <div role="group" aria-label="Where the call rings" className="inline-flex h-8 items-center gap-0.5 rounded-md bg-paper-2 p-0.5">
        {opt("browser", "This browser")}
        {opt("cell", "My cell")}
      </div>
    </div>
  );
}
