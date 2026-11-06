import { canvasEvents, canvasHumanJson as canvasJson } from '@/lib/ask-canvases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { return canvasJson(async () => { const { id } = await params; const q = new URL(req.url).searchParams; const input: Record<string, unknown> = {}; for (const [k, v] of q) {
    if (k in input)
        throw Error('INVALID_INPUT');
    input[k] = k === 'limit' ? (/^[1-9][0-9]*$/.test(v) ? Number(v) : v) : v;
} return canvasEvents(id, input); }); }
