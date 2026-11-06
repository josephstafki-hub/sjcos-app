"use client";

import { useEffect, useState } from "react";

export type VoiceAvailability = { enabled: boolean; generation: number };

// One shared in-flight capability request. Legacy callers keep the page-life
// cache; explicit recovery generations invalidate it for all mounted consumers.
let cached: Promise<boolean> | null = null;
let cachedGeneration: number | undefined;

function probe(generation?: number): Promise<boolean> {
  if (generation !== undefined && generation !== cachedGeneration) {
    cached = null;
    cachedGeneration = generation;
  }
  if (!cached) {
    cached = fetch("/api/tts", { method: "GET", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => Boolean(d?.available))
      .catch(() => false);
  }
  return cached;
}

/** Disabled => no request; null while a new generation is still unknown. */
export function useTtsAvailable(availability?: VoiceAvailability): boolean | null {
  const enabled = availability?.enabled ?? true;
  const generation = availability?.generation;
  const [result, setResult] = useState<{ generation: number | undefined; value: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    probe(generation).then((value) => { if (alive) setResult({ generation, value }); });
    return () => { alive = false; };
  }, [enabled, generation]);
  if (!enabled) return false;
  return result?.generation === generation ? result?.value ?? null : null;
}
