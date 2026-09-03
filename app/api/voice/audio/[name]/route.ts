import { ringbackWav, toneWav } from "@/lib/comms/beep";

// GET /api/voice/audio/{ringback,beep}.wav — the two prompts Telnyx plays on a
// call (playback_start audio_url): ringback while the far leg rings, the tone
// before a voicemail. Generated in code, so nothing is hosted or committed;
// public by design (Telnyx fetches them unauthenticated; they carry no data).
export const dynamic = "force-static";

const FILES: Record<string, () => Buffer> = {
  "ringback.wav": ringbackWav,
  "beep.wav": () => toneWav({ hz: 1000, ms: 600 }),
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const make = FILES[name];
  if (!make) return new Response("Not found", { status: 404 });
  const wav = make();
  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      "content-type": "audio/wav",
      "content-length": String(wav.length),
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
