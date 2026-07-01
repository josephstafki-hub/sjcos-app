"use client";

import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";

// Records a short voice memo via MediaRecorder and posts it to /api/transcribe
// (local whisper.cpp). Calls onText with the transcript. Rendered only when the
// server reports voice is available (whisperAvailable), so typed logs are never
// blocked. Kept generic so both the project + sub daily-log composers use it.

type Phase = "idle" | "recording" | "transcribing";

export function VoiceButton({ onText }: { onText: (text: string) => void }) {
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

  const busy = phase === "transcribing";

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={phase === "recording" ? stop : start}
        disabled={busy}
        title={phase === "recording" ? "Stop & transcribe" : "Dictate"}
        className={[
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors disabled:opacity-60",
          phase === "recording"
            ? "border-flag bg-flag/10 text-flag"
            : "border-rule bg-card text-ink hover:bg-paper-2",
        ].join(" ")}
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" strokeWidth={1.75} />
        ) : phase === "recording" ? (
          <Square className="size-3 fill-flag" strokeWidth={1.75} />
        ) : (
          <Mic className="size-3" strokeWidth={1.75} />
        )}
        {busy ? "Transcribing…" : phase === "recording" ? "Stop" : "Dictate"}
      </button>
      {error && <span className="text-[11px] text-flag">{error}</span>}
    </span>
  );
}
