"use client";
import {useState} from 'react';
import {listEnrollments} from '@/lib/consult/ui/controller';
import {ConsultOfflineStore, type SignedLease} from '@/lib/consult/offline';
import {OfflineVault} from '@/lib/consult/offline-vault';
import type {LocalVisit} from '@/lib/consult/offline-engine';
import {plainWords} from '@/lib/consult/ui/words';
/** Owner uses the ORIGINAL device/PIN. Recovered answers remain proposals by their author. */
export function RecoveryControl({consultId}:{consultId:string}) {
 const [pin,setPin]=useState(''),[reason,setReason]=useState(''),[epoch,setEpoch]=useState('1'),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 async function recover(){setBusy(true);let store:ConsultOfflineStore|null=null;try{
  const entries=(await listEnrollments()).filter(e=>e.identity.consult_id===consultId);
  if(entries.length!==1)throw Error('Choose the original device with a single saved copy of this visit.');
  const e=entries[0];
  const send=async(command:string,input:unknown)=>{const r=await fetch(`/api/consult/${consultId}`,{method:'POST',headers:{'Content-Type':'application/json','X-Consult-CSRF':'1'},body:JSON.stringify({command,input})});const body=await r.json();if(!r.ok||body.ok===false)throw Error(body.error_code??body.code);return body;};
  const base={original_user:e.identity.user_id,device:e.device,epoch:Number(epoch),reason};
  const signed=await send('recovery_lease',{...base,session_epoch:e.identity.session_epoch,build:e.identity.build}) as SignedLease;
  store=await ConsultOfflineStore.open();const recovered=await new OfflineVault(store).recover(e.identity,e.device,pin,signed);
  const local=recovered.saved?.value as LocalVisit|undefined;if(!local)throw Error('not_prepared');
  const ops=local.queue.entries.filter(e=>e.status!=='accepted').map(e=>e.op);
  for(let offset=0;offset<Math.max(1,ops.length);offset+=50)await send('recover_device',{...base,epoch:local.queue.device_epoch,operation_id:crypto.randomUUID(),ops:ops.slice(offset,offset+50),blobs:offset===0?local.blobs:[]});
  setStatus('Recovered answers staged with the original author. Photos still waiting on this device need separate recovery; keep this device.');setPin('');
 }catch(e){setStatus(e instanceof Error?plainWords(e.message):plainWords('unknown'));}finally{store?.close();setBusy(false);}}
 return <details className="w-full"><summary>Recover saved answers from this original device (Joe)</summary><p>Use the original visitor’s PIN. This stages answers for a person to accept.</p><input aria-label="Original visitor PIN" type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)} /><input aria-label="Device epoch" type="number" min="1" value={epoch} onChange={e=>setEpoch(e.target.value)} /><input aria-label="Recovery reason" value={reason} onChange={e=>setReason(e.target.value)} /><button disabled={busy||!/^\d{6,12}$/.test(pin)||!reason.trim()} onClick={()=>void recover()}>Recover answers</button><p role="status">{status}</p></details>;
}
