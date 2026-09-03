// A voicemail tone, generated in code. Telnyx's `playback_start` accepts a
// base64 WAV in `playback_content`, so the OS never has to host an audio file
// (nothing in the repo, nothing on a CDN, nothing to 404). 8 kHz mono 16-bit
// PCM — the narrowest format the PSTN carries anyway. Pure, unit-testable.

function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** A single sine tone as a WAV buffer. Short fade in/out so it doesn't click. */
export function toneWav(opts: { hz?: number; ms?: number; sampleRate?: number; gain?: number } = {}): Buffer {
  const hz = opts.hz ?? 1000;
  const ms = opts.ms ?? 600;
  const sr = opts.sampleRate ?? 8000;
  const gain = Math.min(1, Math.max(0, opts.gain ?? 0.5));
  const n = Math.round((sr * ms) / 1000);
  const fade = Math.min(Math.round(sr * 0.01), Math.floor(n / 2));
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > n - fade) env = (n - i) / fade;
    const s = Math.sin((2 * Math.PI * hz * i) / sr) * gain * env;
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return Buffer.concat([wavHeader(pcm.length, sr), pcm]);
}

/** The voicemail beep, base64, ready for `playback_content`. */
export function voicemailBeepBase64(): string {
  return toneWav({ hz: 1000, ms: 600 }).toString("base64");
}

/** US ringback: 440 Hz + 480 Hz for 2 s, then 4 s of silence — one cycle;
 *  Telnyx loops it ("infinity") while the far leg rings. 8 kHz mono. */
export function ringbackWav(): Buffer {
  const sr = 8000;
  const on = sr * 2;
  const off = sr * 4;
  const n = on + off;
  const fade = Math.round(sr * 0.01);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < on; i++) {
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > on - fade) env = (on - i) / fade;
    const s = (Math.sin((2 * Math.PI * 440 * i) / sr) + Math.sin((2 * Math.PI * 480 * i) / sr)) * 0.2 * env;
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return Buffer.concat([wavHeader(pcm.length, sr), pcm]);
}
