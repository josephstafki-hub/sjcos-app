/** Trusted local controls and frames participate in the SAME modal trap. */
export function askFocusTargets(root:HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),iframe,[tabindex="0"]'))
    .filter(el=>el.getClientRects().length>0&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));
}
export function trapAskFocus(event:KeyboardEvent,root:HTMLElement) {
  if(event.key!=='Tab'||event.defaultPrevented)return;
  const targets=askFocusTargets(root),first=targets[0],last=targets[targets.length-1];
  if(!first){event.preventDefault();root.focus();return;}
  if(!root.contains(document.activeElement)||document.activeElement===root||(event.shiftKey&&document.activeElement===first)) {event.preventDefault();(event.shiftKey?last:first)?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
/** Trusted iframe bridges can call this with authenticated MessagePort messages.
 * No window.message listener: opaque/untrusted content cannot command the host. */
export function moveAskFrameFocus(root:HTMLElement,frame:HTMLIFrameElement,backward:boolean) {
  const targets=askFocusTargets(root),index=targets.indexOf(frame);
  targets[(index+(backward?-1:1)+targets.length)%targets.length]?.focus();
}
