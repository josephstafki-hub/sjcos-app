"use client";

import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useVoiceAvailable } from "@/lib/use-voice-available";

// Records a short voice memo via MediaRecorder and posts it to /api/transcribe
// (local whisper.cpp). Calls onText with the transcript. Self-gates on server
// availability (useVoiceAvailable → GET /api/transcribe), so it's drop-in on any
// composer without threading whisperAvailable() down as a prop — it simply
// renders nothing when voice isn't set up. `compact` renders an icon-only button
// sized to sit inside a chat composer next to the send/attach controls.

type Phase = "idle" | "recording" | "transcribing";

export function VoiceButton({
  onText,
  compact = false,
}: {
  onText: (text: string) => void;
  compact?: boolean;
}) {
  const available = useVoiceAvailable();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await transcribe(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setPhase("recording");
    } catch {
      setError("Mic access denied.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setPhase("transcribing");
  }

  async function transcribe(blob: Blob) {
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: blob });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.text) {
        onText(data.text as string);
      } else {
        setError(data.error || "Couldn't transcribe.");
      }
    } catch {
      setError("Transcription failed.");
    } finally {
      setPhase("idle");
    }
  }

  // Self-gate: render nothing until the probe confirms voice is set up.
  if (available !== true) return null;

  const busy = phase === "transcribing";
  const recording = phase === "recording";
  const iconSize = compact ? "size-3.5" : "size-3";
  const icon = busy ? (
    <Loader2 className={`${iconSize} animate-spin`} strokeWidth={1.75} />
  ) : recording ? (
    <Square className={`${iconSize} fill-flag`} strokeWidth={1.75} />
  ) : (
    <Mic className={iconSize} strokeWidth={1.75} />
  );

  if (compact) {
    // Icon-only, sized to sit inside a chat composer. Errors surface via title
    // (red tint) rather than an inline span, so composer layout never shifts.
    return (
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={busy}
        aria-label={recording ? "Stop & transcribe" : "Dictate"}
        title={error || (recording ? "Stop & transcribe" : "Dictate")}
        className={[
          "flex size-7 flex-none items-center justify-center rounded-md transition-colors disabled:opacity-40",
          recording ? "text-flag" : error ? "text-flag hover:bg-paper-2" : "text-ink-3 hover:bg-paper-2",
        ].join(" ")}
      >
        {icon}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={busy}
        title={recording ? "Stop & transcribe" : "Dictate"}
        className={[
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors disabled:opacity-60",
          recording ? "border-flag bg-flag/10 text-flag" : "border-rule bg-card text-ink hover:bg-paper-2",
        ].join(" ")}
      >
        {icon}
        {busy ? "Transcribing…" : recording ? "Stop" : "Dictate"}
      </button>
      {error && <span className="text-[11px] text-flag">{error}</span>}
    </span>
  );
}
