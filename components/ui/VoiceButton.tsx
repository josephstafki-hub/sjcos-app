"use client";

import { useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useDictation } from "@/lib/use-dictation";

// Records a short voice memo via MediaRecorder and posts it to /api/transcribe
// (local whisper.cpp) — the record/transcribe core lives in useDictation, shared
// with voice-mode surfaces. Calls onText with the transcript. Self-gates on
// server availability (useVoiceAvailable → GET /api/transcribe), so it's drop-in
// on any composer without threading whisperAvailable() down as a prop — it
// simply renders nothing when voice isn't set up. `compact` renders an icon-only
// button sized to sit inside a chat composer next to the send/attach controls.

export function VoiceButton({
  onText,
  compact = false,
}: {
  onText: (text: string) => void;
  compact?: boolean;
}) {
  const [error, setError] = useState("");
  const { state, start, stop, supported } = useDictation({ onText, onError: setError });

  function begin() {
    setError("");
    void start();
  }

  // Self-gate: render nothing until the probe confirms voice is set up.
  if (!supported) return null;

  const busy = state === "transcribing";
  const recording = state === "recording";
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
        onClick={recording ? stop : begin}
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
        onClick={recording ? stop : begin}
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
