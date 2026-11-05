import { mobileOperatorRead } from "@/lib/mobile-rpc/operator-reads";
import { uploadChatFilesAction } from "@/lib/actions/ai-chat";
export const runtime = "nodejs";
export async function POST(req: Request) {
  return mobileOperatorRead(req, false, async () => {
    if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) return Response.json({ error: "Expected multipart files." }, { status: 400 });
    let form: FormData;
    try { form = await req.formData(); }
    catch { return Response.json({ error: "Invalid multipart files." }, { status: 400 }); }
    const result = await uploadChatFilesAction(form);
    return result.ok ? result : Response.json({ error: result.error }, { status: 400 });
  });
}
