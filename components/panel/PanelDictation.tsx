"use client";
import { useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useDictation } from "@/lib/use-dictation";

export function PanelDictation({ onText }: { onText: (text: string) => void }) {
  const [error, setError] = useState("");
  const mic = useDictation({ onText, onError: setError });
  if (!mic.supported) return null;
  return <span className="relative flex items-center">
    <button type="button" aria-label={mic.state === "recording" ? "Stop dictation" : "Dictate"} title={mic.state === "recording" ? "Stop dictation" : "Dictate"}
      disabled={mic.state === "transcribing"} className="rounded-md p-1.5 text-ink-3 hover:bg-hover"
      onClick={() => { setError(""); if (mic.state === "recording") mic.stop(); else void mic.start(); }}>
      {mic.state === "recording" ? <Square className="size-4 text-flag" /> : mic.state === "transcribing" ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
    </button>
    {error && <span role="alert" className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-rule bg-card p-3 text-meta text-flag shadow-pop">
      {error} Allow microphone access in your browser’s site permissions, then try Dictate again.
      <button type="button" className="ml-2 underline" onClick={() => setError("")}>Dismiss</button>
    </span>}
  </span>;
}
