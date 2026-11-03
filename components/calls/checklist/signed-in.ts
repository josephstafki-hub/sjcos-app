// Who this browser last signed in as. The Calls pages and the live-call bar
// write it; a checklist tab stops sending if another tab signs in as someone
// else (plan §4.3: one user never acts on another user's queue). Logout clears it.

export const SIGNED_IN_KEY = "sjcos:signed-in-user";

export function signedInUser(): string | null {
  try { return localStorage.getItem(SIGNED_IN_KEY); } catch { return null; }
}

export function markSignedIn(userId: string) {
  broadcast(userId);
  try { localStorage.setItem(SIGNED_IN_KEY, userId); } catch { /* storage off: nothing to compare */ }
}

export function clearSignedIn() {
  if(typeof window!=="undefined") window.dispatchEvent(new Event("sjcos-checklist-logout"));
  broadcast(null);
  try { localStorage.removeItem(SIGNED_IN_KEY); } catch { /* storage off */ }
}

function broadcast(userId:string|null) {
 if(typeof BroadcastChannel==='undefined') return;
 const channel=new BroadcastChannel('sjcos-checklist-auth');
 channel.postMessage(userId); channel.close();
}
