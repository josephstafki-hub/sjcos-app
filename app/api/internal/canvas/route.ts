import { timingSafeEqual } from 'node:crypto';
import { canvasBody, canvasInternal, canvasJson } from '@/lib/ask-canvases';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
    return canvasJson(async () => {
        const expected = process.env.CRON_SECRET, supplied = req.headers.get('authorization') ?? '', wanted = `Bearer ${expected}`;
        if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(wanted) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(wanted)))
            throw Error('AUTH_REQUIRED');
        const body = await canvasBody(req);
        if (!body || Object.keys(body).sort().join(',') !== 'action,context,input' || typeof body.action !== 'string')
            throw Error('INVALID_INPUT');
        return canvasInternal(body.action, body.input, body.context);
    });
}
