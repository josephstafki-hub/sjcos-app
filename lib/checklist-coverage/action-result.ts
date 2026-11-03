/** Expected failures survive production Server Action serialization. */
export const ERROR_CODES = ['CHECKLIST_FORBIDDEN','CHECKLIST_USER_CHANGED','CHECKLIST_INVALID_ID','CHECKLIST_INVALID_REVISION','CHECKLIST_INVALID_ANSWER','CHECKLIST_INVALID_ITEM','CHECKLIST_INVALID_TARGET','CHECKLIST_INVALID_COMMAND','CHECKLIST_INVALID_SETTINGS','CHECKLIST_INVALID_DRAFT','CHECKLIST_INVALID_CONSENT_EVIDENCE','CHECKLIST_NOT_FOUND','CHECKLIST_OPERATION_REUSED','CHECKLIST_OWNER_ONLY','CHECKLIST_PROJECTION_UNAVAILABLE','CHECKLIST_READ_ONLY','CHECKLIST_VERSION_CONFLICT','CHECKLIST_NO_EMAIL','CHECKLIST_LINK_LEAD','CHECKLIST_NO_PRIOR','CHECKLIST_UNAVAILABLE','CHECKLIST_RECIPIENT_CHANGED'] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export type ActionFailure = {ok:false;code:ErrorCode};
export async function actionResult<T>(run:()=>Promise<T>):Promise<T|ActionFailure> {
 try { return await run(); } catch(error) {
  const message = error instanceof Error ? error.message : '';
  const code = ERROR_CODES.find(code=>message===code);
  if (code) return {ok:false,code};
  throw error;
 }
}
export function errorCopy(code:string):string {
 switch(code) {
 case 'CHECKLIST_INVALID_ANSWER':return "That answer wasn't accepted. Open the row, check it, and save again — or discard the change.";
 case 'CHECKLIST_NO_EMAIL':return 'Confirm their email first.';
 case 'CHECKLIST_LINK_LEAD':return 'Link this checklist to a lead first.';
 case 'CHECKLIST_RECIPIENT_CHANGED':return 'The recipient changed. Reload the summary and confirm their email before submitting again.';
 case 'CHECKLIST_CONFLICT':return 'The checklist changed on another device. Try again.';
 case 'CHECKLIST_VERSION_CONFLICT':return 'These settings were changed somewhere else. Reload the current list, then make your changes again.';
 case 'CHECKLIST_USER_CHANGED':case 'CHECKLIST_FORBIDDEN':case 'CHECKLIST_OWNER_ONLY':return 'Sign in again before continuing. Your changes have not been sent.';
 case 'CHECKLIST_OPERATION_REUSED':return 'This change needs review. Reload the saved checklist before trying again.';
 default:return "Couldn't save. Your changes are still here — check them and try again.";
 }
}
