// Timer entrypoint uses the website's owner-side executor; never opens a DB login.
import {loadEnvFile} from '../lib/worker/load-app.mjs';
loadEnvFile();
if(!process.env.CRON_SECRET)throw new Error('CRON_SECRET missing');
const result=await fetch(`${process.env.SJCOS_BASE_URL??'http://127.0.0.1:3000'}/api/cron/consult`,{
 method:'POST',headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(55000)
});
if(!result.ok)throw new Error(`Consult tick failed: ${result.status}`);
console.log(await result.text());
