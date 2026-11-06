#!/usr/bin/env node
// Protected EnvironmentFile supplies CRON_SECRET; never print response/secret.
const secret=process.env.CRON_SECRET;
if(!secret){console.error('Canvas maintenance: missing protected secret');process.exitCode=1;}
else try{
 const res=await fetch('http://127.0.0.1:3017/api/internal/canvas-maintenance',{method:'POST',headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!res.ok)throw Error('maintenance refused');
}catch{console.error('Canvas maintenance failed');process.exitCode=1;}
// The authenticated app route also resumes 0108 pending save recipes and sweeps
// Canvas-owned orphans under the original 0105 lease/fencing token. This caller
// intentionally owns no second lease, raw SQL, filesystem sweep, or renderer.
