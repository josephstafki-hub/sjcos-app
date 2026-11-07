import type {BrowserStatus,ControlMessage} from '../../../lib/browser/web-types';

export type NavigationState=NonNullable<BrowserStatus['navigation']> & {loading?:boolean};
export type NavigationBinding=Required<Pick<ControlMessage,'expected_document_epoch'|'context_generation'|'read_manifest_revision'>> & Pick<ControlMessage,'target_id'>;
export const isNavigation=(action:string):action is Extract<ControlMessage['action'],'back'|'forward'|'reload'|'switch_tab'>=>['back','forward','reload','switch_tab'].includes(action);
/** Only the latest server projection can bind a deliberate navigation. */
export function navigationBinding(d:BrowserStatus & {navigation?:NavigationState|null},action:string,target?:string):NavigationBinding|null {
 const n=d.navigation;
 if(!isNavigation(action)||!d.available_controls?.includes(action)||!n||n.context_generation!==d.context_generation||n.document_epoch!==d.task.document_epoch||n.read_manifest_revision!==d.task.read_manifest_revision)return null;
 if(action==='switch_tab'&&(!target||!n.target_ids.includes(target)))return null;
 return {expected_document_epoch:n.document_epoch,context_generation:n.context_generation,read_manifest_revision:n.read_manifest_revision,...(action==='switch_tab'?{target_id:target}:{})};
}
/** Dialog-style menu: arrows/Home/End move among enabled controls; Tab remains
 * in the shared host focus trap and Escape is handled by the top overlay. */
export function browserMenuKey(e:Pick<KeyboardEvent,'key'|'preventDefault'>,element:HTMLElement) {
 const buttons=Array.from(element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
 const index=buttons.indexOf(element.ownerDocument.activeElement as HTMLButtonElement);let next:number;
 if(e.key==='Home')next=0;else if(e.key==='End')next=buttons.length-1;else if(['ArrowDown','ArrowRight'].includes(e.key))next=(index+1)%buttons.length;else if(['ArrowUp','ArrowLeft'].includes(e.key))next=(index-1+buttons.length)%buttons.length;else return;
 if(buttons.length){e.preventDefault();buttons[next]?.focus();}
}
