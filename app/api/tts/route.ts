import { askBoundary, askFailure, requireRunThreadAccess } from "@/lib/thread-access";
import { isAskFailure, askFailureStatus } from "@/lib/ask-result-codes";
import { NextResponse } from "next/server";
import { hasAccess } from "@/lib/api-auth";
import { getCurrentUser } from "@/lib/dal";
import { synthesizeSpeech, piperAvailable } from "@/lib/tts";
import { spokenUpdateForRun } from "@/lib/orchestrator/voice";

// POST /api/tts — local text-to-speech for voice conversation rounds (Phase
// B1). Session-gated (owner + sub only) inside the handler since the proxy
// matcher excludes /api. Accepts { text }, returns the WAV bytes. force-dynamic
// so it never caches. Also accepts { runId } — the spoken form of a finished
// run's answer, condensed by Claude (lib/orchestrator/voice.ts).
export const dynamic = "force-dynamic";

// GET /api/tts — availability probe so any client surface can self-gate its
// speaker path without threading piperAvailable() down through props. Same
// owner/sub session gate as POST; returns { available }.
async function getAvailability() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "staff" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ available: piperAvailable() });
}

async function speak(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "staff" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let text: string;
  let runId: string | null = null;
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
    runId = typeof body?.runId === "string" ? body.runId : null;
  } catch {
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }

  // { runId }: speak a finished run's outcome — Claude condenses the agent's
  // written answer into a spoken update (cached in dev_agent_runs.spoken_answer).
  if (runId) {
    if (!hasAccess(user, "ai")) return NextResponse.json({ok:false,code:"CHAT_OFF"}, { status: 403 });
    await requireRunThreadAccess(runId);
    const spoken = await spokenUpdateForRun(runId);
    if (!spoken) return NextResponse.json({ error: "Nothing to say for that run yet." }, { status: 422 });
    text = spoken;
  }

  const result = await synthesizeSpeech(text);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return new Response(new Uint8Array(result.wav), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  });
}

async function speechResponse(run:()=>Promise<Response>, probe=false){
 try {
 const user=await getCurrentUser();
 if(!user)return NextResponse.json({ok:false,code:'SIGN_IN_AGAIN'},{status:401});
 // Subcontractor daily-log speech is not an Ask surface. Its existing raw-text
 // path remains available; speak() refuses any runId before private access.
 const result=user.role==='sub'?await run():await askBoundary(run);
 if(isAskFailure(result)){
  if(probe && result.code==='ASK_PAUSED')return NextResponse.json({available:false,code:result.code},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json(result,{status:result.code==='THREAD_UNAVAILABLE'?404:askFailureStatus(result),headers:{'Cache-Control':'no-store'}});
 }
 if(probe)result.headers.set('Cache-Control','no-store');
 return result;
 }catch(error){
  const failure=askFailure(error);
  if(probe && failure.code==='ASK_PAUSED')return NextResponse.json({available:false,code:failure.code},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json(failure,{status:askFailureStatus(failure),headers:{'Cache-Control':'no-store'}});
 }
}
export async function GET(){return speechResponse(getAvailability,true);}
export async function POST(req:Request){return speechResponse(()=>speak(req));}
