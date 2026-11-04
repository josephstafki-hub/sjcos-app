import {payloadHash} from '../queue.ts';
import {evidencePatches,mergeEvidence} from '../evidence-chunks.ts';
import {frostZones} from '../frost.ts';
import {deadlineFetch,isNetworkFailure,transportCode,transientClose} from '../transport.ts';
/**
 * The one stateful object behind the field app. Wires the backend's offline modules
 * (get-ready.ts, offline-vault.ts, offline-engine.ts, queue.ts, service-worker.ts)
 * to React through subscribe/getState. One controller = one engine per device/visit.
 * Rules kept here (HANDOFF §UI integration order):
 *  - a save is shown only after engine.capture/captureBlob resolves (durable IDB commit);
 *  - replay is driven by the UI (online event, Send now, queue next_at), never by the SW;
 *  - nothing decrypted is kept outside this object; lock() on exit/lock;
 *  - pending local state always wins over newly downloaded data.
 */
import { ConsultOfflineStore, type OfflineIdentity, type OfflineLease, type SignedLease } from '../offline.ts';
import { OfflineVault } from '../offline-vault.ts';
import { OfflineEngine, type LocalBlob, type LocalVisit } from '../offline-engine.ts';
import { getReady } from '../get-ready.ts';
import { canonicalJson, enqueue, closeManifest, type QueueState } from '../queue.ts';
import { registerConsultWorker, type PrecacheManifest } from '../service-worker.ts';
import type { ReadyCheck, CheckResult } from '../readiness.ts';
import { HOUSE_WIDE, baselineOf, buildModel, emptyDraft, manifestBlobs, moduleNoun, predictRevisions, unsentCount, type Baseline, type Display, type EvidenceDraft, type Snapshot } from './model.ts';
import { decisionPatches, decisionsOp, answerOp, createInstanceOp, discardOp, removeInstanceOp, resolveOp, startOp, uuid, type AnswerPayload } from './ops.ts';

export interface Boot {
  status?:string; closed_at?:string|null; completeness?:unknown;
  /** r8 domain E4: on a Complete visit, estimate quantities with no measured answer. */
  unmeasured?: number;
  consult_id: string; user: { id: string; name: string; role: string }; session_epoch: number;
  display: Display; auto_apply: boolean; capture_enabled: boolean; home: string;
}
export type Phase = 'loading' | 'get_ready' | 'unlock' | 'visit' | 'blocked' | 'disabled' | 'complete';
export type ReadyResult = 'idle' | 'checking' | 'ready' | 'not_ready' | 'no_signal';
export interface CloseResult { complete: boolean; checks: { check: number; code: string; action?: string; open: string[]; open_phrase?: string }[]; price_critical: { total: number; done: number; skipped: number }; record: { total: number; done: number; skipped: number }; revision: number }
/** r11 R11-1: `field` is the first `details[].field` the office named (a Zod path), so Go to field /
 *  Before you wrap can focus it. */
export interface ClosingState { step: 'sending' | 'closing' | 'done' | 'error' | 'waiting_signal'; result?: CloseResult; code?: string; ownerNotified?: boolean; field?: string }
/** r11: the office's refusal, with its `details[]` (field / code / message) kept for the close screen. */
export class ConsultRefusal extends Error {
  details: { field?: string; code?: string; message?: string }[];
  constructor(code: string, details: { field?: string; code?: string; message?: string }[] = []) { super(code); this.details = details; }
}
export const refusalField = (e: unknown): string | undefined => e instanceof ConsultRefusal ? e.details.find((d) => typeof d?.field === 'string' && d.field)?.field : undefined;
export interface State {
  phase: Phase; online: boolean; boot: Boot | null; consultId: string; identity: OfflineIdentity | null; device: string;
  enrolled: boolean; olderBuild: boolean; leaseExpires: number | null;
  ready: { result: ReadyResult; checks: Partial<Record<ReadyCheck, CheckResult>>; failed?: ReadyCheck; code?: string };
  local: LocalVisit | null; fresh: Snapshot | null; freshSeq: number; draft: EvidenceDraft;
  blocked: QueueState['blocked']; code: string | null; sending: boolean; lastSendFailure: { code: string; at: number } | null; lastSaved: string | null; storageFull: boolean;
  closing: ClosingState | null; thumbs: Record<string, string>; busy: boolean; findingsCode: string | null;
}

const DEVICE_KEY = 'sjcos-consult-device';
const NEEDED_BYTES = 50 * 1024 * 1024;
const post = async (consultId: string, command: string, input: unknown) => {
  const r = await deadlineFetch(fetch,`/api/consult/${consultId}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Consult-CSRF': '1' }, body: JSON.stringify({ command, input }) });
  let body: Record<string, unknown> = {};
  try { body = await r.json(); } catch { /* empty body */ }
  if (r.status === 408 || r.status === 429 || r.status >= 500) throw new Error(`http_${r.status}`);
  if (!r.ok || body.ok === false) throw new ConsultRefusal(String(body.error_code ?? body.code ?? (r.status === 401 ? 'signed_out' : r.status === 403 ? 'access_denied' : `http_${r.status}`)), Array.isArray(body.details) ? body.details as { field?: string }[] : []);
  return body;
};
const offlineError = isNetworkFailure;
const codeOf = transportCode;

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
    const id = uuid(); localStorage.setItem(DEVICE_KEY, id); return id;
  } catch { return uuid(); }
}

export interface Enrollment { identity: OfflineIdentity; device: string; expires_at: number | null }
/** Enrollment key names are plaintext ids only (`enrollment:<partition>:<device>`); no client data. */
export async function listEnrollments(): Promise<Enrollment[]> {
  if (typeof indexedDB === 'undefined') return [];
  return new Promise((resolve) => {
    const req = indexedDB.open('sjcos-consult-v1');
    req.onupgradeneeded = () => { /* brand new: nothing enrolled; the store creates its own schema */ };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) { db.close(); resolve([]); return; }
      const tx = db.transaction('keys', 'readonly'); const store = tx.objectStore('keys');
      const keys = store.getAllKeys(); const values = store.getAll();
      tx.oncomplete = () => {
        const out: Enrollment[] = [];
        keys.result.forEach((k, i) => {
          const name = String(k); if (!name.startsWith('enrollment:')) return;
          const rest = name.slice('enrollment:'.length); const cut = rest.lastIndexOf(':');
          try {
            const [user_id, session_epoch, build, consult_id] = JSON.parse(rest.slice(0, cut)) as [string, number, string, string];
            const lease = (values.result[i] as { lease?: SignedLease })?.lease;
            const expires = lease ? (JSON.parse(lease.payload) as { expires_at?: number }).expires_at ?? null : null;
            out.push({ identity: { user_id, session_epoch, build, consult_id }, device: rest.slice(cut + 1), expires_at: expires });
          } catch { /* not ours */ }
        });
        db.close(); resolve(out);
      };
      tx.onerror = () => { db.close(); resolve([]); };
    };
  });
}

async function activeWorker(reg: ServiceWorkerRegistration): Promise<ServiceWorker> {
  if (reg.active) return reg.active;
  const w = reg.installing ?? reg.waiting;
  if (!w) throw new Error('missing_precache');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('missing_precache')), 20000);
    w.addEventListener('statechange', () => { if (w.state === 'activated' && reg.active) { clearTimeout(t); resolve(reg.active); } if (w.state === 'redundant') { clearTimeout(t); reject(new Error('missing_precache')); } });
  });
}

/** Downscale to ≤2560 px JPEG (drops EXIF location); falls back to the original bytes. */
async function preparePhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('invalid_image'))), 'image/jpeg', 0.86));
  } catch { return file; }
}
async function sha256(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Listener = () => void;
export class VisitController {
  private state: State;
  private listeners = new Set<Listener>();
  private store: ConsultOfflineStore | null = null;
  private engine: OfflineEngine | null = null;
  private key: CryptoKey | null = null;
  private lease: OfflineLease | null = null;
  private manifest: PrecacheManifest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private drainPromise: Promise<void> | null = null;
  private initializing: Promise<void> | null = null;
  private uploadAttempts = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private memoryEpoch = 0;

  constructor(boot: Boot | null, consultId: string) {
    this.state = {
      phase: 'loading', online: typeof navigator === 'undefined' ? true : navigator.onLine, boot, consultId, identity: null, device: '', enrolled: false, olderBuild: false, leaseExpires: null,
      ready: { result: 'idle', checks: {} }, local: null, fresh: null, freshSeq: 0, draft: emptyDraft(), blocked: null, code: null,
      sending: false, lastSendFailure: null, lastSaved: null, storageFull: false, closing: null, thumbs: {}, busy: false, findingsCode: null,
    };
  }
  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => { if (this.lease && this.lease.expires_at <= Date.now()) this.deny('offline_locked'); return this.state; };
  private set(patch: Partial<State>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }

  private onOnline = () => { this.set({ online: true }); void this.refresh().then(() => this.drain()); };
  private onOffline = () => this.set({ online: false });
  private onHide = () => { if (document.visibilityState === 'hidden') void this.drain(); else void this.refresh().then(() => this.drain()); };

  async init() {
    this.disposed = false;
    window.addEventListener('online', this.onOnline); window.addEventListener('offline', this.onOffline); document.addEventListener('visibilitychange', this.onHide);
    const device = deviceId();
    const { boot, consultId } = this.state;
    // r7 R7-1: a Complete visit is locked — no Get ready, no PIN; the calm read-only Complete screen.
    if (boot?.status==='complete') { this.set({ device, phase: 'complete' }); return; }
    if (boot && !boot.capture_enabled) {
      if ('serviceWorker' in navigator) await registerConsultWorker(false).catch(() => null);
      this.set({ device, phase: 'disabled', code: 'capture_disabled' }); return;
    }
    try { this.store = await ConsultOfflineStore.open(); } catch { this.store = null; }
    if (boot) {
      try { const r = await deadlineFetch(fetch,'/consult/precache.json', { cache: 'no-store', credentials: 'omit' }); if (r.ok) this.manifest = await r.json(); } catch { /* offline pages check reports it */ }
    }
    const mine = (await listEnrollments()).filter((e) => e.identity.consult_id === consultId && e.device === device && (!boot || e.identity.user_id === boot.user.id));
    const current = boot ? { user_id: boot.user.id, session_epoch: boot.session_epoch, build: this.manifest?.build ?? 'unbuilt', consult_id: consultId } : null;
    const exact = current && mine.find((e) => JSON.stringify(e.identity) === JSON.stringify(current));
    const pick = exact ?? mine.sort((a, b) => (b.expires_at ?? 0) - (a.expires_at ?? 0))[0];
    if (pick) {
      this.set({ device, identity: pick.identity, enrolled: true, olderBuild: !!current && pick.identity.build !== current.build, leaseExpires: pick.expires_at, phase: 'unlock' });
    } else if (current) {
      this.set({ device, identity: current, phase: 'get_ready' });
    } else {
      this.set({ device, phase: 'get_ready', ready: { result: 'no_signal', checks: {} } });
    }
  }

  /** §5.2: six ordered checks; Ready offline only when the first five pass. */
  async getReady(pin: string) {
    if (!/^\d{6,12}$/.test(pin)) { this.set({ ready: { result: 'not_ready', checks: {}, failed: 'offline_lease', code: 'pin_invalid' } }); return; }
    const { boot, consultId, device } = this.state;
    if (!boot) { this.set({ ready: { result: 'no_signal', checks: {} } }); return; }
    const identity: OfflineIdentity = this.state.enrolled && this.state.identity && !this.state.olderBuild ? this.state.identity : { user_id: boot.user.id, session_epoch: boot.session_epoch, build: this.manifest?.build ?? 'unbuilt', consult_id: consultId };
    const checks: Partial<Record<ReadyCheck, CheckResult>> = {};
    const fail = (check: ReadyCheck, code: string) => { checks[check] = { state: 'problem', reason: code }; this.set({ ready: { result: code === 'no_signal' ? 'no_signal' : 'not_ready', checks: { ...checks }, failed: check, code } }); };
    this.set({ ready: { result: 'checking', checks: {} }, code: null });
    if (!navigator.onLine) { this.set({ ready: { result: 'no_signal', checks: {} } }); return; }
    if (!this.store) { try { this.store = await ConsultOfflineStore.open(); } catch { checks.visit_details = { state: 'done' }; checks.forms = { state: 'done' }; return fail('saving_on_device', 'storage_unavailable'); } }
    let worker: ServiceWorker | null = null;
    try {
      if (!('serviceWorker' in navigator)) throw new Error('no_worker');
      const reg = await registerConsultWorker(true);
      worker = reg ? await activeWorker(reg) : null;
    } catch { worker = null; }
    try { if (!this.manifest) { const r = await deadlineFetch(fetch,'/consult/precache.json', { cache: 'no-store', credentials: 'omit' }); if (r.ok) this.manifest = await r.json(); } } catch (e) { if (offlineError(e)) { this.set({ ready: { result: 'no_signal', checks: {} } }); return; } }
    const request = fetch;
    if (!worker || !this.manifest) {
      // Run the checks that can still run so the screen names the exact failure.
      checks.visit_details = { state: 'checking' }; this.set({ ready: { result: 'checking', checks: { ...checks } } });
      try { const r = await request(`/api/consult/${consultId}`, { credentials: 'same-origin', cache: 'no-store' }); if (!r.ok) throw new Error(r.status === 401 ? 'signed_out' : r.status === 403 ? 'revoked' : 'snapshot_unavailable'); checks.visit_details = { state: 'done' }; checks.forms = { state: 'done' }; }
      catch (e) { return fail('visit_details', codeOf(e)); }
      return fail('offline_pages', this.manifest ? 'no_worker' : 'missing_precache');
    }
    const result = await getReady({ identity, device, pin, manifest: this.manifest, worker, store: this.store, storage: navigator.storage, needed_bytes: NEEDED_BYTES, request,
      onCheck: (check, r) => { checks[check] = r; if (check !== 'microphone') this.set({ ready: { result: 'checking', checks: { ...checks } } }); } });
    if (!result.ok) {
      const code = offlineError(new Error(result.code)) ? 'no_signal' : result.code;
      if (result.code === 'capture_disabled') { await registerConsultWorker(false).catch(() => null); this.set({ phase: 'disabled', code: 'capture_disabled' }); return; }
      return fail(result.check, code);
    }
    this.engine = result.engine;
    try { const v = await new OfflineVault(this.store).unlock(identity, device, pin); this.key = v.key; this.lease = v.lease; } catch { /* thumbnails of earlier photos stay hidden */ }
    this.set({ identity, enrolled: true, olderBuild: false, leaseExpires: result.expires_at, ready: { result: 'ready', checks: { ...checks } } });
    try { const url = new URL(location.href); url.searchParams.set('consult_build', identity.build); history.replaceState(history.state, '', url); } catch { /* cosmetic */ }
    await this.afterUnlock();
  }

  /** Offline unlock: original identity + device + PIN; lease expiry locks reads (§12.1). */
  async unlock(pin: string) {
    const { identity, device } = this.state;
    if (!identity || !this.store) { this.set({ code: 'storage_unavailable' }); return; }
    this.set({ busy: true, code: null });
    try {
      const vault = new OfflineVault(this.store);
      const v = await vault.unlock(identity, device, pin);
      const engine = new OfflineEngine(identity, this.store, fetch);
      await engine.unlockSigned(v.key, v.signed, device, v.issuer);
      if (!engine.read()) { this.set({ busy: false, phase: 'get_ready', enrolled: true }); return; }
      const boot=this.state.boot, local=engine.read();
      const current=boot&&this.manifest?{user_id:boot.user.id,session_epoch:boot.session_epoch,build:this.manifest.build,consult_id:this.state.consultId}:null;
      if(current&&JSON.stringify(current)!==JSON.stringify(identity)&&local&&unsentCount(local.queue.entries)===0&&local.blobs.every(b=>b.receipt)&&navigator.onLine){
        engine.lock();this.set({busy:false,identity:current,enrolled:false,olderBuild:false,phase:'get_ready'});return;
      }
      this.engine = engine; this.key = v.key; this.lease = v.lease;
      this.set({ busy: false, leaseExpires: v.lease.expires_at });
      await this.afterUnlock();
    } catch (e) {
      const code = codeOf(e);
      if (code === 'offline_locked' && this.state.boot && !this.state.olderBuild) { this.set({ busy: false, phase: 'get_ready', code: null }); return; }
      this.set({ busy: false, code, ...(code === 'offline_quarantined' ? { phase: 'blocked' as Phase, blocked: 'revoked' as const } : code === 'offline_locked' ? { phase: 'blocked' as Phase, blocked: 'signed_out' as const } : {}) });
    }
  }

  private async afterUnlock() {
    if (navigator.onLine) await this.refresh();
    if (!this.engine) return;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => this.deny('offline_locked'), Math.max(0, this.lease!.expires_at - Date.now()));
    const local = this.engine!.read();
    const draft = (local?.queue.projection as { draft?: EvidenceDraft })?.draft ?? (local?.snapshot as Snapshot)?.decisions ?? emptyDraft();
    this.set({ local, draft, phase: local?.queue.blocked ? 'blocked' : 'visit', blocked: local?.queue.blocked ?? null, code: local?.queue.blocked ?? null });
    await this.ensureRequiredInstances();
    void this.loadThumbs();
    void this.drain();
  }

  private async loadThumbs() {
    const local = this.state.local; if (!local || !this.key || !this.lease || !this.store || !this.state.identity) return;
    const epoch = this.memoryEpoch;
    const thumbs = { ...this.state.thumbs };
    for (const b of local.blobs) {
      if (thumbs[b.hash]) continue;
      try { const blob = await this.store.loadBlob(this.state.identity, this.lease, this.key, b.hash); if (blob) thumbs[b.hash] = URL.createObjectURL(new Blob([blob], { type: b.mime })); } catch { /* evicted after upload */ }
    }
    if (epoch !== this.memoryEpoch) { for (const url of Object.values(thumbs)) URL.revokeObjectURL(url); return; }
    this.set({ thumbs });
  }

  /** The snapshot the screens read: fresh server copy when online, else the stored one. */
  snapshot(): Snapshot | null {
    this.getState();
    const stored = this.state.local?.snapshot as Snapshot | null;
    const base = this.state.fresh ?? stored;
    if (!base) return null;
    return { ...base, display: base.display ?? stored?.display ?? this.state.boot?.display };
  }
  baseline(): Baseline {
    const local = this.state.local!; const entries = local.queue.entries;
    const saved = (local.queue.projection as { base?: Baseline })?.base;
    const fresh = this.state.fresh;
    const base = fresh && unsentCount(entries) === 0 && !entries.some((e) => e.status === 'conflict') ? baselineOf(fresh, this.state.freshSeq) : saved ?? baselineOf(local.snapshot as Snapshot, 0);
    return predictRevisions(base, entries);
  }
  model() {
    const s = this.snapshot(); const local = this.state.local;
    if (!s || !local) return null;
    return buildModel(s, local.queue.entries, local.blobs, this.state.draft, this.state.fresh ? this.state.freshSeq : 0);
  }
  private projection(draft = this.state.draft) {
    const local = this.state.local!; const fresh = this.state.fresh;
    const base = fresh && unsentCount(local.queue.entries) === 0 ? baselineOf(fresh, this.state.freshSeq) : (local.queue.projection as { base?: Baseline })?.base;
    return { v: 1, draft, ...(base ? { base } : {}) };
  }

  /** Durable write first; the ✓ and haptic tick follow the resolved commit (§6.1). */
  private commit(build: (q: QueueState, b: Baseline) => Promise<import('../queue.ts').ConsultOp>, label: string, draft?: EvidenceDraft) {
    const next = this.writes.then(()=>this.commitWrite(build,label,draft));
    this.writes=next.catch(()=>undefined);
    return next;
  }
  private async commitWrite(build: (q: QueueState, b: Baseline) => Promise<import('../queue.ts').ConsultOp>, label: string, draft?: EvidenceDraft) {
    if (!this.engine || !this.state.local) throw new Error('not_prepared');
    if (this.state.storageFull) throw new Error('storage_full');
    const q = this.state.local.queue;
    const op = await build(q, this.baseline());
    try {
      await this.engine.capture(op, this.projection(draft ?? this.state.draft));
    } catch (e) {
      const code = codeOf(e);
      if (/storage|quota|abort/i.test(code)) this.set({ storageFull: true });
      throw e;
    }
    const local = this.engine.read();
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    this.set({ local, lastSaved: label, ...(draft ? { draft } : {}) });
    this.schedule(0);
    return op;
  }

  async start() {
    const snap = this.snapshot(); if (!snap) return;
    await this.commit((q, b) => startOp(q, this.state.device, b), 'Start visit');
    await this.ensureRequiredInstances();
    this.set({ phase: 'visit' });
  }
  /** Serialize against all local writes; recompute from durable state inside the lock. */
  ensureRequiredInstances(): Promise<void> {
    if (this.initializing) return this.initializing;
    const next = this.writes.then(async () => {
      const snap = this.snapshot(), model = this.model();
      if (!snap || !model || !model.started || ['complete','needs_finishing','cancelled'].includes(model.status) || !this.engine || this.state.local?.queue.blocked || this.state.local?.close_intent) return;
      this.set({busy:true,code:null});
      try {
        let q = this.state.local!.queue;
        let base = this.baseline();
        const ops: import('../queue.ts').ConsultOp[] = [];
        const append = async (build: (q: QueueState,b: Baseline) => Promise<import('../queue.ts').ConsultOp>, _label: string) => {
          const op = await build(q,base); ops.push(op);
          q = enqueue(q,op,this.projection());
          base = predictRevisions(base,[q.entries[q.entries.length-1]]);
          return op;
        };
        // One instance for each required once-module, `min` for required repeats, presets for selections.
        for (const slot of [...model.slots].sort((a,b) => Number(a.module.key === 'selections') - Number(b.module.key === 'selections'))) {
          if (!slot.required) continue;
          const parentId = slot.parent ? model.sections.find(s=>s.module.key===slot.parent)?.instance.id ?? ops.filter(op=>op.type==='create_instance').map(op=>op.target as {module_key:string;instance_id:string}).find(t=>t.module_key===slot.parent)?.instance_id : undefined;
          if (slot.parent && !parentId) continue;
          const presets = slot.presets ?? [];
          const existing = model.sections.filter(s=>s.module.key===slot.module.key);
          for (const [index,preset] of presets.entries()) {
            const section=existing.find(s=>s.instance.label===String(preset.decision)) ?? existing[index];
            if (!section) continue;
            for (const [field,value] of Object.entries(preset)) {
              const def=slot.module.fields.find(f=>f.key===field);
              if (def && !section.fields.some(f=>f.key===field && f.answer)) await append((q,b)=>answerOp(q,this.state.device,b,section.instance.id,field,{status:'answered',value,unit:def.unit}),def.label);
            }
          }
          const need = Math.max(slot.minimum, presets.length) - slot.live;
          for (let i = 0; i < need; i++) {
            const preset = presets[slot.live + i] as Record<string, unknown> | undefined;
            // r4 R4-8: the area of the template this instance exists for ("Room 1 — Bath", "Room 2 — Kitchen");
            // none for house-wide modules ("Electrical panel 1") or past the templates' minimums.
            const area = HOUSE_WIDE.has(slot.module.key) ? undefined : model.templates.flatMap(t=>Array.from({length:t.modules.find(m=>m.module===slot.module.key)?.min??0},()=>t.title))[slot.live+i];
            const areaWord = area === "Bathroom" ? "Bath" : (area ?? "");
            const base = `${moduleNoun(slot.module)} ${slot.live + i + 1}`;
            const label = preset?.decision ? String(preset.decision) : slot.module.repeatable ? (areaWord && !base.toLowerCase().includes(areaWord.toLowerCase()) ? `${base} — ${areaWord}` : base) : slot.module.title;
            const op = await append((q, b) => createInstanceOp(q, this.state.device, b, slot.module.key, label, parentId), label);
            const defaults: Record<string, unknown> = slot.module.key === 'era' ? Object.fromEntries(Object.entries({firm_cert_number:snap.prefill?.firm_cert_number,firm_cert_expiry:snap.prefill?.firm_cert_expiry}).filter(([,v])=>!!v)) : {};
            for (const [field, value] of Object.entries({...defaults,...preset})) {
              const def = slot.module.fields.find((f) => f.key === field); if (!def) continue;
              const id = (op.target as { instance_id: string }).instance_id;
              await append((q, b) => answerOp(q, this.state.device, b, id, field, { status: 'answered', value, unit: def.unit }), def.label);
            }
          }
        }

        if (ops.length) {
          await this.engine.captureBatch(ops,this.projection());
          this.set({local:this.engine.read(),lastSaved:'Required sections'});
          this.schedule(0);
        }
      } catch(e) { this.set({code:codeOf(e)}); throw e; }
      finally { this.set({busy:false}); }
    });
    this.writes = next.catch(()=>undefined);
    this.initializing = next.finally(()=>{this.initializing=null;});
    return this.initializing;
  }
  /** Used by both client view and promised-date actions, including damaged old visits. */
  async ensureClosing(): Promise<string> {
    await this.ensureRequiredInstances();
    let section = this.model()?.sections.find(s=>s.module.key==='closing');
    if (!section) { await this.addInstance('closing','Closing'); section=this.model()?.sections.find(s=>s.module.key==='closing'); }
    if (!section) throw new Error('closing_missing');
    return section.instance.id;
  }

  shownSummary: string | null = null;
  async answer(instance_id: string, field_key: string, label: string, payload: AnswerPayload, draft?: EvidenceDraft) {
    if (field_key === "summary") throw new Error("summary_read_only");
    if (field_key === "client_initials" && payload.status === "skipped" && this.shownSummary) payload = {...payload,summary_text:this.shownSummary};
    const op = await this.commit((q, b) => answerOp(q, this.state.device, b, instance_id, field_key, payload), label, draft);
    if (field_key === 'frost_zone' && payload.status === 'answered') { const zone=frostZones.find(z=>z.label===payload.value); if(zone) await this.answer(instance_id,'required_depth','Footing depth the city requires',{status:'answered',value:zone.depth}); }
    await this.ensureRequiredInstances();
    return op;
  }
  addInstance(module_key: string, label: string, parent_id?: string | null) {
    return this.commit((q, b) => createInstanceOp(q, this.state.device, b, module_key, label, parent_id), label);
  }
  removeInstance(instance_id: string, label: string) { return this.commit((q, b) => removeInstanceOp(q, this.state.device, b, instance_id), label); }
  resolve(instance_id: string, field_key: string, currentRevision: number, current: string, proposed: string, answer: AnswerPayload, label: string) {
    if(field_key==='summary')return Promise.reject(new Error('summary_read_only'));
    return this.commit((q) => resolveOp(q, this.state.device, instance_id, field_key, currentRevision, current, proposed, 'Picked on the visit device', answer), label);
  }
  discard(eventId: string, reason: string) {
    const e = this.state.local?.queue.entries.find((x) => x.op.client_event_id === eventId); if (!e) return Promise.resolve(null);
    return this.commit((q, b) => discardOp(q, this.state.device, b, e.op, reason), 'Removed');
  }
  /** Every local decision is a durable, independently receipted sync operation. */
  setDraft(draft: EvidenceDraft) {
    const next=this.writes.then(async()=>{
      if(new TextEncoder().encode(JSON.stringify(draft)).length>1800000)throw new Error('evidence_too_large');
      const previous=this.state.draft;
      if(!this.engine || !this.state.local)throw new Error('not_prepared');
      let q=this.state.local.queue; const base=this.baseline(), ops=[];
      for(const patch of decisionPatches(previous,draft)){
        const op=await decisionsOp(q,this.state.device,base,patch);
        q=enqueue(q,op,this.projection(draft));ops.push(op);base.rev++;
      }
      await this.engine.captureBatch(ops,this.projection(draft));
      this.set({local:this.engine.read(),draft,lastSaved:'Decision'});this.schedule(0);
      return true;
    });
    this.writes=next.catch(()=>undefined);
    return next.catch(e=>{this.set({code:codeOf(e)});return false;});
  }

  async photo(file: Blob, meta: { instance_id: string; field_key?: string; shot_key?: string; kind?: 'photo' | 'initials' }, label: string, summaryText?: string) {
    if (!this.engine) throw new Error('not_prepared');
    if (this.state.storageFull) throw new Error('storage_full');
    const blob = meta.kind === 'initials' ? file : await preparePhoto(file);
    const hash = await sha256(blob);
    const metadata: LocalBlob = { hash, event_id: uuid(), mime: meta.kind === 'initials' ? 'image/png' : blob.type === 'image/png' || blob.type === 'image/webp' ? blob.type : 'image/jpeg', kind: meta.kind ?? 'photo', instance_id: meta.instance_id, ...(meta.field_key ? { field_key: meta.field_key } : {}), ...(summaryText!==undefined&&meta.field_key==="client_initials"?{summary_text:summaryText}:{}), ...(meta.shot_key ? { shot_key: meta.shot_key } : {}) };
    try { await this.engine.captureBlob(blob, metadata,undefined,this.projection()); } catch (e) { if (/storage|quota/i.test(codeOf(e))) this.set({ storageFull: true }); throw e; }
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    this.set({ local: this.engine.read(), lastSaved: label, thumbs: { ...this.state.thumbs, [hash]: URL.createObjectURL(blob) } });
    this.schedule(0);
    return metadata;
  }

  /** Send now / online / timer. One drain at a time; batches until nothing sendable is left. */
  drain(force = false): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    const running = this.drainWork(force);
    this.drainPromise = running.finally(()=>{this.drainPromise=null;});
    return this.drainPromise;
  }
  private async drainWork(force: boolean) {
    if (!this.engine || this.disposed) { const lastSendFailure={code:this.disposed?'controller_disposed':'not_prepared',at:Date.now()}; this.state={...this.state,lastSendFailure};this.set({lastSendFailure});return; }
    if (!navigator.onLine && !force) { this.set({ online: false, lastSendFailure: { code: 'no_signal', at: Date.now() } }); return; }
    this.set({ sending: true });
    try {
      for (let i = 0; i < 20; i++) {
        const before = JSON.stringify(this.engine.read()?.queue.entries.map((e) => e.status));
        const blobsBefore = this.engine.read()?.blobs.filter((b) => !b.receipt).length;
        await this.engine.replay();
        if (this.engine.lastSendFailure) this.set({lastSendFailure:this.engine.lastSendFailure});
        const local = this.engine.read();
        this.set({ local, lastSendFailure: local?.last_send_failure ?? null, online: true, blocked: local?.queue.blocked ?? null });
        if (!local || local.queue.blocked) break;
        const after = JSON.stringify(local.queue.entries.map((e) => e.status));
        const sendable = local.queue.entries.some((e) => e.status === 'pending' && e.next_at <= Date.now());
        if (!sendable && local.blobs.filter((b) => !b.receipt).length === 0) break;
        if (before === after && blobsBefore === local.blobs.filter((b) => !b.receipt).length) break;
      }
      await this.refresh();
      if (this.engine?.read()?.close_intent && !this.closing) await this.resumeClose();
    } catch (e) {
      const code = codeOf(e);
      const last = this.engine?.lastSendFailure ?? this.state.lastSendFailure;
      if (code === 'offline_locked' && last?.code === 'device_access_denied') {
        // Another device holds this visit: keep that code so the screen says so (§5.7), not "access removed".
        this.deny('device_access_denied');
        this.set({ lastSendFailure: last, code: 'device_access_denied' });
        return;
      }
      if (code === 'offline_locked') {
        const blocked = /revoked|access_denied/.test(last?.code ?? '') ? 'revoked' : this.state.local?.queue.blocked ?? 'signed_out';
        this.deny(blocked);
      } else this.set({ online: code !== 'no_signal' ? this.state.online : false });
      this.set({ lastSendFailure: { code, at: Date.now() }, code });
    } finally {
      this.set({ sending: false });
      const local = this.state.local;
      const next = local?.queue.entries.filter((e) => e.status === 'pending').map((e) => e.next_at).sort((a, b) => a - b)[0];
      if (next !== undefined) this.schedule(Math.max(2000, next - Date.now()));
      const failure = this.state.lastSendFailure?.code;
      if (!local?.blobs.some(b=>!b.receipt)) this.uploadAttempts=0;
      else if (!local.queue.blocked && failure && (transientClose(failure) || /^upload_(408|429|5\d\d)$/.test(failure)))
        this.schedule(Math.min(60_000,2000 * 2 ** Math.min(this.uploadAttempts++,5)));
    }
  }
  private closeAttempts = 0;
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.drain(); }, ms); }

  /** Refresh the durable baseline while retaining local operations, drafts and evidence intent. */
  private refreshPromise: Promise<void> | null = null;
  refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refreshWork().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  private async refreshWork() {
    const epoch = this.memoryEpoch;
    try {
      const r = await deadlineFetch(fetch,`/api/consult/${this.state.consultId}`, { credentials: 'same-origin', cache: 'no-store' });
      if (epoch !== this.memoryEpoch) return;
      if (r.status === 401 || r.status === 403) { this.deny(r.status === 401 ? 'signed_out' : 'revoked'); return; }
      if (!r.ok) return;
      const fresh = (await r.json()) as Snapshot;
      const entries = this.state.local?.queue.entries ?? [];
      const freshSeq = entries.filter((e) => e.status === 'accepted').reduce((m, e) => Math.max(m, e.op.seq), 0);
      if (epoch !== this.memoryEpoch) return;
      await this.engine?.refreshSnapshot(fresh);
      if (epoch !== this.memoryEpoch) return;
      const local = this.engine?.read();
      this.set({ fresh, freshSeq, online: true, ...(local ? {local,
        draft: (local.queue.projection as {draft?:EvidenceDraft}).draft ?? fresh.decisions ?? emptyDraft()} : {}) });
      if (this.state.local) await this.ensureRequiredInstances();
    } catch (e) { if (epoch !== this.memoryEpoch) return; if (offlineError(e)) this.set({ online: false }); else this.set({lastSendFailure:{code:codeOf(e),at:Date.now()}}); }
  }

  /** §5.5 close: drain → evidence → exact manifest → server Complete / Needs finishing. */
  async close(evidence: Record<string, unknown> | null) {
    if (!this.engine) return;
    const engine=this.engine, epoch=this.memoryEpoch;
    if (!this.engine.read()?.close_intent) await engine.saveCloseIntent(evidence);
    if(this.engine!==engine||this.memoryEpoch!==epoch)return;
    this.set({ local: this.engine.read(), closing: { step: 'sending' } });
    if (!navigator.onLine) { this.set({closing:{step:'waiting_signal'}}); return; }
    if (this.closeTimer) clearTimeout(this.closeTimer);

    await this.drain(true);
    if(this.engine!==engine||this.memoryEpoch!==epoch)return;
    if (this.engine?.read()?.close_intent) await this.resumeClose();
  }
  private closeToken: object | null = null;
  private async resumeClose() {
    if (!this.engine || this.closing) return;
    if(this.closeTimer)clearTimeout(this.closeTimer);
    const paused=this.engine.read()?.close_intent;
    if(paused?.paused){
      if (['conflict','stale_snapshot'].includes(paused.paused) && Date.now()-(paused.started_at??Date.now())<30*60_000) { this.closeTimer=setTimeout(()=>{void this.resumeClose();},60_000); return; }
      if(!paused.notified)try{
        await post(this.state.consultId,'report_close_failure',{reason:paused.paused});
        await this.engine.pauseClose(paused.paused,true);
      }catch{this.closeTimer=setTimeout(()=>{void this.resumeClose();},60_000);}
      return;
    }
    const engine = this.engine, epoch = this.memoryEpoch, token = {};
    this.closeToken = token;
    const owns = () => {
      if(this.closeToken!==token||this.memoryEpoch!==epoch||this.engine!==engine||this.disposed)return false;
      try { engine.read(); return true; } catch { this.lock(); return false; }
    };
    const evidence = engine.read()?.close_intent?.evidence ?? null;
    this.closing = true;
    if (!navigator.onLine) { this.closing = false; this.set({ closing: { step: 'waiting_signal' } }); return; }
    let local = this.engine.read();
    if (!local) { this.closing = false; return; }
    if (unsentCount(local.queue.entries) > 0 || local.blobs.some((b) => !b.receipt)) { this.set({ closing: { step: navigator.onLine ? 'error' : 'waiting_signal', code: 'manifest_sequence_gap' } }); this.closing = false; return; }
    this.set({ closing: { step: 'closing' } });
    try {
      await this.refresh();
      if (!owns()) return;
      local = engine.read()!;
      if (unsentCount(local.queue.entries)>0) throw new Error('rebase_required');
      if(evidence && !local.close_intent?.request && local.close_intent?.baseline_hash && local.close_intent.baseline_hash !== (local.snapshot as Snapshot).close_evidence_hash) {
        if(!local.close_intent.evidence_started || !('baseline_evidence' in local.close_intent) || await payloadHash(local.close_intent.baseline_evidence??null)!==local.close_intent.baseline_hash)throw new Error('evidence_conflict');
        let prefix=local.close_intent.baseline_evidence??null;
        let matches=false;
        for(const patch of evidencePatches(prefix,evidence)){
          prefix=mergeEvidence(prefix,patch);
          if(await payloadHash(prefix)===(local.snapshot as Snapshot).close_evidence_hash)matches=true;
        }
        if(!matches)throw new Error('evidence_conflict');
      }
      let revision = Number((this.state.fresh ?? local.snapshot as Snapshot).consult.revision);
      const localSnapshot = local.snapshot as Snapshot;
      if (evidence && !local.close_intent?.request) {
        await engine.markEvidenceStarted?.();
        let baseline = localSnapshot.close_evidence ?? null;
        for (const patch of evidencePatches(baseline, evidence)) {
          const r = await post(this.state.consultId, 'evidence', {map_patch:true,device:this.state.device,epoch:local.queue.device_epoch,expected_revision:revision,generation:local.queue.generation,baseline_hash:await payloadHash(baseline),evidence:patch});
          if (!owns()) return;
          revision=Number(r.revision);
          baseline=mergeEvidence(baseline,patch);
        }
      }
      const blobs = manifestBlobs(local.blobs);
      const manifest = { ...closeManifest({ ...local.queue, blocked: null }, this.state.device, blobs.photos, blobs.initials), local_pending: 0 };
      const request = local.close_intent?.request ?? { expected_revision: revision, manifest };
      if (!owns()) return;
      await engine.saveCloseRequest(request);
      if (!owns()) return;
      const result = (await post(this.state.consultId, 'close', request)) as unknown as CloseResult;
      if (!owns()) return;
      await this.refresh();
      if (!owns()) return;
      await engine.clearCloseIntent(request);
      if (!owns()) return;
      this.closeAttempts = 0;
      if(this.closeTimer)clearTimeout(this.closeTimer);
      this.set({ local: this.engine?.read() ?? null, closing: { step: 'done', result } });
    } catch (e) {
      if (!owns()) return;
      const rawCode = codeOf(e), code = transientClose(rawCode) && rawCode !== 'no_signal' ? 'close_timeout' : rawCode;
      const field = refusalField(e);
      this.set({ local: this.engine?.read() ?? null, closing: { step: code === 'no_signal' ? 'waiting_signal' : 'error', code, ...(field ? { field } : {}) } });
      if (!transientClose(rawCode)) await engine.pauseClose(rawCode);
      if (!engine.read()?.close_intent?.notified && (!transientClose(rawCode) && !['conflict','stale_snapshot'].includes(rawCode) || Date.now()-(local.close_intent?.started_at??Date.now())>=30*60_000)) {
        try { await post(this.state.consultId,'report_close_failure',{reason:rawCode});
          if(owns()) { await engine.pauseClose(transientClose(rawCode)?'':rawCode,true); this.set({closing:{step:'error',code,ownerNotified:true,...(field?{field}:{})}}); }
        } catch { /* Keep the intent and retry reporting when connectivity returns. */ }
      }
      if (!transientClose(rawCode) && !engine.read()?.close_intent?.notified) this.closeTimer=setTimeout(()=>{void this.resumeClose();},60_000);
      if (transientClose(rawCode)) this.closeTimer=setTimeout(()=>{void this.drain();},Math.min(60_000,2000*2**Math.min(this.closeAttempts++,5)));
    } finally { if (owns()) { this.closing = false; this.closeToken = null; } }
  }
  dismissClosing() { this.set({ closing: null }); }
  /** r10 R10-1: the office refused the close, so the visit is not closed. Drop the close (answers
   *  stay in the queue and the draft) so no retry pops this screen back up; the next close starts fresh. */
  async abandonClose() {
    this.closeToken = null; this.closing = false;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    await this.engine?.clearCloseIntent();
    this.set({ local: this.engine?.read() ?? null, closing: null });
  }
  /** r10 R10-1: Send now, then close again — the refused request is dropped and a fresh one is built. */
  async closeAgain() {
    this.closeToken = null; this.closing = false;
    await this.engine?.clearCloseRequest();
    this.set({ local: this.engine?.read() ?? null, closing: { step: 'sending' } });
    await this.drain(true);
    // A drain already running may have passed its close step; make sure this close is tried.
    if (this.engine?.read()?.close_intent && !this.closing && this.state.closing?.step === 'sending') await this.resumeClose();
  }

  /** Reopen with a reason (Joe or the assigned visitor). Old queued work becomes an explicit pick. */
  async reopen(reason: string) {
    const fresh = this.state.fresh; if (!fresh) throw new Error('no_signal');
    const r = await post(this.state.consultId, 'reopen', { expected_revision: Number(fresh.consult.revision), reason });
    await this.refresh();
    const s = this.state.fresh!;
    if (this.engine) {
      const q = this.engine.read()!.queue;
      await this.engine.epochs(Number(r.generation ?? s.consult.completion_generation), q.device_epoch, Number(s.consult.deletion_epoch ?? q.deletion_epoch));
      this.set({ local: this.engine.read() });
    }
    this.set({ closing: null });
  }
  async applyFindings() {
    const fresh = this.state.fresh; if (!fresh) return;
    this.set({ findingsCode: null });
    try { await post(this.state.consultId, 'apply_findings', { expected_generation: Number(fresh.consult.completion_generation), operation_id: uuid() }); await this.refresh(); }
    catch (e) { this.set({ findingsCode: codeOf(e) === 'no_signal' ? 'no_signal' : 'findings_failed' }); }
  }

  /** Hand back by PIN (§6.4): same visitor PIN as the device unlock; wrong tries back off. */
  /** Hand back with PIN: true, or why not (r6: a right PIN right after a wrong one is no longer refused). */
  async verifyPin(pin: string): Promise<true | string> {
    const { identity, device } = this.state;
    if (!identity || !this.store) return 'not_prepared';
    try { return await new OfflineVault(this.store).checkPin(identity, device, pin); } catch { return 'invalid_pin'; }
  }
  /** "Lock notes on this device": drop decrypted memory, keep ciphertext for the same user. */
  private deny(code: string) { this.lock(); this.set({ phase: 'blocked', blocked: code === 'revoked' || code === 'device_access_denied' ? 'revoked' : 'signed_out', code }); }
  lock() { this.shownSummary = null; this.closeToken = null; this.closing = false; this.memoryEpoch++; if(this.closeTimer)clearTimeout(this.closeTimer); if (this.expiryTimer) clearTimeout(this.expiryTimer); this.engine?.lock(); this.engine = null; this.key = null; this.lease = null; for (const url of Object.values(this.state.thumbs)) URL.revokeObjectURL(url); this.set({ local: null, fresh: null, freshSeq: 0, draft: emptyDraft(), boot: null, thumbs: {}, closing: null, lastSaved: null, phase: this.state.enrolled ? 'unlock' : 'get_ready' }); }
  dispose() {
    this.lock();
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('online', this.onOnline); window.removeEventListener('offline', this.onOffline); document.removeEventListener('visibilitychange', this.onHide);
    this.engine?.logout(); this.engine = null; this.key = null; this.lease = null;
    for (const url of Object.values(this.state.thumbs)) URL.revokeObjectURL(url);
  }
}
