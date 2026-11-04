import { NextResponse } from 'next/server';
import { sweepInboxDrafts } from '@/lib/inbox-autodraft';
import { cronAuthorized, runCronJob } from '../_lib/guard';

// POST/GET /api/cron/inbox-drafts — the 10-minute auto-draft sweep (lib/inbox-autodraft.ts).
// Same shared-secret gate as the other cron routes (CRON_SECRET, fails closed when unset).
// It only stages drafts for Joe to review; nothing is ever sent from here.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return runCronJob('inbox drafts', sweepInboxDrafts);
}
export const GET = handle;
export const POST = handle;
