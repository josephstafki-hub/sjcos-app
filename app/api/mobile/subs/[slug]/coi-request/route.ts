import { areaRead } from "@/lib/mobile-rpc/field-reads";
import { coiRequestDraft } from "@/lib/mobile-rpc/directory-reads";
export async function GET(req: Request, {params}: {params: Promise<{slug:string}>}) { const {slug} = await params; return areaRead(req, "subs", () => coiRequestDraft(slug)); }
