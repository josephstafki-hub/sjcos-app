import "server-only";

// Local speech-to-text for voice daily logs (Phase-3 execution, 7-voice). Uses
// whisper.cpp (offline, CPU) + ffmpeg — both user-local, no cloud. The browser
// records webm/opus; ffmpeg decodes it to 16 kHz mono WAV, whisper-cli emits the
// transcript. Invoked per request via execFile (argv array — no shell injection).
// Degrades gracefully: whisperAvailable() gates the mic button, and any failure
// returns an error the caller surfaces (typed logs never break).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

const HOME = os.homedir();
const WHISPER_BIN =
  process.env.WHISPER_BIN || path.join(HOME, ".local/src/whisper.cpp/build/bin/whisper-cli");
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || path.join(HOME, ".local/share/whisper-models/ggml-base.en.bin");
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

/** True when the whisper binary + model are both present, so the UI can show
 *  the mic button (ffmpeg is assumed on PATH; a missing one fails at transcribe
 *  time with a clear error). */
export function whisperAvailable(): boolean {
  return existsSync(WHISPER_BIN) && existsSync(WHISPER_MODEL);
}

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

/** Transcribe a recorded audio blob to text. Writes the upload to a temp dir,
 *  converts to WAV via ffmpeg, runs whisper-cli, returns the trimmed text. */
export async function transcribeAudio(bytes: Buffer): Promise<TranscribeResult> {
  if (!whisperAvailable()) {
    return { ok: false, error: "Voice transcription isn't set up on the server." };
  }
  if (!bytes || bytes.length === 0) return { ok: false, error: "No audio received." };
  if (bytes.length > 25 * 1024 * 1024) return { ok: false, error: "Recording is too long." };

  const dir = await mkdtemp(path.join(os.tmpdir(), "sjcos-stt-"));
  const inPath = path.join(dir, "in");
  const wavPath = path.join(dir, "audio.wav");
  const outBase = path.join(dir, "out"); // whisper writes out.txt

  try {
    await writeFile(inPath, bytes);

    // Decode whatever the browser sent (webm/opus, mp4, etc.) to 16 kHz mono WAV.
    await run(FFMPEG_BIN, ["-i", inPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath, "-y"], {
      timeout: 30_000,
    });

    // -nt: no timestamps, -np: no progress prints, -otxt/-of: write out.txt.
    await run(
      WHISPER_BIN,
      ["-m", WHISPER_MODEL, "-f", wavPath, "-nt", "-np", "-otxt", "-of", outBase],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );

    const text = (await readFile(`${outBase}.txt`, "utf8")).trim();
    if (!text) return { ok: false, error: "Couldn't make out any speech." };
    return { ok: true, text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Transcription failed.";
    return { ok: false, error: msg.includes("timed out") ? "Transcription timed out." : "Couldn't transcribe the recording." };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
