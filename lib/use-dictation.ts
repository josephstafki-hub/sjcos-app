"use client";

import { useEffect, useRef, useState } from "react";
import { useVoiceAvailable } from "@/lib/use-voice-available";

// Reusable dictation core, extracted from components/ui/VoiceButton.tsx so
// voice-mode surfaces (lib/use-voice-round.ts) can share it. Records via
// MediaRecorder, posts the blob to /api/transcribe (local whisper.cpp), and
// hands the transcript to onText. Self-gates on server availability
// (useVoiceAvailable → GET /api/transcribe). cancel() discards the in-flight
// recording — and any transcript still in flight — without calling back.
//
// Optional voice-activity detection (`autoStop`): once speech has been heard,
// ~1.2s of silence ends the utterance automatically — no stop/send tap. That
// is what makes hands-free rounds on a phone workable. Pure Web Audio RMS on
// an AnalyserNode; no model, no extra permission. A hard cap ends runaway
// recordings (background noise never going quiet) at maxMs.

export type DictationState = "idle" | "recording" | "transcribing";

export interface AutoStopOptions {
  /** Silence needed after speech to end the utterance. */
  silenceMs?: number;
  /** Speech needed before silence counts (filters a cough / a tap). */
  minSpeechMs?: number;
  /** Absolute cap on one utterance. */
  maxMs?: number;
  /** Give up (discard) if no speech is heard at all within this long — a
   *  re-armed mic that hears nothing shouldn't sit open recording silence. */
  noSpeechMs?: number;
  /** RMS threshold 0..1 above which a frame counts as speech. */
  threshold?: number;
}

const AUTO_DEFAULTS: Required<AutoStopOptions> = {
  silenceMs: 1200,
  minSpeechMs: 350,
  maxMs: 45_000,
  noSpeechMs: 10_000,
  threshold: 0.02,
};

export function useDictation({
  onText,
  onError,
  onLevel,
}: {
  onText: (text: string) => void;
  onError?: (message: string) => void;
  /** Live mic level 0..1 while recording (only when autoStop analysis runs). */
  onLevel?: (level: number) => void;
}) {
  const available = useVoiceAvailable();
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const vadCleanupRef = useRef<(() => void) | null>(null);
  // Latest callbacks by ref, so a start/stop captured in an async closure
  // (e.g. Audio onended re-arming the mic) never calls a stale one. Assigned
  // in an effect (not render) per the react-hooks/refs rule.
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);
  const onLevelRef = useRef(onLevel);
  useEffect(() => {
    onTextRef.current = onText;
    onErrorRef.current = onError;
    onLevelRef.current = onLevel;
  });

  async function start(autoStop?: AutoStopOptions | boolean) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        vadCleanupRef.current?.();
        vadCleanupRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        if (cancelledRef.current) return;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await transcribe(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setState("recording");
      if (autoStop) attachVad(stream, rec, autoStop === true ? {} : autoStop);
    } catch {
      onErrorRef.current?.("Mic access denied.");
    }
  }

  /** Voice-activity watcher: stops the recorder after silence follows speech. */
  function attachVad(stream: MediaStream, rec: MediaRecorder, o: AutoStopOptions) {
    const opt = { ...AUTO_DEFAULTS, ...o };
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return; // no Web Audio — fall back to manual stop
    }
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = Date.now();
    let speechMs = 0;
    let lastVoice = 0;
    let lastTick = Date.now();
    // A timer, not requestAnimationFrame: rAF stalls when a phone screen dims
    // or the tab is backgrounded, and this has to keep judging silence then.
    const timer = setInterval(() => {
      if (rec.state !== "recording") {
        clearInterval(timer);
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      onLevelRef.current?.(Math.min(1, rms * 8));
      const now = Date.now();
      const dt = now - lastTick;
      lastTick = now;
      if (rms >= opt.threshold) {
        speechMs += dt;
        lastVoice = now;
      }
      const heardEnough = speechMs >= opt.minSpeechMs;
      const quietFor = lastVoice ? now - lastVoice : 0;
      const elapsed = now - started;
      if (heardEnough && quietFor >= opt.silenceMs) {
        clearInterval(timer);
        stop();
      } else if (heardEnough && elapsed >= opt.maxMs) {
        clearInterval(timer);
        stop();
      } else if (!heardEnough && elapsed >= opt.noSpeechMs) {
        // Nothing said — discard rather than transcribe room noise.
        clearInterval(timer);
        cancel();
      }
    }, 60);
    vadCleanupRef.current = () => {
      clearInterval(timer);
      try {
        src.disconnect();
        void ctx.close();
      } catch {
        /* already closed */
      }
    };
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
