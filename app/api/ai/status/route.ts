import { getCurrentUser } from '@/lib/dal';
import { pool } from '@/lib/db';
import { withAskJournal, deletionCapabilities } from '@/lib/ask-thread-journal.mjs';
export const dynamic='force-dynamic';
export async function GET(){
 try{
  const user=await getCurrentUser();
  if(!user)return Response.json({ok:false,code:'SIGN_IN_AGAIN'},{status:401});
  if(user.role!=='owner')return Response.json({ok:false,code:'CHAT_OFF'},{status:403});
  let capabilities={deleteAvailable:false},ready=false;
  try{await withAskJournal(pool,async()=>{capabilities=await deletionCapabilities(pool);ready=true;});}catch{/* fixed status only */}
  const row=(await pool.query('SELECT health_code FROM ask_canvas_maintenance WHERE singleton')).rows[0];
  const warning=ready&&row?.health_code==='JOURNAL_NOT_CONFIGURED';
  return Response.json({ok:true,status:warning?'warning':ready?'ready':'paused',code:warning?'JOURNAL_NOT_CONFIGURED':ready?null:'ASK_PAUSED',capabilities},{status:ready?200:503,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({ok:false,code:'ASK_PAUSED'},{status:503});}
}
