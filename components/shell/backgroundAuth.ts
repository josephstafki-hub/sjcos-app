'use client';
import { isBackgroundFailure } from '@/lib/background-result';

// Document-local latch: signing in is a real navigation and starts a new realm.
// No private data, account-switch state or cross-window auth claim is cached.
let signedOut = false;
const listeners = new Set<() => void>();
export function resumeBackgroundAuth() { signedOut = false; }
export const backgroundAuthLost = () => signedOut;
export function noteBackgroundFailure(value: unknown): boolean {
  if (!isBackgroundFailure(value)) return false;
  if (value.code === 'SIGN_IN_AGAIN' && !signedOut) {
    signedOut = true;
    for (const notify of [...listeners]) notify();
  }
  return true;
}
export function subscribeBackgroundAuth(notify: () => void): () => void {
  listeners.add(notify);
  if (signedOut) notify();
  return () => { listeners.delete(notify); };
}
