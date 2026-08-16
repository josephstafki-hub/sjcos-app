"use client";

import { useEffect, useRef, useState } from "react";
import { useDictation } from "@/lib/use-dictation";
import { useVoiceAvailable } from "@/lib/use-voice-available";
import { useTtsAvailable } from "@/lib/use-tts-available";

// Hands-free voice conversation for the operator panel. One tap starts a
// round; from then on it's continuous: voice-activity detection ends each
// utterance on silence and sends it (no send tap), the reply speaks, the mic
// re-arms. Claude is the one voice: the surface calls speak(text) with the
// concierge's immediate answer and, when a delegated run lands,
// speakRun(runId) — the server condenses that run's outcome into a spoken
// update (POST /api/tts {runId}). Plain fetch + one shared Audio element per
// the house rule (no SSE, no streaming). Mic tap while speaking is barge-in;
// Escape (desktop) aborts; the exit chip tears everything down.
//
// Phone realities handled here: iOS only lets an audio element play after a
// user gesture, so the very first tap "unlocks" the shared element with a
// silent clip and every later play() reuses it; a screen wake lock keeps the
// phone from sleeping mid-conversation.

export type VoiceRoundPhase = "idle" | "recording" | "transcribing" | "waiting" | "speaking";

// Matches the server-side guard in lib/tts.ts.
const SPEECH_MAX = 2000;

// A sliver of silence as a WAV data URI — enough to unlock audio on iOS.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/** Reduce markdown to speakable prose (fallback when the server hasn't
 *  produced a spoken form): drop code/tables, unwrap links/emphasis/list
 *  markers, collapse whitespace, cap at the TTS limit. */
export function stripForSpeech(text: string): string {
  const out = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > SPEECH_MAX ? out.slice(0, SPEECH_MAX) : out;
}

export function useVoiceRound({
  send,
  onError,
}: {
  /** Deliver a transcript to the chat (voice path). */
  send: (text: string) => Promise<void> | void;
  onError?: (message: string) => void;
}) {
  const stt = useVoiceAvailable();
  const tts = useTtsAvailable();
  const supported = stt === true && tts === true;

  const [voiceMode, setVoiceModeState] = useState(false);
  const [stage, setStage] = useState<"idle" | "waiting" | "speaking">("idle");
  const [level, setLevel] = useState(0);

  const voiceModeRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  /** Resolver of the clip currently playing — an interrupt (barge-in, exit)
   *  must settle it or the utterance queue stalls behind it forever. */
  const playingRef = useRef<(() => void) | null>(null);
  /** Set when a tap cut playback and started listening itself, so the queue
   *  tail doesn't re-arm the mic a second time (two recorders = a leak). */
  const bargedRef = useRef(false);
  /** Live mirror of dictation.state for closures that outlive a render. */
  const dictStateRef = useRef<"idle" | "recording" | "transcribing">("idle");
  /** Background survival: a silent loop that keeps iOS treating the page as
   *  an audio app while hidden (timers/polling keep running, the speech
   *  element stays usable), plus clips iOS refused to play while hidden —
   *  spoken the moment the page is visible again. */
  const keepAliveRef = useRef<HTMLAudioElement | null>(null);
  const deferredRef = useRef<Blob[]>([]);
  const queueDepthRef = useRef(0);
  const spokenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const sendRef = useRef(send);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    sendRef.current = send;
    onErrorRef.current = onError;
  });

  const dictation = useDictation({
    onText: (text) => void handleTranscript(text),
    onError: (message) => onErrorRef.current?.(message),
    onLevel: setLevel,
  });

  useEffect(() => {
    dictStateRef.current = dictation.state;
  });

  // While the dictation machine is active it owns the phase.
  const phase: VoiceRoundPhase = dictation.state === "idle" ? stage : dictation.state;

  async function handleTranscript(text: string) {
    setStage("waiting");
    try {
      await sendRef.current(text);
    } catch {
      setStage("idle");
      onErrorRef.current?.("Couldn't send the message.");
    }
  }

  // ─── audio ────────────────────────────────────────────────────────────────

  function audio(): HTMLAudioElement {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.setAttribute("playsinline", "true");
    }
    return audioRef.current;
  }

  /** Called inside the user's tap: play a silent clip so iOS lets later,
   *  async play() calls through on the same element. */
  function unlockAudio() {
    try {
      const a = audio();
      a.src = SILENT_WAV;
      void a.play().catch(() => {});
    } catch {
      /* not fatal */
    }
  }

  function clearAudio() {
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute("src");
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    const r = playingRef.current;
    playingRef.current = null;
    r?.();
  }

  /** Play one clip; resolves when it ends (or fails). */
  function play(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      clearAudio();
      const a = audio();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      a.src = url;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      playingRef.current = done;
      a.onended = () => clearAudio();
      a.onerror = () => {
        onErrorRef.current?.("Couldn't play the answer.");
        clearAudio();
      };
      setStage("speaking");
      a.play().catch(() => {
        if (typeof document !== "undefined" && document.hidden) {
          // iOS refuses to start new audio while backgrounded — keep the clip
          // and speak it when Joe comes back (see the visibility handler).
          deferredRef.current.push(blob);
        } else {
          onErrorRef.current?.("Couldn't play the answer.");
        }
        clearAudio();
      });
    });
  }

  /** Utterances queue: an ack and a follow-up update never talk over each
   *  other. After the LAST queued clip, re-arm the mic if voice mode is on. */
  function enqueue(fetchClip: () => Promise<Blob | null>) {
    queueDepthRef.current += 1;
    queueRef.current = queueRef.current
      .then(async () => {
        if (!voiceModeRef.current) return;
        const blob = await fetchClip();
        if (!blob || !voiceModeRef.current) return;
        await play(blob);
      })
      .catch(() => {})
      .then(() => {
        queueDepthRef.current = Math.max(0, queueDepthRef.current - 1);
        if (!voiceModeRef.current) return;
        if (bargedRef.current) {
          bargedRef.current = false; // the tap already started listening
          return;
        }
        setStage("idle");
        // Backgrounded: iOS mutes the mic, so listening is pointless — the
        // visibility handler re-arms on return.
        if (typeof document !== "undefined" && document.hidden) return;
        // The concierge may still be waiting on a delegated run; re-arm so Joe
        // can keep talking meanwhile — the update queues behind whatever he
        // says next rather than talking over him.
        if (dictStateRef.current === "idle") void dictation.start({ noSpeechMs: 8_000 });
      });
  }

  // ─── background survival ──────────────────────────────────────────────────

  /** While hidden: loop a silent clip so iOS keeps treating the page as an
   *  audio app (timers/polling keep running; the unlocked speech element can
   *  keep talking) and register with the lock-screen media controls. */
  function startKeepAlive() {
    try {
      if (!keepAliveRef.current) {
        const k = new Audio("/silence-1s.wav");
        k.loop = true;
        k.volume = 0.01;
        k.setAttribute("playsinline", "true");
        keepAliveRef.current = k;
      }
      void keepAliveRef.current.play().catch(() => {});
      const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
      if (ms) {
        ms.metadata = new MediaMetadata({ title: "SJC OS · Operator", artist: "Voice session — Claude" });
        // Lock-screen pause = end the voice session; play = no-op (the mic
        // cannot run from the lock screen anyway).
        try {
          ms.setActionHandler("pause", () => setVoiceMode(false));
          ms.setActionHandler("play", () => {});
        } catch {
          /* handler unsupported */
        }
      }
    } catch {
      /* no Audio / no MediaSession — survival degrades to resume-on-return */
    }
  }

  function stopKeepAlive() {
    const k = keepAliveRef.current;
    if (k) {
      k.pause();
      k.currentTime = 0;
    }
  }

  async function ttsBlob(body: Record<string, string>): Promise<Blob | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onErrorRef.current?.(data.error || "Couldn't speak the answer.");
        return null;
      }
      return await res.blob();
    } catch {
      onErrorRef.current?.("Couldn't speak the answer.");
      return null;
    }
  }

  // ─── public controls ──────────────────────────────────────────────────────

  /** Mic tap: idle → start a round (turning voice mode on), recording → stop &
   *  send now, speaking → barge-in (cut playback, start recording). Ignored
   *  mid-transcribe. */
  function micTap() {
    if (!supported) return;
    if (dictStateRef.current === "recording") {
      dictation.stop();
      return;
    }
    if (dictStateRef.current === "transcribing") return;
    if (!voiceModeRef.current) {
      unlockAudio();
      void requestWakeLock();
    }
    if (stage === "speaking") {
      bargedRef.current = true; // this tap owns the next listen
      clearAudio();
    }
    voiceModeRef.current = true;
    setVoiceModeState(true);
    setStage("idle");
    void dictation.start({ noSpeechMs: 12_000 });
  }

  /** Start a voice session by SPEAKING first (e.g. a briefing of the queue),
   *  then listening — the utterance queue re-arms the mic when the clip ends.
   *  A mic tap during the briefing barges in and listens right away. If there's
   *  nothing to say, it's just micTap(). Already-in-session taps: micTap(). */
  function startWithBriefing(text: string) {
    if (!supported) return;
    if (voiceModeRef.current) {
      micTap();
      return;
    }
    const clean = stripForSpeech(text);
    if (!clean) {
      micTap();
      return;
    }
    unlockAudio();
    void requestWakeLock();
    voiceModeRef.current = true;
    setVoiceModeState(true);
    setStage("waiting");
    enqueue(() => ttsBlob({ text: clean }));
  }

  function stopSpeaking() {
    clearAudio();
    setStage((s) => (s === "speaking" ? "idle" : s));
  }

  /** Turning voice mode off tears the whole round down: playback, recording,
   *  queued clips, wake lock. */
  function setVoiceMode(on: boolean) {
    voiceModeRef.current = on;
    setVoiceModeState(on);
    if (on) {
      unlockAudio();
      void requestWakeLock();
      return;
    }
    dictation.cancel();
    clearAudio();
    stopKeepAlive();
    deferredRef.current = [];
    setStage("idle");
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }

  /** Speak text right now (the concierge's immediate answer). Once per id. */
  function speak(id: string, text: string) {
    if (!voiceModeRef.current || spokenRef.current.has(id)) return;
    spokenRef.current.add(id);
    const clean = stripForSpeech(text);
    if (!clean) return;
    enqueue(() => ttsBlob({ text: clean }));
  }

  /** Speak a finished run's outcome — the server condenses it (Claude) into a
   *  spoken update and caches it on the run. Once per run. */
  function speakRun(runId: string) {
    if (!voiceModeRef.current || spokenRef.current.has(runId)) return;
    spokenRef.current.add(runId);
    enqueue(() => ttsBlob({ runId }));
  }

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock && !wakeRef.current) wakeRef.current = await nav.wakeLock.request("screen");
    } catch {
      /* unsupported / denied — fine */
    }
  }

  // Escape aborts the round: stops playback and discards any recording. Wired
  // through refs (assigned in an effect, per react-hooks/refs) so the listener
  // registers once and never sees stale state.
  const phaseRef = useRef(phase);
  const haltRef = useRef(() => {});
  useEffect(() => {
    phaseRef.current = phase;
    haltRef.current = () => {
      clearAudio();
      dictation.cancel();
      setStage("idle");
    };
  });

  // Background / foreground. The session is NOT torn down when the page is
  // hidden (app switch, screen lock): a delegated run keeps going and its
  // spoken update is delivered — live if iOS lets the unlocked audio element
  // play, otherwise the moment the page is visible again. What cannot survive
  // backgrounding on iOS is the microphone (muted while hidden), so listening
  // resumes on return rather than in the background. Wired through a ref so
  // the one listener always sees fresh closures.
  const resumeRef = useRef(() => {});
  useEffect(() => {
    resumeRef.current = () => {
      stopKeepAlive();
      void requestWakeLock();
      const parked = deferredRef.current;
      deferredRef.current = [];
      for (const blob of parked) enqueue(async () => blob);
      // Nothing queued and nothing recording → straight back to listening.
      if (!parked.length && queueDepthRef.current === 0 && dictStateRef.current === "idle") {
        setStage("idle");
        void dictation.start({ noSpeechMs: 8_000 });
      }
    };
  });
  useEffect(() => {
    function onVisibility() {
      if (!voiceModeRef.current) return;
      if (document.hidden) startKeepAlive();
      else resumeRef.current();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const p = phaseRef.current;
      if (p === "speaking" || p === "recording") haltRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      haltRef.current(); // unmount teardown
      stopKeepAlive();
      void wakeRef.current?.release().catch(() => {});
    };
  }, []);

  return { phase, level, voiceMode, setVoiceMode, micTap, startWithBriefing, stopSpeaking, speak, speakRun, supported };
}
