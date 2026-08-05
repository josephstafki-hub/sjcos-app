"use client";

import { useEffect, useRef, useState } from "react";
import { useDictation } from "@/lib/use-dictation";
import { useVoiceAvailable } from "@/lib/use-voice-available";
import { useTtsAvailable } from "@/lib/use-tts-available";

// Push-to-talk conversation rounds for the AI operator panel (Phase B1). One
// round: mic tap → record → transcribe (local whisper.cpp via useDictation) →
// send(text) → wait for the run's answer → speak it (local Piper via POST
// /api/tts) → re-arm the mic while voice mode stays on. The chat surface owns
// the run lifecycle and calls notifyAnswer(runId, answerText) when the final
// answer lands. Plain fetch + one shared Audio element per the house rule (no
// SSE, no streaming). Mic tap while speaking is barge-in; Escape aborts.

export type VoiceRoundPhase = "idle" | "recording" | "transcribing" | "waiting" | "speaking";

// Matches the server-side guard in lib/tts.ts.
const SPEECH_MAX = 2000;

/** Reduce markdown to speakable prose: drop fenced code blocks and table rows,
 *  unwrap links/emphasis/list markers, collapse whitespace, cap at the TTS
 *  limit. */
export function stripForSpeech(text: string): string {
  const out = text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/^\s*\|.*\|\s*$/gm, " ") // table rows
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ") // horizontal rules
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered-list markers
    .replace(/(\*\*|__|~~|\*|_)/g, "") // emphasis
    .replace(/\s+/g, " ")
    .trim();
  return out.length > SPEECH_MAX ? out.slice(0, SPEECH_MAX) : out;
}

export function useVoiceRound({
  send,
  onError,
}: {
  send: (text: string) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const stt = useVoiceAvailable();
  const tts = useTtsAvailable();
  const supported = stt === true && tts === true;

  const [voiceMode, setVoiceModeState] = useState(false);
  // Round stage outside the dictation machine: idle → waiting → speaking.
  const [stage, setStage] = useState<"idle" | "waiting" | "speaking">("idle");

  const voiceModeRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const spokenRunRef = useRef<string | null>(null);
  const sendRef = useRef(send);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    sendRef.current = send;
    onErrorRef.current = onError;
  });

  const dictation = useDictation({
    onText: (text) => void handleTranscript(text),
    onError: (message) => onErrorRef.current?.(message),
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

  /** Pause playback, detach handlers, revoke the object URL. */
  function clearAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  function play(blob: Blob) {
    clearAudio();
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    audio.src = url;
    audio.onended = () => {
      clearAudio();
      setStage("idle");
      // Round complete — voice mode still on means we're conversing, so re-arm
      // the mic for the next turn.
      if (voiceModeRef.current) void dictation.start();
    };
    audio.onerror = () => {
      clearAudio();
      setStage("idle");
      onErrorRef.current?.("Couldn't play the answer.");
    };
    setStage("speaking");
    audio.play().catch(() => {
      clearAudio();
      setStage("idle");
      onErrorRef.current?.("Couldn't play the answer.");
    });
  }

  /** Mic tap: idle → start a round (turning voice mode on), recording → stop &
   *  transcribe, speaking → barge-in (cut playback, start recording). Ignored
   *  mid-transcribe / mid-wait. */
  function micTap() {
    if (!supported) return;
    if (dictation.state === "recording") {
      dictation.stop();
      return;
    }
    if (dictation.state === "transcribing" || stage === "waiting") return;
    if (stage === "speaking") clearAudio(); // barge-in
    voiceModeRef.current = true;
    setVoiceModeState(true);
    setStage("idle");
    void dictation.start();
  }

  function stopSpeaking() {
    clearAudio();
    setStage((s) => (s === "speaking" ? "idle" : s));
  }

  /** Turning voice mode off tears the whole round down: playback, recording,
   *  and any transcript still in flight. */
  function setVoiceMode(on: boolean) {
    voiceModeRef.current = on;
    setVoiceModeState(on);
    if (!on) {
      dictation.cancel();
      clearAudio();
      setStage("idle");
    }
  }

  /** Called by the chat surface when the run's final answer arrives. Speaks it
   *  once per runId (text-only for now — a server-side runId path comes in a
   *  later phase). TTS failures land back at idle with voice mode kept on. */
  async function notifyAnswer(runId: string, fallbackText: string) {
    if (!voiceModeRef.current) return;
    if (spokenRunRef.current === runId) return;
    spokenRunRef.current = runId;
    const text = stripForSpeech(fallbackText);
    if (!text) {
      setStage("idle");
      return;
    }
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStage("idle");
        onErrorRef.current?.(data.error || "Couldn't speak the answer.");
        return;
      }
      const blob = await res.blob();
      if (!voiceModeRef.current) return; // torn down while synthesizing
      play(blob);
    } catch {
      setStage("idle");
      onErrorRef.current?.("Couldn't speak the answer.");
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
    };
  }, []);

  return { phase, voiceMode, setVoiceMode, micTap, stopSpeaking, notifyAnswer, supported };
}
