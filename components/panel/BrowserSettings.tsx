'use client';
import {useEffect,useState} from 'react';
import {browserAPI,type Settings} from './browser/api';
import {browserFlags} from './browser/session';
import {browserErrorCopy} from './browser/model';
type NamedSettings=Settings;
export function BrowserSettingsView({ownerUserId,settings,selected=[],onSelect,onSave,enabled=false,staff=false,suppress=false,onEnabled=()=>{},onStaff=()=>{},onSuppress=()=>{},busy=false,message=''}:{ownerUserId:string;settings:NamedSettings|null;selected?:string[];onSelect:(id:string,checked:boolean)=>void;onSave:()=>void;enabled?:boolean;staff?:boolean;suppress?:boolean;onEnabled?:(v:boolean)=>void;onStaff?:(v:boolean)=>void;onSuppress?:(v:boolean)=>void;busy?:boolean;message?:string}){
 const check=(label:string,value:boolean,onChange:(v:boolean)=>void)=><label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={value} disabled={!settings||busy} onChange={e=>onChange(e.target.checked)}/>{label}</label>;
 const people=[...(settings?.people??[])].sort((a,b)=>Number(b.user_id===ownerUserId)-Number(a.user_id===ownerUserId)||a.label.localeCompare(b.label));
 return <section data-browser-ui className="mx-auto max-w-2xl space-y-4 p-4 text-subheading"><h1 className="text-heading">Browser</h1><p>This version reads public pages only. Sending job details isn't available yet.</p>
 {check('Enable Browser',enabled,onEnabled)}{check('Enable Browser for selected staff',staff,onStaff)}
 <fieldset className="space-y-2"><legend className="text-heading">Who can use Browser</legend><p>Choose the people who can open Browser. An empty list lets nobody in.</p>{people.map(person=><div key={person.user_id}><label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={selected.includes(person.user_id)} disabled={busy||!person.eligible} onChange={e=>onSelect(person.user_id,e.target.checked)}/>{person.label}</label>{!person.eligible&&<p>Browser access is unavailable for this person.</p>}</div>)}{!people.length&&<p>The people list is unavailable. Try again before saving.</p>}</fieldset>
 {check("Don't ask again when I take over my own browser",suppress,onSuppress)}<p>The page always becomes private before you take over. Staff always see the confirmation.</p>
 <fieldset disabled className="space-y-2 rounded border border-rule p-4"><legend>Not available in this version</legend>{['Saved logins','Files','Submit, Pay and Sign','Ask someone else to finish'].map(label=><label key={label} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={false} readOnly/>{label}</label>)}<p>These features stay off in this version.</p></fieldset>
 <button className="min-h-12 rounded border border-rule px-4" disabled={!settings||busy||!people.length} onClick={onSave}>Save</button><p role="status" aria-live="polite">{message}</p></section>;
}
export function BrowserSettings({ownerUserId}:{ownerUserId:string}){
 const [settings,setSettings]=useState<NamedSettings|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]),[suppress,setSuppress]=useState(false),[enabled,setEnabled]=useState(false),[staff,setStaff]=useState(false);
 useEffect(()=>{let disposed=false;void browserAPI.settings().then(s=>{if(disposed)return;setSettings(s);setSuppress(s.takeover_confirm_suppressed_user_ids.includes(ownerUserId));setSelected(s.pilot_user_ids);setEnabled(browserFlags(s.flags).enabled);setStaff(browserFlags(s.flags).staff_enabled);}).catch(()=>{if(!disposed)setMessage("Browser isn't available yet.");});return ()=>{disposed=true;};},[ownerUserId]);
 const save=async()=>{if(!settings||busy)return;setBusy(true);setMessage('');try{const s=await browserAPI.saveSettings({enabled,staff_enabled:staff,pilot_user_ids:selected,suppress_own_takeover_confirm:suppress,expected_revision:settings.revision});setSettings(s);setMessage('Saved.');}catch(e){setMessage(browserErrorCopy((e as {code?:string}).code??''));}finally{setBusy(false);}};
 return <BrowserSettingsView ownerUserId={ownerUserId} settings={settings} selected={selected} onSelect={(id,checked)=>setSelected(ids=>checked?[...ids,id]:ids.filter(x=>x!==id))} onSave={()=>void save()} enabled={enabled} staff={staff} suppress={suppress} onEnabled={setEnabled} onStaff={setStaff} onSuppress={setSuppress} busy={busy} message={message}/>;
}
