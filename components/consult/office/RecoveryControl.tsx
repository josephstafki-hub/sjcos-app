"use client";
/**
 * Owner recovery (plan §5.7 "Staff access removed … Joe can recover them"). Runs on the
 * ORIGINAL device only, with the original visitor's PIN: the saved answers go back in as
 * proposals under their author, for a person to accept. The device's epoch comes from the
 * office's device list, so Joe never types an internal number. Photos still on the device
 * need their own recovery; the device is kept.
 */
import { useState } from "react";
import { deviceId, listEnrollments } from "@/lib/consult/ui/controller";
import { ConsultOfflineStore, type SignedLease } from "@/lib/consult/offline";
import { OfflineVault } from "@/lib/consult/offline-vault";
import type { LocalVisit } from "@/lib/consult/offline-engine";
import { Button } from "@/components/ui";
import { W, plainWords } from "@/lib/consult/ui/words";

export interface RecoveryDevice { device_id: string; epoch: number; user_id: string; user_name: string; closed: boolean; revoked: boolean }

export function RecoveryControl({ consultId, devices }: { consultId: string; devices: RecoveryDevice[] }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState(""); const [reason, setReason] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const field = "mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 text-[16px] text-ink";
  async function recover() {
    setBusy(true); setStatus(null); let store: ConsultOfflineStore | null = null;
    try {
      const here = deviceId();
      const e = (await listEnrollments()).find((x) => x.identity.consult_id === consultId && x.device === here);
      const row = e && devices.filter((d) => d.device_id === e.device && d.user_id === e.identity.user_id).sort((a, b) => b.epoch - a.epoch)[0];
      if (!e || !row) { setStatus({ ok: false, text: W.recoverNoCopy }); return; }
      const send = async (command: string, input: unknown) => {
        const r = await fetch(`/api/consult/${consultId}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Consult-CSRF": "1" }, body: JSON.stringify({ command, input }) });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || body.ok === false) throw new Error(body.error_code ?? body.code ?? "invalid_command");
        return body;
      };
      const base = { original_user: e.identity.user_id, device: e.device, epoch: row.epoch, reason: reason.trim() };
      const signed = await send("recovery_lease", { ...base, session_epoch: e.identity.session_epoch, build: e.identity.build }) as SignedLease;
      store = await ConsultOfflineStore.open();
      const recovered = await new OfflineVault(store).recover(e.identity, e.device, pin, signed);
      const local = recovered.saved?.value as LocalVisit | undefined;
      if (!local) throw new Error("not_prepared");
      const ops = local.queue.entries.filter((x) => x.status !== "accepted").map((x) => x.op);
      for (let offset = 0; offset < Math.max(1, ops.length); offset += 50)
        await send("recover_device", { ...base, epoch: local.queue.device_epoch, operation_id: crypto.randomUUID(), ops: ops.slice(offset, offset + 50), blobs: offset === 0 ? local.blobs : [] });
      setStatus({ ok: true, text: W.recoverDone }); setPin("");
    } catch (x) { setStatus({ ok: false, text: plainWords(x instanceof Error ? x.message : "") }); }
    finally { store?.close(); setBusy(false); }
  }
  // Only devices set aside by a move that never sent their close can hold unsent answers to recover.
  const open_ = devices.filter((d) => d.revoked && !d.closed);
  if (!open_.length) return null;
  return (
    <div className="rounded-md border border-rule bg-card p-3">
      <p className="text-body font-semibold text-ink">{W.recoverTitle} · {open_.length} waiting</p>
      <p className="mt-1 text-meta text-ink-3">{open_.map((d) => d.user_name).filter((n, i, a) => a.indexOf(n) === i).join(", ")} · {open_.length === 1 ? "unsent answers may still be on that device" : "unsent answers may still be on those devices"}</p>
      {!open ? <div className="mt-2"><Button variant="secondary" size="lg" onClick={() => setOpen(true)}>{W.recoverGo}…</Button></div> : (
        <form className="mt-2 grid gap-3" onSubmit={(e) => { e.preventDefault(); void recover(); }}>
          <p className="text-meta text-ink-3">{W.recoverLead}</p>
          <label className="block text-body"><span className="font-semibold text-ink">{W.recoverPin}</span>
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} className={field} /></label>
          <label className="block text-body"><span className="font-semibold text-ink">{W.recoverReason}</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} py-2`} /></label>
          {status && <p role={status.ok ? "status" : "alert"} className={`text-body font-semibold ${status.ok ? "text-accent-2" : "text-flag"}`}>{status.ok ? "✓ " : "! "}{status.text}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="lg" type="button" onClick={() => { setOpen(false); setStatus(null); }}>{W.cancel}</Button>
            <Button size="lg" type="submit" disabled={busy || !/^\d{6,12}$/.test(pin) || !reason.trim()}>{busy ? "Recovering…" : W.recoverGo}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
