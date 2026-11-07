'use client';
import {useEffect,useState} from 'react';
import {browserAPI,type Settings} from './browser/api';
import {browserFlags} from './browser/session';
import {browserErrorCopy} from './browser/model';
export function BrowserSettings({ownerUserId}:{ownerUserId:string}){
 const [settings,setSettings]=useState<Settings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pilots,setPilots]=useState(''),[suppress,setSuppress]=useState(false),[enabled,setEnabled]=useState(false),[staff,setStaff]=useState(false);
 useEffect(()=>{let disposed=false;void browserAPI.settings().then(s=>{if(disposed)return;setSettings(s);setSuppress(s.takeover_confirm_suppressed_user_ids.includes(ownerUserId));setPilots(s.pilot_user_ids.join('\n'));setEnabled(browserFlags(s.flags).enabled);setStaff(browserFlags(s.flags).staff_enabled);}).catch(()=>{if(!disposed)setError("Browser isn't available yet.");});return ()=>{disposed=true;};},[ownerUserId]);
 const save=async()=>{if(!settings||busy)return;setBusy(true);setError('');try{
  const pilot_user_ids=pilots.split(/[\s,]+/).filter(Boolean);if(pilot_user_ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)))throw Error('pilot');
  const s=await browserAPI.saveSettings({enabled,staff_enabled:staff,pilot_user_ids,suppress_own_takeover_confirm:suppress,expected_revision:settings.revision});setSettings(s);setError('Saved.');
 }catch(e){setError(e instanceof Error&&e.message==='pilot'?"Couldn't save Browser settings. Check the pilot list and try again.":browserErrorCopy((e as {code?:string}).code??''));}finally{setBusy(false);}};
 const check=(label:string,value:boolean,onChange:(v:boolean)=>void)=><label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={value} disabled={!settings||busy} onChange={e=>onChange(e.target.checked)}/>{label}</label>;
 return <section className="mx-auto max-w-2xl space-y-4 p-4 text-subheading"><h1 className="text-heading">Browser</h1><p>This version reads public pages only. Sending job details isn't available yet.</p><p>Only the people on the pilot list can open Browser. An empty list lets nobody in.</p>
 {check('Enable Browser',enabled,setEnabled)}{check('Enable Browser for staff on the pilot list',staff,setStaff)}
 <label className="block">Pilot user IDs<textarea className="mt-2 min-h-28 w-full rounded border border-rule p-3" value={pilots} disabled={!settings||busy} onChange={e=>setPilots(e.target.value)} aria-describedby="browser-pilot-help"/></label><p id="browser-pilot-help">One user ID per line. Add the owner's ID too.</p>
 {check("Don't ask again when I take over my own browser",suppress,setSuppress)}<p>The page always becomes private before you take over. Staff always see the confirmation.</p>
 <fieldset disabled className="space-y-2 rounded border border-rule p-4"><legend>Not available in this version</legend>{['Saved logins','Files','Submit, Pay and Sign','Ask someone else to finish'].map(label=><label key={label} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={false} readOnly/>{label}</label>)}<p>These features stay off in this version.</p></fieldset>
 <button className="min-h-12 rounded border border-rule px-4" disabled={!settings||busy} onClick={()=>void save()}>Save</button><p role="status" aria-live="polite">{error}</p></section>;
}
