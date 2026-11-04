/** Stable hooks for the close refusal UI, including its transport and evidence steps. */
export const CLOSE_ERROR_ACTIONS = {
 conflict:'reload', stale_snapshot:'reload', evidence_conflict:'reload', complete_locked:'back_to_visits',
 manifest_sequence_gap:'send_now', unresolved_rejections:'send_now', manifest_blob_missing:'send_now', manifest_initials_missing:'send_now',
 rebase_required:'go_to_field', device_access_denied:'go_to_field', missing_device_manifest_required:'go_to_field',
 evidence_too_large:'go_to_field', batch_too_large:'go_to_field', owner_required:'go_to_field', person_required:'back_to_visits',
 signed_out:'reload', access_denied:'back_to_visits', invalid_command:'go_to_field', json_required:'reload', csrf:'reload', consult_key_unavailable:'retry'
} as const;
export type CloseErrorCode = keyof typeof CLOSE_ERROR_ACTIONS;

export function transientClose(code: string): boolean { return code === 'no_signal' || /^http_(408|429|5\d\d)$/.test(code); }

/** Office queue wording; technical reason stays in the event payload. */
export function officeCloseFailure(code:string):string {
 if(['conflict','stale_snapshot','evidence_conflict'].includes(code))return 'the office changed it since their device last checked; they need to reload and close again';
 if(['device_access_denied','missing_device_manifest_required'].includes(code))return 'another device has this visit — move it or set that device aside';
 if(['manifest_sequence_gap','manifest_blob_missing','manifest_initials_missing','unresolved_rejections'].includes(code))return 'some answers or photos have not reached the office; open the visit and send again';
 if(code==='invalid_command')return 'the office could not read the wrap-up answers; open the visit and check Before you wrap';
 if(code==='close_timeout'||transientClose(code))return 'their device could not reach the office for 30 minutes; open the visit';
 return 'the office turned the close down; open the visit';
}
