// Owner-only operational copy. Never include an exception message or path.
const causes = {
 JOURNAL_PERMISSIONS: 'Chat records folder has unsafe permissions or ownership, or is a symbolic link. Verify the configured folder and runtime owner, then run: chmod 700 <journal-dir>.',
 JOURNAL_DEPLOYMENT_PERMISSIONS: 'Chat deployment-state folder has unsafe permissions or ownership, or is a symbolic link. Verify the configured folder and runtime owner, then run: chmod 700 <deployment-state-dir>.',
 JOURNAL_NOT_CONFIGURED: 'Chat recovery authority is not configured.',
 JOURNAL_AUTHORITY_IDENTITY: 'Chat recovery authority does not match this deployment.',
 JOURNAL_BINDING: 'Chat recovery binding needs checking.',
 JOURNAL_INVALID: 'Chat recovery journal needs checking.',
};
export function askHealthDiagnosis(code) {
 return Object.hasOwn(causes, code ?? '') ? { code, message: causes[code] } : null;
}
export function askHealthCause(error, fallback='JOURNAL_UNAVAILABLE') {
 for(let e=error, depth=0;e&&depth<4;e=e.cause,depth++) {
  if(askHealthDiagnosis(e.message))return e.message;
 }
 return fallback;
}
