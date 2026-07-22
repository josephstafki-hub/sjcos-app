"use client";

// Recipients + audiences (P7-N2). The email list, quick/bulk/import ways to grow
// it, and named "audiences" (email groups) recipients can belong to — selectable
// as the target when queueing a broadcast (see the Audience picker in
// NewsletterClient's toolbar). Membership is many-to-many and never altered by a
// send; the redundancy screen that keeps a multi-group member from getting two
// copies of the same issue lives in enqueueIssue's DISTINCT (lib/newsletter-outbox.ts).

import { useRef, useState, type Dispatch, type SetStateAction, type TransitionStartFunction } from "react";
import { Plus, Trash2, Users, Download, Upload, ClipboardPaste, Tag, X, Search, UserPlus } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import {
  addRecipient,
  addRecipientsBulk,
  removeRecipient,
  setRecipientActive,
  importKnownRecipients,
  createGroup,
  deleteGroup,
  setRecipientGroup,
} from "@/lib/actions/newsletter";
import type { Recipient, NewsletterGroup } from "@/lib/newsletter";

export function RecipientsPanel({
  recipients,
  setRecipients,
  groups,
  setGroups,
  activeCount,
  pending,
  start,
  onNotice,
  onOutboxRefresh,
}: {
  recipients: Recipient[];
  setRecipients: Dispatch<SetStateAction<Recipient[]>>;
  groups: NewsletterGroup[];
  setGroups: Dispatch<SetStateAction<NewsletterGroup[]>>;
  activeCount: number;
  pending: boolean;
  start: TransitionStartFunction;
  onNotice: (msg: string | null) => void;
  /** Re-reads the outbox so a freshly-parked welcome greeting shows up. */
  onOutboxRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupPickerFor, setGroupPickerFor] = useState<number | null>(null);

  function addRcpt() {
    const email = newEmail.trim();
    if (!email) return;
    start(async () => {
      const res = await addRecipient(email, newName);
      if (res.ok) {
        setRecipients((prev) =>
          prev.some((r) => r.email === email.toLowerCase())
            ? prev
            : [...prev, { id: -Date.now(), email: email.toLowerCase(), name: newName.trim(), active: true, groupIds: [] }],
        );
        setNewEmail("");
        setNewName("");
        onOutboxRefresh();
      } else onNotice(res.error);
    });
  }

  function rmRcpt(id: number) {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
    start(async () => {
      await removeRecipient(id);
    });
  }

  function addBulk() {
    const text = bulkText.trim();
    if (!text) return;
    start(async () => {
      const res = await addRecipientsBulk(text);
      if (res.ok) {
        onNotice(`Added ${res.data?.added ?? 0} email(s). Reload to see them in the list.`);
        setBulkText("");
        setBulkOpen(false);
        onOutboxRefresh();
      } else onNotice(res.error);
    });
  }

  function importKnown() {
    start(async () => {
      const res = await importKnownRecipients();
      if (res.ok) {
        onNotice(
          `Found ${res.data ?? 0} new contact(s) from leads, projects, and client logins — sorted into ` +
            `Leads / Projects / Past projects below, but NOT added to any send. Search and tap "Add to list" ` +
            `on the ones you actually want to mail. Reload to see them.`,
        );
        onOutboxRefresh();
      }
    });
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  function importFile(file: File) {
    file.text().then((text) => {
      start(async () => {
        const res = await addRecipientsBulk(text, false);
        if (res.ok) {
          onNotice(
            `Found ${res.data?.added ?? 0} new email(s) in "${file.name}" — not added to any send. Search and ` +
              `tap "Add to list" on the ones you want. Reload to see them.`,
          );
          onOutboxRefresh();
        } else onNotice(res.error);
      });
    });
  }

  function toggleActive(r: Recipient) {
    setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !r.active } : x)));
    start(async () => {
      const res = await setRecipientActive(r.id, !r.active);
      if (!res.ok) onNotice(res.error);
      onOutboxRefresh();
    });
  }

  const filtered = recipients.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.email.includes(q) || r.name.toLowerCase().includes(q);
  });

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    start(async () => {
      const res = await createGroup(name);
      if (res.ok && res.data) {
        setGroups((prev) => [...prev, res.data!].sort((a, b) => a.name.localeCompare(b.name)));
        setNewGroupName("");
      } else if (!res.ok) onNotice(res.error);
    });
  }

  function rmGroup(id: number, name: string) {
    if (!confirm(`Delete the "${name}" audience? Recipients stay on the list — this only removes the group.`)) return;
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setRecipients((prev) => prev.map((r) => ({ ...r, groupIds: r.groupIds.filter((g) => g !== id) })));
    start(async () => {
      await deleteGroup(id);
    });
  }

  function toggleMembership(recipientId: number, groupId: number, on: boolean) {
    setRecipients((prev) =>
      prev.map((r) =>
        r.id === recipientId
          ? { ...r, groupIds: on ? [...r.groupIds, groupId] : r.groupIds.filter((g) => g !== groupId) }
          : r,
      ),
    );
    start(async () => {
      await setRecipientGroup(recipientId, groupId, on);
    });
  }

  return (
    <div className="mx-auto max-w-[560px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="size-4 text-ink-3" strokeWidth={1.5} />
        <span className="flex-1 text-[13px] text-ink-2">
          {activeCount} on the mailing list
          <span className="text-ink-3"> · {recipients.length} contact{recipients.length === 1 ? "" : "s"} total</span>
        </span>
        <button
          type="button"
          onClick={importKnown}
          disabled={pending}
          title="Client-portal logins, leads, and each project's client email"
          className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
        >
          <Download className="size-3.5" strokeWidth={1.5} /> Import from leads &amp; projects
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
          title="Upload a .csv or .txt file — any email addresses found in it are added"
          className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
        >
          <Upload className="size-3.5" strokeWidth={1.5} /> Import from file
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.5} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts by name or email…"
          className="w-full rounded-md border border-rule bg-paper py-1.5 pl-8 pr-2.5 text-[13px] text-ink outline-none focus:border-accent"
        />
      </div>

      {/* NOT overflow-hidden: a row's audience popover is position:absolute and
          extends below its own row — clipping the Card here hid it entirely
          (state toggled, nothing visible) rather than just squaring off corners. */}
      <Card className="p-0">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-3">
            {recipients.length === 0 ? "No contacts yet." : "No contacts match that search."}
          </div>
        ) : (
          filtered.map((r, i) => (
            <div key={r.id} className={`relative flex items-center gap-3 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{r.name || r.email}</div>
                <div className="flex flex-wrap items-center gap-1">
                  {r.name && <span className="font-mono text-[10px] text-ink-3">{r.email}</span>}
                  {r.groupIds.map((gid) => {
                    const g = groups.find((x) => x.id === gid);
                    return g ? (
                      <Chip key={gid} kind="accent">
                        {g.name}
                      </Chip>
                    ) : null;
                  })}
                </div>
              </div>
              {r.active ? (
                <button
                  type="button"
                  onClick={() => toggleActive(r)}
                  disabled={pending}
                  title="Remove from the mailing list (keeps them as a searchable contact)"
                  className="shrink-0"
                >
                  <Chip kind="money">on list</Chip>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleActive(r)}
                  disabled={pending}
                  title="Add to the mailing list"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rule px-2 py-0.5 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
                >
                  <UserPlus className="size-3" strokeWidth={1.5} /> Add to list
                </button>
              )}
              {groups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setGroupPickerFor((cur) => (cur === r.id ? null : r.id))}
                  className="rounded p-1 text-ink-4 hover:bg-paper-2 hover:text-ink-2"
                  aria-label="Audiences"
                  title="Assign to audiences"
                >
                  <Tag className="size-3.5" strokeWidth={1.5} />
                </button>
              )}
              <button type="button" onClick={() => rmRcpt(r.id)} className="text-ink-4 hover:text-flag" aria-label="Remove">
                <Trash2 className="size-3.5" strokeWidth={1.5} />
              </button>

              {groupPickerFor === r.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setGroupPickerFor(null)} />
                  <div className="absolute right-3 top-full z-20 mt-1 w-[200px] rounded-lg border border-rule bg-card p-1.5 shadow-lg">
                    <div className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                      Audiences
                    </div>
                    {groups.map((g) => {
                      const on = r.groupIds.includes(g.id);
                      return (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink hover:bg-paper-2"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => toggleMembership(r.id, g.id, e.target.checked)}
                            className="size-3.5"
                          />
                          {g.name}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </Card>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Email</label>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRcpt()}
            placeholder="client@email.com"
            className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Name · optional</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRcpt()}
            placeholder="Pat Henderson"
            className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={addRcpt}
          disabled={pending || !newEmail.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          <Plus className="size-3.5" strokeWidth={2} /> Add
        </button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setBulkOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink"
        >
          <ClipboardPaste className="size-3.5" strokeWidth={1.5} />
          {bulkOpen ? "Hide bulk add" : "Add multiple at once"}
        </button>
        {bulkOpen && (
          <div className="mt-2 space-y-1.5">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={4}
              placeholder={"Paste a list of emails — one per line, comma-separated, or from a spreadsheet.\npat@email.com, sam@email.com…"}
              className="w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <div className="text-right">
              <button
                type="button"
                onClick={addBulk}
                disabled={pending || !bulkText.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
              >
                <Plus className="size-3.5" strokeWidth={2} /> Add all found
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-rule-soft pt-4">
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-ink-3" strokeWidth={1.5} />
          <span className="text-[13px] font-semibold text-ink">Audiences</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">
          Named subsets of the list. Tap the tag icon on a recipient above to assign them to one or
          more — a group is selectable as the audience when you Queue an issue, and someone in
          multiple selected groups still gets just one copy.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {groups.length === 0 && <span className="text-[11px] text-ink-3">No audiences yet.</span>}
          {groups.map((g) => {
            const count = recipients.filter((r) => r.groupIds.includes(g.id)).length;
            return (
              <span
                key={g.id}
                className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper px-2 py-0.5 text-[11.5px] text-ink-2"
              >
                {g.name} <span className="font-mono text-[10px] text-ink-3">· {count}</span>
                <button
                  type="button"
                  onClick={() => rmGroup(g.id, g.name)}
                  className="text-ink-4 hover:text-flag"
                  aria-label={`Delete ${g.name}`}
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </span>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGroup()}
            placeholder="New audience name, e.g. Past clients"
            className="flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addGroup}
            disabled={pending || !newGroupName.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
          >
            <Plus className="size-3.5" strokeWidth={2} /> Create
          </button>
        </div>
      </div>
    </div>
  );
}
