/** Browser host leave adapter. Generic paneTransition stays owned by shared host.
 * Selection changes Chat/Canvas preserve attendance; only actual task/operator
 * exit releases control and pauses. Passive owner Watch never pauses staff. */
export function createBrowserLeave({releaseAndPause,transition,announce}) {
  let pending=false;
  return async function leave(state,action,{passiveWatch=false,confirmed=false,control='none'}={}) {
    if(pending)return state;
    if(!['exit','close-operator','pop'].includes(action.type))return transition(state,action);
    if(control==='person'&&!confirmed&&!passiveWatch){announce('Keep paused');return state;}
    pending=true;
    try {
      if(!passiveWatch&&await releaseAndPause()!==true){announce('Browser could not pause. Try again.');return state;}
      return transition(state,action);
    }catch{announce('Browser could not pause. Try again.');return state;}finally{pending=false;}
  };
}
