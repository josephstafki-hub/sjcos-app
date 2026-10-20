import { after, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getCurrentUser } from "@/lib/dal";
import { readReceipts, scanUploads } from "@/lib/receipt-scan";

// POST /api/receipts/scan — receipt photos from a phone: the /scan page
// (session cookie) or the mobile app (Bearer token). multipart/form-data:
//   photo        one or more image / PDF files
//   project_slug optional — the job the sender says it's for
//   note         optional — anything the sender wants to add
//   one_receipt  "1" when the photos are pages of one long receipt
// Answers as soon as the photos are stored; Claude reads them afterwards and
// files each one to its job, or leaves it on /unsorted (lib/receipt-scan.ts).
// Anyone on the team may send a receipt; sorting them stays behind money.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const user = (await getCurrentUser()) ?? (await getUserFromRequest(req));
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role !== "owner" && user.role !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the photos as a form upload." }, { status: 400 });
  }
  const files: { name: string; mime: string; bytes: Buffer }[] = [];
  for (const v of form.getAll("photo")) {
    if (typeof v === "string") continue;
    if (v.size > MAX_BYTES) return NextResponse.json({ error: `${v.name} is over 20 MB.` }, { status: 413 });
    files.push({ name: v.name || "receipt.jpg", mime: v.type || "image/jpeg", bytes: Buffer.from(await v.arrayBuffer()) });
  }
  const r = await scanUploads({
    files,
    oneReceipt: form.get("one_receipt") === "1",
    projectSlug: String(form.get("project_slug") ?? "").trim() || null,
    note: String(form.get("note") ?? ""),
    senderName: user.role === "owner" ? user.name.split(" ")[0] || "Joe" : user.name || user.email,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const fresh = r.receipts.filter((x) => !x.existed).map((x) => x.id);
  if (fresh.length) after(() => readReceipts(fresh));
  return NextResponse.json({ ok: true, receipts: r.receipts, skipped: r.skipped });
}
