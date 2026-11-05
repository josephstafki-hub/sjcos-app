import { askBoundary, askFailure } from "@/lib/thread-access";
import { isAskFailure } from "@/lib/ask-result-codes";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { transcribeAudio, whisperAvailable } from "@/lib/transcribe";

// POST /api/transcribe — local speech-to-text for voice daily logs (7-voice).
// Session-gated (owner + sub only) inside the handler since the proxy matcher
// excludes /api. Accepts a recorded audio blob, returns { text }. force-dynamic
// so it never caches.
export const dynamic = "force-dynamic";

// GET /api/transcribe — availability probe so any client composer can self-gate
// its mic button without threading whisperAvailable() down through props. Same
// owner/sub session gate as POST; returns { available }.
async function availability() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "staff" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ available: whisperAvailable() });
}

async function transcribe(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "staff" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read the recording." }, { status: 400 });
  }

  const result = await transcribeAudio(bytes);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ text: result.text });
}

async function transcribeResponse(run:()=>Promise<Response>){
 try {
 const user=await getCurrentUser();
 if(!user)return NextResponse.json({ok:false,code:'SIGN_IN_AGAIN'},{status:401});
 // Keep subcontractor daily-log dictation independent of private Ask recovery.
 const result=user.role==='sub'?await run():await askBoundary(run);
 return isAskFailure(result)?NextResponse.json(result,{status:result.code==='ASK_PAUSED'?503:result.code==='CHAT_OFF'?403:401}):result;
 }catch(error){return NextResponse.json(askFailure(error),{status:503});}
}
export async function GET(){return transcribeResponse(availability);}
export async function POST(req:Request){return transcribeResponse(()=>transcribe(req));}
