"use client";

import { useEffect, useState } from "react";

// Client-side gate for the dictation mic. Server-side speech-to-text
// (whisper.cpp) may or may not be set up on the box, and deeply-nested client
// composers (AI chat, team chat, inbox) can't easily learn that from a server
// prop. This probes GET /api/transcribe ONCE and shares the answer across every
// mounted VoiceButton via a module-level promise — so N mics = one request.

let cached: Promise<boolean> | null = null;

function probe(): Promise<boolean> {
  if (!cached) {
    cached = fetch("/api/transcribe", { method: "GET" })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => Boolean(d?.available))
      .catch(() => false);
  }
  return cached;
}

/** Returns null while unknown, then true/false once the probe resolves. */
export function useVoiceAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    probe().then((v) => alive && setAvailable(v));
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
