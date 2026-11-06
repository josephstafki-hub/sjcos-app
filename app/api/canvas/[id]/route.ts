import { canvasGet, canvasDelete, canvasHumanBody, canvasHumanJson as canvasJson, canvasSameOrigin } from '@/lib/ask-canvases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { return canvasJson(async () => { const { id } = await params; const input: Record<string, unknown> = {}; for (const [k, v] of new URL(req.url).searchParams) {
    if (k in input)
        throw Error('INVALID_INPUT');
    if (k !== 'version')
        throw Error('INVALID_INPUT');
    input[k] = /^[1-9][0-9]*$/.test(v) ? Number(v) : v;
} return canvasGet(id, input); }); }
export async function DELETE(req: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { return canvasJson(async () => { canvasSameOrigin(req); const { id } = await params; return canvasDelete(id, await canvasHumanBody(req, 8192)); }); }
