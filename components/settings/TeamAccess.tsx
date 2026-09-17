"use client";

import { useState, type ReactNode } from "react";
import { KeyRound, Plus, ShieldCheck, X } from "lucide-react";
import { SubmitButton } from "@/components/ui";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { createUser, resetUserPassword, updateUserAccess, type UserActionResult } from "@/lib/actions/users";
import { runAction } from "@/lib/run-action";

// Team & roles controls: add a login, edit a team member's areas, reset a
// password. All owner-only (the Server Actions enforce it). The area catalog
// is lib/permissions.ts — this file only renders it.

const inputCls =
  "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const primaryBtn =
  "rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]";
const ghostBtn = "rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2";
const rowBtn =
  "inline-flex items-center gap-1 rounded-md border border-rule px-2 py-0.5 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-paper-2";

function TextInput({
  name,
  label,
  defaultValue,
  type = "text",
  required,
  placeholder,
  autoComplete,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={inputCls}
      />
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[8vh]" onClick={onClose}>
      <div
        className="max-h-[84vh] w-full max-w-[520px] overflow-y-auto rounded-lg border border-rule bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The area checkboxes. Posts one `perm` entry per ticked box. */
export function PermissionPicker({ selected }: { selected: readonly string[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const toggle = (k: PermissionKey) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const everyday = PERMISSIONS.filter((p) => !p.sensitive);
  const sensitive = PERMISSIONS.filter((p) => p.sensitive);

  const box = (p: (typeof PERMISSIONS)[number]) => (
    <label
      key={p.key}
      className={[
        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-snug transition-colors",
        picked.has(p.key)
          ? p.sensitive
            ? "border-flag/50 bg-flag/5"
            : "border-accent bg-accent-soft/40"
          : "border-rule-soft hover:bg-paper-2",
      ].join(" ")}
    >
      <input
        type="checkbox"
        name="perm"
        value={p.key}
        checked={picked.has(p.key)}
        onChange={() => toggle(p.key)}
        className="mt-0.5 accent-[var(--color-accent-2,#3d5a3c)]"
      />
      <span className="min-w-0">
        <span className="font-semibold text-ink">{p.label}</span>
        <span className="block text-[11px] text-ink-3">{p.description}</span>
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">What they can open</span>
        <span className="flex gap-2 text-[11px]">
          <button
            type="button"
            className="text-accent-2 hover:underline"
            onClick={() => setPicked(new Set(everyday.map((p) => p.key)))}
          >
            Everyday areas
          </button>
          <button type="button" className="text-ink-3 hover:underline" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{everyday.map(box)}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-flag">Sensitive</div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{sensitive.map(box)}</div>
    </div>
  );
}

/** Keeps a form's submitted values across a failed action so the owner's
 *  input survives the error (React resets the form after every action). */
function useKeptValues() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const keep = (formData: FormData) => {
    const kept: Record<string, string> = {};
    formData.forEach((v, k) => {
      if (typeof v === "string" && k !== "perm") kept[k] = v;
    });
    setVals(kept);
  };
  return { vals, keep, reset: () => setVals({}) };
}

/** Owner-only "Add user" button + modal. Team member (areas) or portal login. */
export function AddUserButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<"staff" | "sub" | "client" | "owner">("staff");
  const { vals, keep, reset } = useKeptValues();
  const val = (k: string) => vals[k] ?? "";

  async function handle(formData: FormData) {
    const res = await runAction(() => createUser(formData), { fallback: "Couldn't add the user." });
    if (res.ok) {
      setError(null);
      reset();
      setOpen(false);
    } else {
      keep(formData);
      setError(res.error ?? "Couldn't add the user.");
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
      >
        <Plus className="size-3" strokeWidth={1.5} />
        Add user
      </button>

      {open && (
        <Modal title="Add a user" onClose={() => setOpen(false)}>
          <form action={handle} className="flex flex-col gap-3 p-4">
            <TextInput name="name" label="Name" required placeholder="Marco Rivas" defaultValue={val("name")} />
            <TextInput name="email" label="Email" type="email" required placeholder="marco@…" defaultValue={val("email")} />
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Role</span>
                <select name="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={inputCls}>
                  <option value="staff">Team member — chosen areas</option>
                  <option value="sub">Sub — portal access</option>
                  <option value="client">Client — portal access</option>
                  <option value="owner">Owner — full app</option>
                </select>
              </label>
              {(role === "sub" || role === "client") && (
                <div className="flex-1">
                  <TextInput
                    name="link_slug"
                    label={role === "sub" ? "Sub slug" : "Project slug"}
                    placeholder={role === "sub" ? "marco" : "henderson"}
                    defaultValue={val("link_slug")}
                    required
                  />
                </div>
              )}
            </div>
            <TextInput
              name="password"
              label="Temp password"
              type="password"
              required
              placeholder="8+ characters — they can't change it themselves yet"
              defaultValue={val("password")}
              autoComplete="new-password"
            />

            {role === "staff" && <PermissionPicker selected={["today", "projects", "leads", "chat"]} />}
            {role === "owner" && (
              <div className="rounded-md border border-flag/40 bg-flag/5 px-3 py-2 text-[12px] text-ink-2">
                A second owner sees and can do everything, including Settings, Money and the AI panel. Use a team member
                with areas unless they really need all of it.
              </div>
            )}

            {error && <div className="text-[12px] text-flag">{error}</div>}

            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
                Cancel
              </button>
              <SubmitButton pendingLabel="Adding…" className={primaryBtn}>
                Add user
              </SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Per-row "Access" control for a team member: edit areas, reset password. */
export function StaffAccessButton({
  id,
  name,
  email,
  permissions,
}: {
  id: string;
  name: string;
  email: string;
  permissions: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function run(fn: () => Promise<UserActionResult>, fallback: string, okMsg: string, close: boolean) {
    setSaved(null);
    const res = await runAction(fn, { fallback });
    if (res.ok) {
      setError(null);
      if (close) setOpen(false);
      else setSaved(okMsg);
    } else {
      setError(res.error ?? fallback);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setSaved(null);
          setOpen(true);
        }}
        className={rowBtn}
      >
        <ShieldCheck className="size-3" strokeWidth={1.5} />
        Access
      </button>

      {open && (
        <Modal title={`${name} · access`} onClose={() => setOpen(false)}>
          <div className="px-4 pt-3 text-[11px] text-ink-3">{email}</div>
          <form
            action={(fd) => run(() => updateUserAccess(id, fd), "Couldn't save access.", "Saved.", true)}
            className="flex flex-col gap-3 p-4"
          >
            <PermissionPicker selected={permissions} />
            <div className="text-[11px] text-ink-3">
              Changes bite on their next click — anything unticked disappears from their sidebar and is refused
              server-side.
            </div>
            {error && <div className="text-[12px] text-flag">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
                Cancel
              </button>
              <SubmitButton pendingLabel="Saving…" className={primaryBtn}>
                Save access
              </SubmitButton>
            </div>
          </form>

          <form
            action={(fd) => run(() => resetUserPassword(id, fd), "Couldn't reset the password.", "Password reset.", false)}
            className="flex items-end gap-2 border-t border-rule px-4 py-3"
          >
            <div className="flex-1">
              <TextInput
                name="password"
                label="Reset password"
                type="password"
                placeholder="new temp password (8+)"
                autoComplete="new-password"
              />
            </div>
            <SubmitButton pendingLabel="Resetting…" className={`${ghostBtn} inline-flex items-center gap-1`}>
              <KeyRound className="size-3" strokeWidth={1.5} />
              Reset
            </SubmitButton>
            {saved && <span className="pb-2 text-[11px] text-accent-2">{saved}</span>}
          </form>
        </Modal>
      )}
    </>
  );
}
