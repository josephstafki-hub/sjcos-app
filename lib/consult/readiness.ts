export type ReadyCheck = 'visit_details' | 'forms' | 'offline_pages' | 'saving_on_device' | 'offline_lease' | 'microphone';
export const readinessLabels:Record<ReadyCheck,string>={visit_details:'Visit details',forms:'Forms',offline_pages:'Offline pages',saving_on_device:'Saving on this device',offline_lease:'Works without signal until …',microphone:'Microphone (optional)'};
export type CheckResult={state:'not_yet'|'checking'|'done'|'problem';reason?:string};
export function offlineReadiness(checks:Record<ReadyCheck,CheckResult>) {
 const mandatory:ReadyCheck[]=['visit_details','forms','offline_pages','saving_on_device','offline_lease'];
 const ready=mandatory.every(key=>checks[key].state==='done');
 return {ready,label:ready?'Ready offline ✓':mandatory.some(key=>checks[key].state==='problem')?'Not ready':'Getting ready…',
   failed:mandatory.filter(key=>checks[key].state==='problem'),notes_available:checks.microphone.state==='done'};
}
