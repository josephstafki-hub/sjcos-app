import { canvasRestore, canvasHumanBody, canvasHumanJson as canvasJson, canvasSameOrigin } from '@/lib/ask-canvases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { return canvasJson(async () => { canvasSameOrigin(req); const { id } = await params; return canvasRestore(id, await canvasHumanBody(req, 8192)); }); }
