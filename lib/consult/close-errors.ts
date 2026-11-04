/** Stable hooks for the close refusal UI, including its transport and evidence steps.
 *  r11 R11-1: each code's button goes where its line says — Before you wrap, Trade walks, Sign in —
 *  and where only Joe can act the screen offers Keep working alone (no dead button). */
export const CLOSE_ERROR_ACTIONS = {
 conflict:'reload', stale_snapshot:'reload', evidence_conflict:'reload', complete_locked:'back_to_visits',
 manifest_sequence_gap:'send_now', unresolved_rejections:'send_now', manifest_blob_missing:'send_now', manifest_initials_missing:'send_now',
 rebase_required:'go_to_field', device_access_denied:'keep_working', missing_device_manifest_required:'keep_working',
 evidence_too_large:'keep_working', batch_too_large:'keep_working', owner_required:'trade_walks', person_required:'back_to_visits',
 signed_out:'sign_in', access_denied:'back_to_visits', invalid_command:'before_you_wrap', json_required:'reload', csrf:'reload', consult_key_unavailable:'retry'
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

/** r11 R11-1: where a refusal's `details[].field` (a Zod path such as `evidence.rrp.redelivery_day`)
 *  points on the visit. `sheet` opens a wrap sheet; `addr` focuses a field; null = Before you wrap. */
export type RefusalFocus = { sheet: 'rrp' | 'flags' | 'trades' | 'ack' | 'wrap' } | { addr: string } | { closing: 'estimate_promised' } | { house: 'photos_ok' };
export function refusalFocus(field: string | null | undefined): RefusalFocus | null {
 if (!field) return null;
 const parts = field.split('.');
 if (parts[0] === 'evidence' || parts[0] === 'input') parts.shift();
 const [head, key] = parts;
 switch (head) {
  case 'rrp': return { sheet: 'rrp' };
  case 'flags': return { sheet: 'flags' };
  case 'trade_walks': case 'touched_trades': case 'no_trades_confirmed': case 'return_day': return { sheet: 'trades' };
  case 'ack_reason': return { sheet: 'ack' };
  case 'promised_date': return { closing: 'estimate_promised' };
  case 'photos_ok': return { house: 'photos_ok' };
  // Skips are keyed by the field's own address ("instance:field").
  case 'skips': return key && key.includes(':') ? { addr: key } : { sheet: 'wrap' };
  default: return null;
 }
}
