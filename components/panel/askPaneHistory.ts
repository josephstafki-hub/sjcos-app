import {paneUrl,type PaneRef} from './askPaneLayout.ts';
const marker='sjcosAskPane';
/** UI-only history ownership, IDs only. The app route and history.state are
 * preserved. Consume sanitizes the forward entry before going Back. */
export class AskPaneHistory {
  private owned=false;
  private token:string;
  private origin:string|null=null;
  private scroll:[number,number]=[0,0];
  private win:Window;
  constructor(win:Window) {this.win=win;this.token=win.crypto.randomUUID();}
  open(ref:PaneRef, direct=false) {
    const win=this.win;
    if(!this.owned){this.origin=win.location.href;this.scroll=[win.scrollX,win.scrollY];}
    if(direct){win.history.replaceState(win.history.state,'',paneUrl(win.location.href,ref));return;}
    const state={...win.history.state,[marker]:this.token};
    const href=paneUrl(win.location.href,ref);
    if(this.owned)win.history.replaceState(state,'',href);
    else {win.history.pushState(state,'',href);this.owned=true;}
  }
  async consume() {
    const win=this.win;
    if(!this.owned||win.history.state?.[marker]!==this.token) {this.clean();return;}
    // Forward must not resurrect the pane, even after closing Operator.
    this.clean(); this.owned=false;
    await new Promise<void>(resolve=>{
      win.addEventListener('popstate',()=>resolve(),{once:true}); win.history.back();
    });
    win.scrollTo(...this.scroll);
  }
  clean() {
    const state={...this.win.history.state}; delete state[marker];
    this.win.history.replaceState(state,'',paneUrl(this.win.location.href,null));
  }
  get ownsEntry() {return this.owned;}
  isOurEntry() {return this.win.history.state?.[marker]===this.token;}
  didPop() {this.owned=false;this.win.scrollTo(...this.scroll);}
  restoreAfterBlockedBack() {this.win.history.go(1);}
  get originRoute() {return this.origin;}
}
