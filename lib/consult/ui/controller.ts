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
import { closeManifest, type QueueState } from '../queue.ts';
import { registerConsultWorker, type PrecacheManifest } from '../service-worker.ts';
import type { ReadyCheck, CheckResult } from '../readiness.ts';
import { baselineOf, buildModel, emptyDraft, manifestBlobs, predictRevisions, unsentCount, type Baseline, type Display, type EvidenceDraft, type Snapshot } from './model.ts';
import { decisionsOp, answerOp, createInstanceOp, discardOp, removeInstanceOp, resolveOp, startOp, uuid, type AnswerPayload } from './ops.ts';

export interface Boot {
  consult_id: string; user: { id: string; name: string; role: string }; session_epoch: number;
  display: Display; auto_apply: boolean; capture_enabled: boolean; home: string;
}
export type Phase = 'loading' | 'get_ready' | 'unlock' | 'visit' | 'blocked' | 'disabled';
export type ReadyResult = 'idle' | 'checking' | 'ready' | 'not_ready' | 'no_signal';
export interface CloseResult { complete: boolean; checks: { check: number; code: string; open: string[] }[]; price_critical: { total: number; done: number; skipped: number }; record: { total: number; done: number; skipped: number }; revision: number }
export interface ClosingState { step: 'sending' | 'closing' | 'done' | 'error' | 'waiting_signal'; result?: CloseResult; code?: string }
export interface State {
  phase: Phase; online: boolean; boot: Boot | null; consultId: string; identity: OfflineIdentity | null; device: string;
  enrolled: boolean; olderBuild: boolean; leaseExpires: number | null;
  ready: { result: ReadyResult; checks: Partial<Record<ReadyCheck, CheckResult>>; failed?: ReadyCheck; code?: string };
  local: LocalVisit | null; fresh: Snapshot | null; freshSeq: number; draft: EvidenceDraft;
  blocked: QueueState['blocked']; code: string | null; sending: boolean; lastSaved: string | null; storageFull: boolean;
  closing: ClosingState | null; thumbs: Record<string, string>; busy: boolean; findingsCode: string | null;
}

const DEVICE_KEY = 'sjcos-consult-device';
const NEEDED_BYTES = 50 * 1024 * 1024;
const post = async (consultId: string, command: string, input: unknown) => {
  const r = await fetch(`/api/consult/${consultId}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Consult-CSRF': '1' }, body: JSON.stringify({ command, input }) });
  let body: Record<string, unknown> = {};
  try { body = await r.json(); } catch { /* empty body */ }
  if (!r.ok || body.ok === false) throw new Error(String(body.error_code ?? body.code ?? (r.status === 401 ? 'signed_out' : r.status === 403 ? 'access_denied' : 'invalid_command')));
  return body;
};
const offlineError = (e: unknown) => e instanceof TypeError || (e instanceof Error && /Failed to fetch|NetworkError|Load failed|network/i.test(e.message));
const codeOf = (e: unknown) => (offlineError(e) ? 'no_signal' : e instanceof Error ? e.message : 'unknown');

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
  private draining = false;
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(boot: Boot | null, consultId: string) {
    this.state = {
      phase: 'loading', online: typeof navigator === 'undefined' ? true : navigator.onLine, boot, consultId, identity: null, device: '', enrolled: false, olderBuild: false, leaseExpires: null,
      ready: { result: 'idle', checks: {} }, local: null, fresh: null, freshSeq: 0, draft: emptyDraft(), blocked: null, code: null,
      sending: false, lastSaved: null, storageFull: false, closing: null, thumbs: {}, busy: false, findingsCode: null,
    };
  }
  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(patch: Partial<State>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }

  private onOnline = () => { this.set({ online: true }); void this.drain(); };
  private onOffline = () => this.set({ online: false });
  private onHide = () => { if (document.visibilityState === 'hidden') void this.drain(); };

  async init() {
    this.disposed = false;
    window.addEventListener('online', this.onOnline); window.addEventListener('offline', this.onOffline); document.addEventListener('visibilitychange', this.onHide);
    const device = deviceId();
    const { boot, consultId } = this.state;
    if (boot && !boot.capture_enabled) {
      if ('serviceWorker' in navigator) await registerConsultWorker(false).catch(() => null);
      this.set({ device, phase: 'disabled', code: 'capture_disabled' }); return;
    }
    try { this.store = await ConsultOfflineStore.open(); } catch { this.store = null; }
    if (boot) {
      try { const r = await fetch('/consult/precache.json', { cache: 'no-store', credentials: 'omit' }); if (r.ok) this.manifest = await r.json(); } catch { /* offline pages check reports it */ }
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
    try { if (!this.manifest) { const r = await fetch('/consult/precache.json', { cache: 'no-store', credentials: 'omit' }); if (r.ok) this.manifest = await r.json(); } } catch (e) { if (offlineError(e)) { this.set({ ready: { result: 'no_signal', checks: {} } }); return; } }
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
    this.afterUnlock();
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
      this.afterUnlock();
    } catch (e) {
      const code = codeOf(e);
      if (code === 'offline_locked' && this.state.boot && !this.state.olderBuild) { this.set({ busy: false, phase: 'get_ready', code: null }); return; }
      this.set({ busy: false, code, ...(code === 'offline_quarantined' ? { phase: 'blocked' as Phase, blocked: 'revoked' as const } : code === 'offline_locked' ? { phase: 'blocked' as Phase, blocked: 'signed_out' as const } : {}) });
    }
  }

  private afterUnlock() {
    const local = this.engine!.read();
    const draft = (local?.queue.projection as { draft?: EvidenceDraft })?.draft ?? (local?.snapshot as Snapshot)?.decisions ?? emptyDraft();
    this.set({ local, draft, phase: local?.queue.blocked ? 'blocked' : 'visit', blocked: local?.queue.blocked ?? null, code: local?.queue.blocked ?? null });
    void this.loadThumbs();
    void this.drain();
  }

  private async loadThumbs() {
    const local = this.state.local; if (!local || !this.key || !this.lease || !this.store || !this.state.identity) return;
    const thumbs = { ...this.state.thumbs };
    for (const b of local.blobs) {
      if (thumbs[b.hash]) continue;
      try { const blob = await this.store.loadBlob(this.state.identity, this.lease, this.key, b.hash); if (blob) thumbs[b.hash] = URL.createObjectURL(new Blob([blob], { type: b.mime })); } catch { /* evicted after upload */ }
    }
    this.set({ thumbs });
  }

  /** The snapshot the screens read: fresh server copy when online, else the stored one. */
  snapshot(): Snapshot | null {
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
    const model = this.model()!;
    await this.commit((q, b) => startOp(q, this.state.device, b), 'Start visit');
    // One instance for each required once-module, `min` for required repeats, presets for selections.
    for (const slot of model.slots) {
      if (!slot.required || slot.parent) continue;
      const tmpl = model.templates.flatMap((t) => t.modules).find((m) => m.module === slot.module.key);
      const presets = tmpl?.presets ?? [];
      const need = Math.max(slot.minimum, presets.length) - slot.live;
      for (let i = 0; i < need; i++) {
        const preset = presets[slot.live + i] as Record<string, unknown> | undefined;
        const label = preset?.decision ? String(preset.decision) : slot.module.repeatable ? `${slot.module.title} ${slot.live + i + 1}` : slot.module.title;
        const op = await this.commit((q, b) => createInstanceOp(q, this.state.device, b, slot.module.key, label), label);
        if (preset) for (const [field, value] of Object.entries(preset)) {
          const def = slot.module.fields.find((f) => f.key === field); if (!def) continue;
          const id = (op.target as { instance_id: string }).instance_id;
          await this.commit((q, b) => answerOp(q, this.state.device, b, id, field, { status: 'answered', value, unit: def.unit }), def.label);
        }
      }
    }
    this.set({ phase: 'visit' });
  }

  answer(instance_id: string, field_key: string, label: string, payload: AnswerPayload, draft?: EvidenceDraft) {
    return this.commit((q, b) => answerOp(q, this.state.device, b, instance_id, field_key, payload), label, draft);
  }
  addInstance(module_key: string, label: string, parent_id?: string | null) {
    return this.commit((q, b) => createInstanceOp(q, this.state.device, b, module_key, label, parent_id), label);
  }
  removeInstance(instance_id: string, label: string) { return this.commit((q, b) => removeInstanceOp(q, this.state.device, b, instance_id), label); }
  resolve(instance_id: string, field_key: string, currentRevision: number, current: string, proposed: string, answer: AnswerPayload, label: string) {
    return this.commit((q) => resolveOp(q, this.state.device, instance_id, field_key, currentRevision, current, proposed, 'Picked on the visit device', answer), label);
  }
  discard(eventId: string, reason: string) {
    const e = this.state.local?.queue.entries.find((x) => x.op.client_event_id === eventId); if (!e) return Promise.resolve(null);
    return this.commit((q, b) => discardOp(q, this.state.device, b, e.op, reason), 'Removed');
  }
  /** Every local decision is a durable, independently receipted sync operation. */
  setDraft(draft: EvidenceDraft) { this.set({code:null});return this.commit((q,b)=>decisionsOp(q,this.state.device,b,draft), 'Decision', draft).then(()=>true).catch(e=>{this.set({code:codeOf(e)});return false;}); }

  async photo(file: Blob, meta: { instance_id: string; field_key?: string; shot_key?: string; kind?: 'photo' | 'initials' }, label: string) {
    if (!this.engine) throw new Error('not_prepared');
    if (this.state.storageFull) throw new Error('storage_full');
    const blob = meta.kind === 'initials' ? file : await preparePhoto(file);
    const hash = await sha256(blob);
    const metadata: LocalBlob = { hash, event_id: uuid(), mime: meta.kind === 'initials' ? 'image/png' : blob.type === 'image/png' || blob.type === 'image/webp' ? blob.type : 'image/jpeg', kind: meta.kind ?? 'photo', instance_id: meta.instance_id, ...(meta.field_key ? { field_key: meta.field_key } : {}), ...(meta.shot_key ? { shot_key: meta.shot_key } : {}) };
    try { await this.engine.captureBlob(blob, metadata); } catch (e) { if (/storage|quota/i.test(codeOf(e))) this.set({ storageFull: true }); throw e; }
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    this.set({ local: this.engine.read(), lastSaved: label, thumbs: { ...this.state.thumbs, [hash]: URL.createObjectURL(blob) } });
    this.schedule(0);
    return metadata;
  }

  /** Send now / online / timer. One drain at a time; batches until nothing sendable is left. */
  async drain(force = false) {
    if (!this.engine || this.draining || this.disposed) return;
    if (!navigator.onLine && !force) { this.set({ online: false }); return; }
    this.draining = true; this.set({ sending: true });
    try {
      for (let i = 0; i < 20; i++) {
        const before = JSON.stringify(this.engine.read()?.queue.entries.map((e) => e.status));
        const blobsBefore = this.engine.read()?.blobs.filter((b) => !b.receipt).length;
        await this.engine.replay();
        const local = this.engine.read();
        this.set({ local, online: true, blocked: local?.queue.blocked ?? null });
        if (!local || local.queue.blocked) break;
        const after = JSON.stringify(local.queue.entries.map((e) => e.status));
        const sendable = local.queue.entries.some((e) => e.status === 'pending' && e.next_at <= Date.now());
        if (!sendable && local.blobs.filter((b) => !b.receipt).length === 0) break;
        if (before === after && blobsBefore === local.blobs.filter((b) => !b.receipt).length) break;
      }
      await this.refresh();
    } catch (e) {
      const code = codeOf(e);
      if (code === 'offline_locked') {
        const blocked = this.state.local?.queue.blocked ?? 'signed_out';
        this.set({ phase: 'blocked', blocked, code: blocked });
      } else this.set({ online: code !== 'no_signal' ? this.state.online : false });
    } finally {
      this.draining = false; this.set({ sending: false });
      const local = this.state.local;
      const next = local?.queue.entries.filter((e) => e.status === 'pending').map((e) => e.next_at).sort((a, b) => a - b)[0];
      if (next !== undefined) this.schedule(Math.max(2000, next - Date.now()));
    }
  }
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.drain(); }, ms); }

  /** Fresh authorized snapshot for display/baseline; never replaces durable pending state. */
  async refresh() {
    if (!this.state.boot) return;
    try {
      const r = await fetch(`/api/consult/${this.state.consultId}`, { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { this.set({ code: 'signed_out' }); return; }
      if (!r.ok) return;
      const fresh = (await r.json()) as Snapshot;
      const entries = this.state.local?.queue.entries ?? [];
      const freshSeq = entries.filter((e) => e.status === 'accepted').reduce((m, e) => Math.max(m, e.op.seq), 0);
      this.set({ fresh, freshSeq, online: true });
    } catch (e) { if (offlineError(e)) this.set({ online: false }); }
  }

  /** §5.5 close: drain → evidence → exact manifest → server Complete / Needs finishing. */
  async close(evidence: Record<string, unknown> | null) {
    if (!this.engine) return;
    this.set({ closing: { step: 'sending' } });
    if (!navigator.onLine) { this.set({ closing: { step: 'waiting_signal' } }); return; }
    await this.drain(true);
    const local = this.engine.read();
    if (!local) return;
    if (unsentCount(local.queue.entries) > 0 || local.blobs.some((b) => !b.receipt)) { this.set({ closing: { step: navigator.onLine ? 'error' : 'waiting_signal', code: 'manifest_sequence_gap' } }); return; }
    this.set({ closing: { step: 'closing' } });
    try {
      await this.refresh();
      let revision = Number(this.state.fresh!.consult.revision);
      if (evidence) {
        try { const r = await post(this.state.consultId, 'evidence', { device: this.state.device, epoch: local.queue.device_epoch, expected_revision: revision, evidence }); revision = Number(r.revision); }
        catch (e) { if (codeOf(e) === 'no_signal') throw e; /* evidence refused: the server's checks will name what is missing */ }
      }
      const blobs = manifestBlobs(local.blobs);
      const manifest = { ...closeManifest({ ...local.queue, blocked: null }, this.state.device, blobs.photos, blobs.initials), local_pending: 0 };
      const result = (await post(this.state.consultId, 'close', { expected_revision: revision, manifest })) as unknown as CloseResult;
      await this.refresh();
      this.set({ closing: { step: 'done', result } });
    } catch (e) {
      const code = codeOf(e);
      this.set({ closing: { step: code === 'no_signal' ? 'waiting_signal' : 'error', code } });
    }
  }
  dismissClosing() { this.set({ closing: null }); }

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
  async verifyPin(pin: string): Promise<boolean> {
    const { identity, device } = this.state;
    if (!identity || !this.store) return false;
    try { await new OfflineVault(this.store).unlock(identity, device, pin); return true; } catch { return false; }
  }
  /** "Lock notes on this device": drop decrypted memory, keep ciphertext for the same user. */
  lock() { this.engine?.lock(); this.engine = null; this.key = null; this.lease = null; for (const url of Object.values(this.state.thumbs)) URL.revokeObjectURL(url); this.set({ local: null, thumbs: {}, phase: this.state.enrolled ? 'unlock' : 'get_ready' }); }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('online', this.onOnline); window.removeEventListener('offline', this.onOffline); document.removeEventListener('visibilitychange', this.onHide);
    this.engine?.logout(); this.engine = null; this.key = null; this.lease = null;
    for (const url of Object.values(this.state.thumbs)) URL.revokeObjectURL(url);
  }
}
