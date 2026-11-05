// Capture once at server construction; ordinary tool arguments cannot replace
// context, including with context:null. HTTP MCP never gets a private context.
export function createPrivateBridgeContext({transportKind,env=process.env,httpActive=()=>false}){
 const context=Object.freeze({transport:'runner_stdio',run_id:env.SJC_RUN_ID,conversation_id:env.SJC_CONVERSATION_ID,principal_user_id:env.SJC_PRINCIPAL_USER_ID,run_profile:env.SJC_RUN_PROFILE,run_started_s:Number(env.SJC_RUN_STARTED_S)});
 const valid=transportKind==='stdio'&&[context.run_id,context.conversation_id,context.principal_user_id].every(v=>/^[-a-f0-9]{36}$/i.test(v??''))&&['operator','business'].includes(context.run_profile)&&Number.isSafeInteger(context.run_started_s)&&context.run_started_s>0;
 return ()=>valid&&!httpActive()?context:null;
}
