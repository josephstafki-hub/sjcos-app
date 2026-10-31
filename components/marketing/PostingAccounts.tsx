"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, X } from "lucide-react";
import { Card } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { POST_PLATFORMS, POST_PLATFORM_LABEL, type PostPlatform } from "@/lib/marketing-types";
import type { PostingAccounts as Accounts } from "@/lib/publisher/core";
import { savePostingAccounts } from "@/lib/actions/marketing";
import { runAction } from "@/lib/run-action";

type Status = { open: true; platform: string; url: string; title: string; width: number; height: number } | { open: false; busy: string | null };

/** Owner only: the accounts the posting agent posts as, and the sign-in
 *  window. Joe signs in himself, in a live picture of the one posting browser
 *  on the server; SJC OS never keeps his passwords. */
export function PostingAccounts({ accounts }: { accounts: Accounts }) {
  const router = useRouter();
  const [form, setForm] = useState(accounts);
  const [pending, startTransition] = useTransition();
  const [signin, setSignin] = useState<PostPlatform | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(accounts);
  const input = "min-w-0 w-full flex-1 rounded-md border border-rule bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";

  function save() {
    startTransition(async () => {
      const r = await runAction(() => savePostingAccounts(form), { fallback: "Couldn't save the accounts." });
      if (r && "ok" in r && r.ok) toast({ kind: "success", message: "Saved." });
      router.refresh();
    });
  }

  return (
    <Card className="mb-5 p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-accent" strokeWidth={1.75} />
        <span className="text-[13px] font-semibold text-ink">Posting accounts</span>
        <span className="text-[11px] text-ink-3">Where the posting agent posts, signed in by you.</span>
      </div>
      <div className="grid gap-1.5 text-[11px] text-ink-3">
        <label className="flex flex-col gap-1 @xl/page:flex-row @xl/page:items-center @xl/page:gap-2">
          <span className="flex-none @xl/page:w-[120px]">Facebook page link</span>
          <input className={input} value={form.facebookPage} placeholder="https://www.facebook.com/YourPage" onChange={(e) => setForm({ ...form, facebookPage: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 @xl/page:flex-row @xl/page:items-center @xl/page:gap-2">
          <span className="flex-none @xl/page:w-[120px]">Instagram account</span>
          <input className={input} value={form.instagramHandle} placeholder="@yourbusiness" onChange={(e) => setForm({ ...form, instagramHandle: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 @xl/page:flex-row @xl/page:items-center @xl/page:gap-2">
          <span className="flex-none @xl/page:w-[120px]">Google Business name</span>
          <input className={input} value={form.googleBusinessName} placeholder="SJ Carpentry LLC" onChange={(e) => setForm({ ...form, googleBusinessName: e.target.value })} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {dirty && (
          <button type="button" onClick={save} disabled={pending} className="rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 disabled:opacity-60">
            Save
          </button>
        )}
        <span className="text-[11px] text-ink-3">Sign in:</span>
        {POST_PLATFORMS.map((p) => (
          <button key={p} type="button" onClick={() => setSignin(p)} className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2">
            {p === "google_business" ? "Google" : POST_PLATFORM_LABEL[p].replace(" page", "")}
          </button>
        ))}
      </div>
      {signin && <SigninWindow platform={signin} onClose={() => setSignin(null)} />}
    </Card>
  );
}

async function api(body: unknown): Promise<{ ok?: boolean; message?: string }> {
  const r = await fetch("/api/marketing/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

const SPECIAL: Record<string, string> = {
  Enter: "Enter", Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Escape: "Escape",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
};

/** The live sign-in view: a picture of the server's browser, refreshed about
 *  twice a second; clicks, scrolls and keys go to it in order. */
function SigninWindow({ platform, onClose }: { platform: PostPlatform; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("Opening the sign-in window…");
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const textBuf = useRef("");
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inputs go one after another, so typed text and Enter arrive in order.
  const send = useCallback((input: unknown) => {
    queue.current = queue.current.then(() => api({ action: "input", input })).then(() => setTick((t) => t + 1));
  }, []);
  const flushText = useCallback(() => {
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = null;
    const t = textBuf.current;
    textBuf.current = "";
    if (t) send({ type: "text", text: t });
  }, [send]);

  useEffect(() => {
    let alive = true;
    api({ action: "open", platform }).then((r) => {
      if (alive && r.ok === false) setMessage(r.message ?? "Couldn't open the sign-in window.");
    });
    const poll = setInterval(async () => {
      const s = (await fetch("/api/marketing/signin").then((r) => r.json()).catch(() => null)) as Status | null;
      if (!alive || !s) return;
      setStatus(s);
      if (!s.open && s.busy) setMessage(s.busy);
    }, 2000);
    const frames = setInterval(() => setTick((t) => t + 1), 600);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(frames);
    };
  }, [platform]);

  useEffect(() => box.current?.focus(), [status?.open]);

  function close() {
    flushText();
    queue.current.then(() => api({ action: "close" })).finally(onClose);
  }

  function click(e: React.MouseEvent<HTMLImageElement>) {
    if (!status?.open || !img.current) return;
    flushText();
    const r = img.current.getBoundingClientRect();
    send({ type: "click", x: Math.round(((e.clientX - r.left) / r.width) * status.width), y: Math.round(((e.clientY - r.top) / r.height) * status.height) });
    box.current?.focus();
  }

  function key(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!status?.open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) {
      e.preventDefault();
      textBuf.current += e.key;
      if (textTimer.current) clearTimeout(textTimer.current);
      textTimer.current = setTimeout(flushText, 150);
      return;
    }
    const k = e.key === "Tab" && e.shiftKey ? "Shift+Tab" : SPECIAL[e.key];
    if (!k) return;
    e.preventDefault();
    flushText();
    send({ type: "key", key: k });
  }

  function paste(e: React.ClipboardEvent<HTMLDivElement>) {
    const t = e.clipboardData.getData("text").slice(0, 500);
    if (!t || !status?.open) return;
    e.preventDefault();
    flushText();
    send({ type: "text", text: t });
  }

  return (
    <div className="mt-3 rounded-md border border-accent bg-paper p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <button type="button" onClick={() => send({ type: "back" })} disabled={!status?.open} aria-label="Back" className="rounded border border-rule bg-card p-1 text-ink-2 disabled:opacity-50">
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{status?.open ? status.url : message}</span>
        <button type="button" onClick={close} className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper">
          <X className="size-3" strokeWidth={2} /> Done
        </button>
      </div>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={key}
        onPaste={paste}
        onWheel={(e) => status?.open && send({ type: "scroll", dy: Math.round(e.deltaY) })}
        className="relative outline-none focus:ring-2 focus:ring-accent"
      >
        {status?.open ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={img} src={`/api/marketing/signin/frame?t=${tick}`} alt="The posting browser" onClick={click} className="w-full cursor-pointer rounded border border-rule" draggable={false} />
        ) : (
          <div className="grid h-40 place-items-center text-[12px] text-ink-3">{message}</div>
        )}
      </div>
      <div className="mt-1.5 text-[10px] text-ink-3">
        Click into the picture and type as usual. What you type goes only to that browser; SJC OS doesn&apos;t keep it. Press Done when you&apos;re signed in. It stays signed in for the posting agent.
      </div>
    </div>
  );
}
