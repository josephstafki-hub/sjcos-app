/** Internal work markers are metadata, not owner-facing titles. Preserve mixed
 * case bracketed subjects (e.g. a sender's project or mailing-list label). */
export function inboxTitle(title:string):string {
  return title.replace(/^(?:\s*\[[A-Z][A-Z\d _-]*\]\s*)+/,'').trim();
}
export function channelThreadTitle(thread:{channel:string;fromName:string;subject:string}):string {
  return ['sms','client_portal','sub_portal'].includes(thread.channel)?thread.fromName:thread.subject;
}
export function splitCount(count:number,channelLens:boolean):number|undefined {
  return channelLens&&count===0?undefined:count;
}
