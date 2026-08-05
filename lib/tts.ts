import "server-only";

// Local text-to-speech for voice conversation rounds (Phase B1, operator
// panel). Uses Piper (offline, CPU) — user-local, no cloud — mirroring the
// whisper.cpp setup in lib/transcribe.ts. Unlike whisper, piper reads its text
// from stdin (its CLI contract), so we spawn rather than execFile, write the
// text, and read back the WAV it writes to a temp file. Degrades gracefully:
// piperAvailable() gates the speaker path, and any failure returns an error
// the caller surfaces (typed chat never breaks).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const PIPER_BIN = process.env.PIPER_BIN || path.join(HOME, ".local/bin/piper");
const PIPER_VOICE =
  process.env.PIPER_VOICE || path.join(HOME, ".local/share/piper-voices/en_US-lessac-medium.onnx");

/** True when the piper binary + voice model are both present, so the UI can
 *  offer spoken answers (the .onnx.json config is assumed alongside the model;
 *  a missing one fails at synthesis time with a clear error). */
export function piperAvailable(): boolean {
  return existsSync(PIPER_BIN) && existsSync(PIPER_VOICE);
}

export type SynthesizeResult = { ok: true; wav: Buffer } | { ok: false; error: string };

/** Synthesize `text` to a WAV buffer. Newlines collapse to spaces first —
 *  piper treats each stdin line as a separate utterance and would only keep
 *  the last one in --output_file. Never throws. */
export async function synthesizeSpeech(text: string): Promise<SynthesizeResult> {
  if (!piperAvailable()) {
    return { ok: false, error: "Speech synthesis isn't set up on the server." };
  }
  const speech = (text || "").replace(/\s+/g, " ").trim();
  if (!speech) return { ok: false, error: "No text received." };
  if (speech.length > 2000) return { ok: false, error: "Text is too long to speak." };

  const dir = await mkdtemp(path.join(os.tmpdir(), "sjcos-tts-"));
  const outPath = path.join(dir, "out.wav");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(PIPER_BIN, ["--model", PIPER_VOICE, "--output_file", outPath]);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("timed out"));
      }, 30_000);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`piper exited with code ${code}`));
      });
      child.stdin.on("error", () => {}); // EPIPE when piper dies early — close reports it
      child.stdin.write(speech);
      child.stdin.end();
    });

    const wav = await readFile(outPath);
    if (wav.length === 0) return { ok: false, error: "Couldn't synthesize speech." };
    return { ok: true, wav };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Speech synthesis failed.";
    return { ok: false, error: msg.includes("timed out") ? "Speech synthesis timed out." : "Couldn't synthesize speech." };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
