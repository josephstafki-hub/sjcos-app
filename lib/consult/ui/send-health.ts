export interface SendHealth { waitingFrom:number|null; failureFrom:number|null; lastSend:number|null }
export function sendHealth(previous:SendHealth, online:boolean, unsent:number, lastSend:number|null, failed:boolean, now:number):SendHealth {
 if(!online || !unsent)return {waitingFrom:null,failureFrom:null,lastSend};
 const progressed=lastSend!==previous.lastSend;
 return {waitingFrom:progressed ? now : previous.waitingFrom??now,failureFrom:failed ? progressed ? now : previous.failureFrom??now : null,lastSend};
}
export function sendDeadlines(health:SendHealth, now:number) {
 const stuckAt=health.waitingFrom===null?null:health.waitingFrom+120_000;
 return {stuckAt:stuckAt!==null&&now>=stuckAt?stuckAt:null,banner: (stuckAt!==null&&now>=stuckAt)||(health.failureFrom!==null&&now>=health.failureFrom+60_000)};
}
