import { NextResponse } from 'next/server';
import { sweepInboxDrafts } from '@/lib/inbox-autodraft';
import { cronAuthorized, runCronJob } from '../_lib/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return runCronJob('inbox drafts', sweepInboxDrafts);
}
export const GET = handle;
export const POST = handle;
