import path from 'node:path';
import {pool} from '@/lib/db';
import {claimConsultFindings,executeConsultFindings,maintainConsults} from '@/lib/worker/consult';
import {cronAuthorized,runCronJob} from '../_lib/guard';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!cronAuthorized(req))return Response.json({ok:false,code:'unauthorized'},{status:401});
 return runCronJob('consult maintenance',async()=>{
  const c=await pool.connect();try{
   let processed=0;
   for(;processed<10;processed++){const job=await claimConsultFindings(c);if(!job)break;await executeConsultFindings(c,job);}
   await maintainConsults(c,path.join(process.cwd(),'uploads'));
   return {processed};
  }finally{c.release();}
 });
}
