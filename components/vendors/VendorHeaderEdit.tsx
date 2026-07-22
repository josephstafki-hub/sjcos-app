"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Pencil } from "lucide-react";
import { updateVendor, toggleVendorFav } from "@/lib/actions/vendors";

const inputCls =
  "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

export function VendorHeaderEdit({
  slug,
  name,
  trade,
  email,
  phone,
  fav,
}: {
  slug: string;
  name: string;
  trade: string;
  email: string;
  phone: string;
  fav: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleFav() {
    startTransition(async () => {
      await toggleVendorFav(slug);
      router.refresh();
    });
  }

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateVendor(slug, fd);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (editing) {
    return (
      <form
        action={submit}
        className="flex flex-col gap-2 rounded-md border border-rule bg-card p-3"
      >
        <div className="flex gap-2">
          <input name="name" defaultValue={name} required placeholder="Vendor name" className={`flex-1 ${inputCls}`} />
          <input name="trade" defaultValue={trade} placeholder="Trade / category" className={`flex-1 ${inputCls}`} />
        </div>
        <div className="flex gap-2">
          <input name="email" type="email" defaultValue={email} placeholder="Email" className={`flex-1 ${inputCls}`} />
          <input name="phone" defaultValue={phone} placeholder="Phone" className={`flex-1 ${inputCls}`} />
        </div>
        {error && <div className="text-[11px] text-flag">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50">
            Save
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={toggleFav} disabled={pending} title={fav ? "Unfavorite" : "Favorite"} className="rounded-md border border-rule bg-card p-1.5 text-ink-3 hover:bg-paper-2 hover:text-accent">
        <Star className={`size-3.5 ${fav ? "fill-accent text-accent" : ""}`} strokeWidth={1.5} />
      </button>
      <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2">
        <Pencil className="size-3" strokeWidth={1.75} /> Edit
      </button>
    </div>
  );
}
