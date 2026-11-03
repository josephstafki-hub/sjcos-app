/** Stable hooks for the close refusal UI, including its transport and evidence steps. */
export const CLOSE_ERROR_ACTIONS = {
 conflict:'reload', stale_snapshot:'reload', evidence_conflict:'reload', complete_locked:'back_to_visits',
 manifest_sequence_gap:'send_now', unresolved_rejections:'send_now', manifest_blob_missing:'send_now', manifest_initials_missing:'send_now',
 rebase_required:'go_to_field', device_access_denied:'go_to_field', missing_device_manifest_required:'go_to_field',
 evidence_too_large:'go_to_field', batch_too_large:'go_to_field', owner_required:'go_to_field', person_required:'back_to_visits',
 signed_out:'reload', access_denied:'back_to_visits', invalid_command:'go_to_field', json_required:'reload', csrf:'reload', consult_key_unavailable:'retry'
} as const;
export type CloseErrorCode = keyof typeof CLOSE_ERROR_ACTIONS;
