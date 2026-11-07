import {requireBrowserWebRequest as requireUser} from '@/lib/browser/web';
// This dedicated requireUser boundary uses cookie-only sid and live DB authority.
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=requireUser;
export const HEAD=requireUser;
export const POST=requireUser;
export const PUT=requireUser;
export const PATCH=requireUser;
export const DELETE=requireUser;
export const OPTIONS=requireUser;
