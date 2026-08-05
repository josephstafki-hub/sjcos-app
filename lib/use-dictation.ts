"use client";

import { useRef, useState } from "react";
import { useVoiceAvailable } from "@/lib/use-voice-available";

// Reusable dictation core, extracted from components/ui/VoiceButton.tsx so
// voice-mode surfaces (lib/use-voice-round.ts) can share it. Records via
// MediaRecorder, posts the blob to /api/transcribe (local whisper.cpp), and
// hands the transcript to onText. Self-gates on server availability
// (useVoiceAvailable → GET /api/transcribe). cancel() discards the in-flight
// recording — and any transcript still in flight — without calling back.

export type DictationState = "idle" | "recording" | "transcribing";

export function useDictation({
  onText,
  onError,
}: {
  onText: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const available = useVoiceAvailable();
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  // Latest callbacks by ref, so a start/stop captured in an async closure
  // (e.g. Audio onended re-arming the mic) never calls a stale one.
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);
  onTextRef.current = onText;
  onErrorRef.current = onError;

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelledRef.current) return;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await transcribe(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setState("recording");
    } catch {
      onErrorRef.current?.("Mic access denied.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setState("transcribing");
  }

  /** Discard the current recording (if any) without transcribing. */
  function cancel() {
    cancelledRef.current = true;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setState("idle");
  }

  async function transcribe(blob: Blob) {
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: blob });
      const data = await res.json().catch(() => ({}));
      if (cancelledRef.current) return;
      if (res.ok && data.text) {
        onTextRef.current(data.text as string);
      } else {
        onErrorRef.current?.(data.error || "Couldn't transcribe.");
      }
    } catch {
      if (!cancelledRef.current) onErrorRef.current?.("Transcription failed.");
    } finally {
      setState("idle");
    }
  }

  return { state, start, stop, cancel, supported: available === true };
}
