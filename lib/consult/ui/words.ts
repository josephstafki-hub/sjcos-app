/**
 * Every word the in-home consultation UI shows (plan §3, §5.2, §5.7, §6, §10).
 * Exact approved copy lives here once; components never invent a sentence.
 * `{n}`, `{name}`, `{field}`, `{check}`, `{reason}` are filled by `fill()`.
 * Error codes come back from the server and the offline engine as data; `plainWords()`
 * maps each to the plan's plain words. An unknown code still gets plain words.
 */
import type { ReadyCheck } from '../readiness.ts';
import type { SkipReason } from '../completeness.ts';

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z_:]+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));
}

export const W = {
  app: 'In-home consultation',
  back: 'Back to SJC OS',
  visits: 'Visits',
  // §5.2 Get ready
  getReady: 'Get ready',
  gettingReady: 'Getting ready…',
  readyOffline: 'Ready offline ✓',
  notReady: 'Not ready',
  noSignal: 'No signal',
  worksUntil: 'Works without signal until {time}',
  keepOpen: 'Keep this screen open.',
  installHint: 'Add to Home Screen for easier access.',
  keepDevice: 'Keep this device until notes are sent.',
  openOnce: 'Open once with signal before the visit.',
  notPreparedYet: "This device hasn’t been made ready yet.",
  usePaper: 'Or use paper and enter the answers here after the visit.',
  tryAgain: 'Try again',
  signIn: 'Sign in',
  reload: 'Reload',
  startVisit: 'Start visit',
  // PIN (§12.1: offline unlock uses the visitor's PIN)
  pinChoose: 'Choose a PIN for this device',
  pinChooseHelp: 'You type it to open this visit without signal. 6 to 12 digits.',
  pinConfirm: 'Type the PIN again',
  pinMismatch: "The two PINs don’t match.",
  pinShort: 'Use 6 to 12 digits.',
  pinEnter: 'PIN for this device',
  unlockLead: 'Unlock this device to open your prepared visit.',
  openVisit: 'Open visit',
  // Status bar §6.2
  notesOff: 'Notes off',
  online: 'Online',
  offlineLine: 'No signal · saved on this device',
  offlineStrip: 'No signal. Saved on this device; sends when signal returns.',
  sendNow: 'Send now',
  sunMode: 'Sun mode',
  on: 'On',
  off: 'Off',
  more: 'More',
  sending: 'Sending',
  sendingNow: 'sending…',
  answersWaiting: 'Answers waiting',
  photosWaiting: 'Photos waiting',
  lastSent: 'Last sent',
  lastTry: 'Last try',
  notYet: 'Not yet',
  allSent: 'All sent ✓',
  signal: 'Signal',
  notes: 'Notes',
  weakSignal: 'Sending answers and photos first.',
  notSentSince: 'Not sent since {time}.',
  sendingWord: 'Sending',
  notSent: 'Not sent',
  backToVisits: '‹ Back to visits',
  nothingWentOut: 'Nothing went out — your answers are safe on this device.',
  nothingWaiting: 'Nothing waiting to send.',
  stillWaiting: 'still waiting',
  codeForJoe: 'For Joe:',
  // Opening / sections
  opening: 'Opening',
  openingLine: 'Today is the detailed visit · about {duration}',
  nextLine: 'Next:',
  sections: 'Sections',
  script: 'Script',
  say: 'Say:',
  next: 'Next ›',
  previous: '‹ Back',
  whatWeKnow: 'What we know so far',
  stillRight: 'Still right ✓',
  correct: 'Correct',
  tapToEnter: 'Tap to measure',
  // r6: the read-only walk-through summary (closing.summary).
  clientInitialedTitle: 'What the client initialed',
  clientInitialedLater: 'Filled when the client initials.',
  showTheRest: 'Show the rest',
  required: 'required',
  skip: 'Skip this field…',
  // r8 extra: a skipped field says the skip took — change its reason, or undo it.
  changeReason: 'Change reason…',
  undoSkip: 'Undo skip',
  /** r8 domain 3: the mark word for a skip that needs no written assumption. */
  skippedMark: 'Skipped',
  /** r8 domain 3: the date field's hint while it is skipped. */
  dateSkippedHint: 'Joe gets a to-do to set the date.',
  /** r8 domain E4: the Complete pill, when quantities that feed the estimate weren't measured. */
  quantitiesNotMeasured: '{n} estimate quantities not measured',
  quantityNotMeasured: '1 estimate quantity not measured',
  /** r8 D3: a kept toilet's advisory card — the choices are in Before you wrap. */
  advisoryTail: 'The choices are in Before you wrap.',
  skipTitle: 'Skip this field',
  skipWhy: 'Why are you skipping it?',
  skipNote: 'Note',
  skipNoteRequired: 'A note is needed for Other.',
  assumptionTitle: 'Written assumption for the estimate',
  assumptionText: 'What we assume',
  assumptionTrade: 'Who is responsible',
  assumptionCheck: 'Where it gets checked',
  assumptionRoute: 'If it turns out different',
  assumptionQty: 'Assumed quantity',
  assumptionUnit: 'Unit',
  assumptionExclusion: 'Or: excluded from the estimate',
  routePrecon: 'Pre-con change',
  routeCo: 'Change order',
  tradeWalkDecided: 'Trade walk decided',
  saveSkip: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  addInstance: '+ Add {name}',
  removeInstance: 'Remove {name}',
  removeConfirm: 'Remove {name} and its answers from this visit?',
  remove: 'Remove',
  instanceName: 'Name it',
  // Keypad §6.6
  readsAs: 'reads as {value}',
  sameAsLast: 'Same as last',
  save: 'Save',
  laserFtIn: 'ft-in',
  laserDecFt: 'decimal ft',
  laserMetric: 'm',
  keyDelete: 'Delete',
  keySpace: 'Space',
  show16ths: 'Show 16ths',
  show8ths: 'Show 8ths',
  unitAmbiguous: 'Is that inches or feet?',
  outOfRange: "That doesn’t look right for this field — check the number.",
  invalidLength: "That isn’t a length this keypad can read.",
  // Photos §6.3
  takePhoto: 'Take photo',
  retake: 'Retake',
  photoSaved: 'Saved on device',
  photoUploading: 'Uploading',
  photoUploaded: 'Uploaded ✓',
  photoRefused: 'This photo couldn’t be sent ({reason}). [Retake]',
  photosOff: 'The client said no to photos — skip each shot with a reason.',
  photosAskFirst: 'Ask “Photos okay?” in House & household first.',
  photosAskAbove: 'Answer “Photos okay?” above first.',
  // Leave check §5.3/§6.3
  leaveStill: '{section} still needs',
  leaveOpen: '○ Open:',
  leavePartly: '◐ Partly:',
  goBack: 'Go back',
  leaveForNow: 'Leave for now',
  // Saving
  saved: 'Saved',
  storageFull: '⚠ Storage full — connect to save, or use paper. The last answer saved: {field}.',
  // Wrap / close §6.9, §5.5
  beforeYouWrap: 'Before you wrap',
  keepWorking: 'Keep working',
  closeVisit: 'Close visit',
  closeVisitNeeds: 'Close visit — needs finishing',
  allClear: 'All price-critical items checked.',
  goToField: 'Go to field',
  goToSection: 'Go to section',
  nOpenInSection: '{n} open',
  reviewFlags: 'Review flags',
  decide: 'Decide',
  flagsLine: 'Flags: {n} needs a decision',
  flagsLinePlural: 'Flags: {n} need a decision',
  tradeWalksLine: 'Trade walks: {trade} — needs a decision',
  conflictsLine: 'Conflicts: {field} — changed on another device',
  visitClosedSending: 'Visit closed — sending',
  // r6 extra: with no signal the heading says when it sends, not that it is sending.
  visitClosedOffline: 'Visit closed — will send when signal returns',
  sendNowNeedsSignal: 'Send now · needs signal',
  // r5 R5-7: with nothing waiting the heading says what is happening; "— sending" only while ⇅ > 0.
  visitClosedChecking: 'Visit closed — checking with the office',
  closeChecking: 'All sent ✓ · Keep this screen open.',
  closeWaitingN: '⇅ {n} waiting to send · Keep this screen open.',
  stillClosing: 'Still closing…',
  stillClosingBody: 'The office hasn’t answered yet. Nothing is lost — your visit is saved on this device.',
  settingUp: 'Setting up sections…',
  setupNotDone: 'Some sections aren’t set up yet.',
  setupAgain: 'Set up sections',
  closeWaiting: 'Close visit is saved on this device and finishes by itself when it can send.',
  complete: 'Complete',
  // r7 R7-1: a Complete visit opened on a device.
  completeLocked: 'Answers are locked. Joe can reopen it from the office look-over.',
  lookOver: 'Look over',
  needsFinishing: 'Needs finishing',
  needsFinishingN: '{n} open. A Finish consultation to-do was made.',
  otherDeviceWaiting: '1 other device hasn’t sent yet — Joe can recover it.',
  otherDevicesWaiting: '{n} other devices haven’t sent yet — Joe can recover them.',
  conflictsToPick: 'A conflict is left to pick.',
  visitCutShort: 'Visit closed — {n} open items. A Finish consultation to-do was made.',
  notClosed: "This visit wasn’t closed.",
  orKeepWorking: 'or keep working.',
  promisedBy: 'Formal estimate promised by',
  promisedMissing: 'Formal estimate date — not picked yet',
  promisedJoeSets: 'Formal estimate date · Joe sets it ✓',
  promisedSkipped: 'Formal estimate date · skipped',
  stillOpen: 'still open',
  pickDate: 'Pick the date',
  // r5 domain 2: the client initials a sheet with the date on it.
  pickDateBeforeClient: 'Pick the estimate date first, so the client sees it.',
  goToSections: 'Go to sections',
  goToPhoto: 'Go to photo',
  addChild: 'Add',
  review: 'Review',
  photosOk: 'Photos okay?',
  // Flags §10.3 check 9
  flagTitle: 'Flags to decide',
  // r6 D4: a flag card leads with the number that tripped it.
  measured: 'Measured',
  priceIt: 'Price it',
  allowance: 'Allowance',
  subMustLook: 'Sub must look before pricing',
  notAnIssue: 'Not an issue — reason',
  flagNote: 'Note (why)',
  // Trade walks §10.3 check 11
  tradeWalkTitle: 'Trade walks',
  needsWalk: 'Needs a sub walk-through before pricing',
  yes: 'Yes',
  no: 'No',
  reason: 'Reason',
  noTrades: 'None — no trade is touched',
  addTrade: '+ Add trade',
  // RRP §10.3 check 8
  rrpTitle: 'Renovate Right',
  rrpReceipt: 'Renovate Right pamphlet given and receipt initialed',
  rrpFirm: 'SJC firm certification is current',
  rrpRenovator: 'Certified renovator certification is current',
  rrpRedelivery: 'Work starts more than 60 days from today — re-deliver before start',
  rrpRedeliveryDay: 'Re-deliver on',
  rrpWhy: 'Built before 1978 (or the year isn’t known), and this job disturbs paint or replaces windows or doors.',
  rrpReceiptOpen: 'Answer “Pamphlet given” Yes in Era hazards and get the client’s initials — or skip it with a reason.',
  rrpFirmOpen: 'Firm certification expiry is missing or before the visit day. Settings › Company fills it in.',
  rrpRenovatorOpen: 'Certified renovator expiry is missing or before the visit day.',
  rrpGoEra: 'Go to Era hazards',
  rrpReview: 'Review',
  rrpRecorded: 'Renovate Right: recorded ✓',
  rrpNeeds: 'Renovate Right: {list}',
  rrpShortReceipt: 'receipt not recorded',
  rrpShortFirm: 'firm certification not current',
  rrpShortRenovator: 'renovator certification not current',
  // r7 extra: until an expiry is entered it isn't "not current", it isn't on file yet.
  rrpShortFirmMissing: 'firm certification not on file',
  rrpShortRenovatorMissing: 'renovator certification not on file',
  // Client view §6.3/§6.4
  showToClient: 'Show to client',
  whatWeWentOver: 'What we went over today',
  stillToDecide: 'Still to decide',
  notMeasuredToday: 'Not measured today',
  moreForEstimate: 'and {n} more — listed on your estimate',
  openQuestions: 'Open questions',
  nextStep: 'Next',
  nextFormal: 'Joe sends your formal estimate by {date}.',
  nextFormalNoDate: 'Joe sends your formal estimate.',
  pickDateFirst: 'Pick the estimate date below, then read this line.',
  initials: 'Initials',
  clearInitials: 'Clear',
  thisIsWhat: 'This is what we went over',
  initialFirst: 'Initial the box first',
  handBackHold: 'Hand back — hold 2 seconds',
  usePin: 'Use PIN instead',
  handBackPin: 'Visitor PIN',
  handBackWithPin: 'Hand back with PIN',
  checkingPin: 'Checking the PIN…',
  // r5 R5-8: curly ’, never &apos;.
  pinWrongHandBack: 'That PIN doesn’t match. Try again, or hold Hand back.',
  initialsSaved: 'Initials saved ✓',
  noInitialsWhy: 'Why were initials skipped?',
  noInitialsSay: 'No initials — say why',
  noInitialsAbsent: 'Client absent',
  noInitialsDeclined: 'Client declined',
  // Conflict picker §6.8
  conflictTitle: '! Conflict · {field}',
  conflictBody: 'This field changed on another device. Pick which value to keep.',
  pick: 'Pick {value}',
  // r7 R7-3: where a conflict side came from, when the office didn't name it.
  thisDevice: 'this device',
  anotherDevice: 'another device',
  office: 'office',
  enterAnother: 'Enter another',
  /** r8 R8-1 extra: the office can't type an answer, so it says how instead of offering a button. */
  officeEnterAnother: 'To use a different value, pick one, then the visitor types the new one on the visit device.',
  pickReason: 'Picked at close',
  // Visit page §6.8
  reopen: 'Reopen',
  reopenReason: 'Why reopen it?',
  applyFindings: 'Apply findings',
  findingsApplied: 'Findings applied ✓ {when}',
  findingsFailed: "Couldn’t apply findings to the scope — [Try again]",
  findingsWaiting: 'Applying findings…',
  visitInterrupted: 'Visit interrupted',
  notSyncedYet: '{photos} still on {name}’s device',
  evidence: 'Evidence',
  feeds: 'Feeds',
  openTheVisit: 'Open the in-home consultation',
  // r5 R5-4: the office reads the look-over on its own screen — never "this device".
  officeDeviceWaiting: '1 device hasn’t sent yet',
  officeDevicesWaiting: '{n} devices haven’t sent yet',
  officeSendFromDevice: '— {name} can send them from the device.',
  officeFinishOnDevice: '— {name} finishes this on the visit device.',
  officeNeedsFinishingLead: '{name} has a Finish consultation to-do.',
  recoverAnswers: 'Recover answers',
  openVisitShort: 'Open the visit',
  // Office schedule §6.9
  schedule: 'Schedule',
  scheduleTitle: 'In-home consultation · {client}',
  whoGoes: 'Who goes',
  date: 'Date',
  time: 'Time',
  templates: 'Templates',
  addOns: 'Add-ons',
  visitorNotes: 'Visitor notes',
  estimatedVisit: 'Estimated visit: about {duration}',
  offerSplit: 'offer separate visits',
  visitorNotesHint: 'No door codes here — they go in Access & logistics on the visit.',
  moveTitle: 'Move this visit',
  moveLead: 'Pick who goes. To move it to another device, keep the same person and give the reason.',
  moveReason: 'Why move it (the old device may still hold unsent answers)',
  moveSave: 'Move visit',
  recoverTitle: 'Recover answers from a set-aside device',
  recoverLead: 'Use this on the original device. Type the visitor’s PIN; the answers go back in under their name for a person to accept.',
  recoverPin: 'Visitor’s PIN on this device',
  recoverReason: 'Why recover them',
  recoverGo: 'Recover answers',
  recoverDone: 'Answers recovered under the original visitor’s name. Photos still waiting on this device need a separate recovery — keep this device.',
  recoverNoCopy: 'This device has no saved copy of this visit. Use the device the visit was filled in on.',
  reassign: 'Change who goes',
  // List §6.3
  today: 'Today',
  onThisDevice: 'On this device',
  itemsWaiting: '{n} items waiting',
  noneToday: 'No consultations today. Schedule from a project Overview.',
  noVisits: 'No consultations assigned to you. Schedule from a project Overview.',
  upcoming: 'Coming up',
  earlier: 'Earlier',
} as const;

/** §10.1 — database values never appear raw. */
export function statusLabel(status: string, open?: number): string {
  switch (status) {
    case 'scheduled': return 'Scheduled';
    case 'in_progress': return 'In progress';
    case 'captured': return W.visitClosedSending;
    case 'incomplete': return open ? `Needs finishing (${open} open)` : 'Needs finishing';
    case 'complete': return 'Complete';
    case 'cancelled': return 'Cancelled';
    default: return 'Scheduled';
  }
}

/** §5.2 check rows. Microphone is Phase 2 (no audio in Phase 1) and is not shown. */
export const READY_ROWS: ReadyCheck[] = ['visit_details', 'forms', 'offline_pages', 'saving_on_device', 'offline_lease'];
export const READY_LABEL: Record<ReadyCheck, string> = {
  visit_details: 'Visit details', forms: 'Forms', offline_pages: 'Offline pages',
  saving_on_device: 'Saving on this device', offline_lease: 'Works without signal', microphone: 'Microphone (optional)',
};

/** §5.7 Get ready reasons — exact words. */
export const READY_REASON = {
  storage: "this browser won’t save here (private mode or storage off)",
  space: 'not enough space — free up {n} MB',
  forms: "couldn’t download the forms",
  pages: "couldn’t download the offline pages",
  signin: 'sign-in for offline use failed — sign in again',
  otherDevice: 'This visit is set up on another device. Use that one, or ask Joe to move it here.',
} as const;

/** Which §5.7 reason a Get ready failure code gets, by the check it failed in. */
export function readyReason(check: ReadyCheck, code: string, neededMb = 50): string {
  if (code === 'device_access_denied') return READY_REASON.otherDevice;
  if (code === 'pin_invalid') return W.pinShort;
  if (code === 'storage_full') return fill(READY_REASON.space, { n: neededMb });
  if (/storage|invalid_capacity/.test(code)) return READY_REASON.storage;
  if (check === 'forms' || code === 'checksum_mismatch' || code === 'missing_forms') return READY_REASON.forms;
  if (check === 'offline_pages' || /precache|manifest|update_required|capture_blocked|no_worker/.test(code)) return READY_REASON.pages;
  if (check === 'saving_on_device') return READY_REASON.storage;
  if (check === 'visit_details' && code === 'snapshot_unavailable') return "couldn’t download the visit details";
  if (/^(signed_out|offline_locked|lease_.*|unauthorized)$/.test(code)) return READY_REASON.signin;
  return plainWords(code);
}

/** §10.2 — the skip sheet lists exactly these, in this order. */
export const SKIP_REASONS: SkipReason[] = ['Not on this job', 'No access', 'Not safe to measure', 'Client declined', 'Get on return visit', 'Sub/supplier will measure', 'Other'];
export const skipReasonsFor = (field?: {type?:string;key?:string}): SkipReason[] => field?.type === 'signature' ? ['Client absent','Client declined','Other'] : field?.key === 'estimate_promised' ? ['Joe sets the date','Other'] : SKIP_REASONS;
export const SKIP_HELP: Record<SkipReason, string> = {
  'Client absent': 'The client wasn’t here to initial.',
  'Joe sets the date': 'Joe gets a to-do to set the date and tell the client.',
  'Not on this job': 'Counts once the job conditions show it isn’t needed.',
  'No access': 'Needs a written assumption or exclusion for the estimate.',
  'Not safe to measure': 'Needs a written assumption or exclusion for the estimate.',
  'Client declined': 'Needs a written assumption or exclusion if it prices the job.',
  'Get on return visit': 'Stays Open; one return-visit to-do is made.',
  'Sub/supplier will measure': 'Needs who measures, an assumption, and a trade walk decision.',
  'Other': 'Needs a note.',
};
/** r7 R7-5 / domain 4: signature fields get their own notes — no assumption is asked for there. */
const SKIP_HELP_SIGNATURE: Partial<Record<SkipReason, string>> = {
  'Client absent': 'The client wasn’t here to initial.',
  'Client declined': 'The client chose not to initial. Write what they said.',
  'Other': 'Needs a note.',
};
export function skipHelp(field: { type?: string; key?: string } | undefined, reason: SkipReason): string {
  if (field?.type === 'signature') return SKIP_HELP_SIGNATURE[reason] ?? SKIP_HELP[reason];
  return SKIP_HELP[reason];
}
/** The skip reasons that need a written assumption on a price-critical field (the skip sheet asks for one). */
const ASSUMPTION_REASONS: SkipReason[] = ['No access', 'Not safe to measure', 'Client declined', 'Sub/supplier will measure', 'Other'];
export function skipNeedsAssumption(def: { type?: string; key?: string; tier?: string }, reason: SkipReason | string | undefined): boolean {
  return !!reason && def.type !== 'signature' && def.key !== 'estimate_promised' && (def.tier ?? 'price_critical') === 'price_critical' && ASSUMPTION_REASONS.includes(reason as SkipReason);
}
const MEASUREMENT = /^(length|length_pair|number|count)$/;
/**
 * r7 R7-5: one line for a skipped field, on the device and in the office — "Skipped · {reason} · {note}".
 * The N/A is the mark's word, never repeated here; "assumption written" only on a measurement that has one.
 */
export function skipLine(f: { def: { type?: string; key?: string; tier?: string }; answer?: { skip_reason?: string; skip_note?: string }; skipCounts: boolean; returnVisit: boolean }): string {
  const reason = f.answer?.skip_reason ?? '';
  const note = f.answer?.skip_note?.trim();
  let tail = '';
  if (reason === 'Not on this job') tail = f.skipCounts ? '' : ' — the job needs it, so it stays Open';
  else if (!f.returnVisit && skipNeedsAssumption(f.def, reason)) tail = !f.skipCounts ? ' — needs a written assumption to count' : MEASUREMENT.test(f.def.type ?? '') ? ' — assumption written' : '';
  return `Skipped · ${reason}${tail}${note && note !== reason ? ` · ${note}` : ''}`;
}

/**
 * r8 domain 3: a skip that needs no written assumption ("Joe sets the date", a client who was away
 * or declined to initial, a record field) reads "– Skipped" on the right, not "– N/A" — the field
 * applies, it just wasn't filled. "Not on this job" stays N/A; a return visit stays Open.
 */
export function skippedNotNA(f: { def: { type?: string; key?: string; tier?: string }; answer?: { status?: string; skip_reason?: string } }): boolean {
  const reason = f.answer?.skip_reason;
  if (f.answer?.status !== 'skipped' || !reason || reason === 'Not on this job' || reason === 'Get on return visit') return false;
  return !skipNeedsAssumption(f.def, reason);
}

/** r8 domain E4: "3 estimate quantities not measured" — empty when every quantity was measured. */
export function quantitiesLine(n: number): string {
  return n <= 0 ? '' : n === 1 ? W.quantityNotMeasured : fill(W.quantitiesNotMeasured, { n });
}

/** r8 office extra: "checked before pricing", not "checked at Before pricing". */
export function checkedAt(point: string): string {
  const p = point.trim();
  return /^(before|after|at|during|when|on|in)\b/i.test(p) ? `checked ${p.charAt(0).toLowerCase()}${p.slice(1)}` : `checked at ${p}`;
}

/** §10.3 — the eleven checks in plain words, in order. */
export const CHECK_WORDS: Record<string, string> = {
  required_fields: 'Every required answer is in, or skipped with a reason that counts',
  required_photos: 'Every required photo is uploaded, or skipped with a reason',
  module_requirements: 'Every room and item the template needs is on the visit',
  permissions: 'Recording and photo permission were asked',
  client_acknowledgement: 'The client initialed the walk-through summary, or you wrote why not',
  promised_date: 'The formal estimate promised-by date is set',
  close_manifests: 'Everything on this device reached the office, with no conflict left to pick',
  rrp: 'Renovate Right receipt and certifications are recorded',
  flag_decisions: 'Every flag has a decision',
  risk_assumptions: 'Every no-access or unsafe skip has a written assumption',
  trade_walks: 'Every touched trade has a sub walk-through decision',
};

/** r5 R5-4: the office's words for a check whose device words would say "this device". */
export const OFFICE_CHECK_WORDS: Record<string, string> = {
  ...CHECK_WORDS,
  close_manifests: 'Every device’s answers reached the office, with no conflict left to pick',
};

/** Per-check count in words on the close result and the look-over (the headline holds the one total).
 *  r5 R5-4: shown for one item too, so a single open row never reads like a done one. */
export function checkCount(code: string, n: number): string {
  if (!n) return '';
  if (code === 'required_fields') return ` · ${n} ${n === 1 ? 'answer' : 'answers'}`;
  if (code === 'required_photos') return ` · ${n} ${n === 1 ? 'photo' : 'photos'}`;
  if (code === 'flag_decisions') return ` · ${n} ${n === 1 ? 'flag' : 'flags'}`;
  if (code === 'module_requirements' || code === 'risk_assumptions' || code === 'trade_walks') return ` · ${n} left`;
  return '';
}

/** r5: the button each open close check carries, by its `action` (lib/consult/completeness closeAction). */
export const CHECK_ACTION_WORDS: Record<string, string> = {
  go_field: W.goToField, take_photo: W.goToPhoto, add_instance: W.goToSections, review_permissions: W.goToField,
  show_client: W.showToClient, pick_date: W.pickDate, review_sync: W.sendNow, review_rrp: W.review,
  review_flags: W.reviewFlags, review_assumptions: W.review, review_trades: W.decide,
};

export const FLAG_CHOICES = [
  { key: 'price_it', label: W.priceIt },
  { key: 'allowance', label: W.allowance },
  { key: 'sub_must_look', label: W.subMustLook },
  { key: 'not_an_issue', label: W.notAnIssue },
] as const;

/**
 * Error code (server JSON, receipt, offline engine, vault) → plain words.
 * Exact §5.7 copy where the plan has a row; otherwise short plain words with
 * no internal term (sync, lease, precache, token…).
 */
export function plainWords(code: string | undefined | null, ctx: { name?: string; field?: string } = {}): string {
  const c = code ?? '';
  // r7 R7-2: the office slow to answer (request deadline, rate limit, server busy) is a calm wait.
  if (/^http_(408|429|5\d\d)$/.test(c)) return W.stillClosingBody;
  switch (c) {
    case 'send_stuck': return 'Nothing went out — your answers are safe on this device.';
    case 'send_in_progress': return 'Sending…';
    case 'close_timeout': return 'Still closing — try again. Your visit is saved on this device.';
    case 'controller_disposed': return 'This visit was closed. Open it again to send.';
    case 'retry_wait': return 'Saved on this device. Waiting briefly before trying again.';
    case 'op_too_large': return 'An answer is too large to send. Ask Joe to help recover it.';
    case 'transport_invocation': return 'Sending could not start. Reload and try again.';
    case 'no_signal': case 'network': return 'No signal. Saved on this device; sends when signal returns.';
    case 'signed_out': return fill('Signed out — your answers are safe on this device. Sign in as {name} to send them.', { name: ctx.name ?? 'yourself' });
    case 'offline_locked': return fill('Signed out — your answers are safe on this device. Sign in as {name} to send them.', { name: ctx.name ?? 'yourself' });
    case 'device_access_denied': return 'This visit is being filled in on another device. Use that device, or ask Joe to move it here.';
    case 'pin_invalid': return 'Use 6 to 12 digits.';
    case 'revoked': case 'offline_quarantined': case 'access_denied':
      return 'Your access to this visit was removed. Your answers are locked on this device and Joe can recover them.';
    case 'deleted': return 'This visit was removed from the office. Nothing more can be sent from this device.';
    case 'update_required': return 'Update ready — reload between rooms.';
    case 'storage_full': return fill(W.storageFull, { field: ctx.field ?? '—' });
    case 'storage_blocked': case 'storage_unavailable': return "This browser won’t save here (private mode or storage off).";
    case 'invalid_pin': return "That PIN doesn’t match. Try again.";
    case 'pin_retry_later': return 'Too many tries. Wait a minute, then try the PIN again.';
    case 'not_prepared': return "This device hasn’t been made ready yet. Open once with signal before the visit.";
    case 'capture_disabled': case 'capture_blocked': return 'In-home consultations are switched off right now. Use paper and enter the answers here later.';
    case 'conflict': return 'This changed in the office since you opened it. Reload to see the latest.';
    case 'rebase_required': return 'This visit was reopened since this answer was typed. Pick which value to keep.';
    case 'complete_locked': return 'This visit is Complete, so answers are locked. Reopen it to change anything.';
    case 'visit_not_started': return 'Start the visit first.';
    case 'manifest_sequence_gap': case 'unresolved_rejections': return 'Some answers haven’t reached the office yet. Send now, then close again.';
    case 'manifest_blob_missing': case 'manifest_initials_missing': return 'Some photos haven’t reached the office yet. Send now, then close again.';
    case 'invalid_operation': return "This answer couldn’t be saved in the office. Check it and enter it again.";
    case 'out_of_range': return W.outOfRange;
    case 'length_precision': return 'Lengths save to the nearest 1/16″.';
    case 'text_required': return 'Type an answer, or skip this field with a reason.';
    case 'distinct_choices_required': return 'Pick at least one.';
    case 'photo_permission_required': return 'The client said no to photos on this visit.';
    case 'invalid_image': return 'wrong file type';
    case 'body_too_large': return 'too big';
    case 'upload_expired': return 'it took too long — take it again';
    case 'hash_mismatch': case 'invalid_hash': return 'the photo changed while sending — take it again';
    case 'missing_device_manifest_required': return 'The previous device has not closed. Get its close manifest, or give Joe’s reason for setting it aside; unsent work may be missing.';
    case 'owner_required': return 'Only Joe can do this.';
    case 'invalid_visitor': return 'That person can’t do visits. Pick someone with Projects access.';
    case 'csrf': return 'Reload this page, then try again.';
    case 'consult_key_unavailable': return 'The office server isn’t ready. Try again in a minute.';
    case 'local_conflict': return 'This visit is open in another tab. Close the other tab, then reload.';
    case 'missing_precache': case 'checksum_mismatch': case 'invalid_manifest': return "Couldn’t download the offline pages.";
    case 'snapshot_unavailable': return "Couldn’t download the visit details.";
    case 'unknown_proposal': case 'proposal_mismatch': return 'That value was already decided.';
    case 'stale_snapshot': return 'This device has an older copy of the visit. Reload.';
    case 'findings_failed': return "Couldn’t apply findings to the scope — Try again";
    default: return 'Something went wrong. Your answers are still saved on this device. Try again.';
  }
}

/** Visit length from the pinned templates and add-ons (§7.2 `{duration}`, §6.9). Minutes [min, max]. */
export const TEMPLATE_MINUTES: Record<string, [number, number]> = {
  bath: [90, 120], kitchen: [120, 120], basement: [120, 120], deck: [60, 60], addition: [120, 120], whole: [180, 240], general: [45, 45], garage: [30, 60], flooring: [30, 30], openings: [30, 60],
};
/** Nearest half hour, written with ½: 210 → "3½", 30 → "½". */
const hours = (n: number) => { const h = Math.round(n / 30) / 2; return `${Math.floor(h) || ''}${h % 1 ? '½' : ''}` || '0'; };
const span = ([lo, hi]: [number, number]) => `${hours(lo)}${hours(hi) !== hours(lo) ? `–${hours(hi)}` : ''}`;
const unit = ([, hi]: [number, number]) => (Math.round(hi / 30) / 2 <= 1 ? 'hour' : 'hours');
/**
 * Office estimate. `duration` is the summed range ("3½–4 hours"; whole-home adds ", or two
 * scheduled visits"); `suggestSplit` is the separate office hint and is never read aloud.
 */
export function visitTiming(keys: string[]) {
  const list = [...new Set(keys)].filter((k) => TEMPLATE_MINUTES[k]);
  const minutes = list.reduce<[number, number]>((sum, k) => [sum[0] + TEMPLATE_MINUTES[k][0], sum[1] + TEMPLATE_MINUTES[k][1]], [0, 0]);
  const whole = list.includes('whole');
  const duration = list.length ? `${span(minutes)} ${unit(minutes)}${whole ? ', or two scheduled visits' : ''}` : '';
  return { minutes, duration, suggestSplit: minutes[1] > 180 || whole, components: list.map((key) => ({ key, minutes: TEMPLATE_MINUTES[key] })) };
}
export function visitDuration(keys: string[]): string { return visitTiming(keys).duration; }
/** One component in the office breakdown: "Kitchen 2 h", "Bathroom 1½–2 h". */
export function componentDuration(minutes: [number, number]): string { return `${span(minutes)} h`; }

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const spokenFull = (h: number): string => {
  if (h === 0.5) return 'half an hour';
  if (h === 1) return 'an hour';
  if (h === 1.5) return 'an hour and a half';
  const n = Math.floor(h);
  return `${NUM[n] ?? String(n)}${h % 1 ? ' and a half' : ''} hours`;
};
const spokenBare = (h: number): string => (h === 1 ? 'one' : h < 2 ? spokenFull(h) : `${NUM[Math.floor(h)] ?? String(Math.floor(h))}${h % 1 ? ' and a half' : ''}`);
/**
 * Spoken `{duration}` for opening line 3 (§7.2): words only, no office hint.
 * bath → "an hour and a half to two hours"; bath + kitchen → "three and a half to four hours";
 * general → "forty-five minutes"; whole → "three to four hours". Whether whole-home is split into two
 * scheduled visits is decided in the office before the visit, so it is never said aloud (r2 item 2).
 */
export function spokenDuration(keys: string[]): string {
  const t = visitTiming(keys);
  if (!t.duration) return '';
  const [lo, hi] = t.minutes;
  if (hi < 60 && hi % 30 !== 0) return lo === hi && lo === 45 ? 'forty-five minutes' : `${lo} to ${hi} minutes`;
  const a = Math.round(lo / 30) / 2, b = Math.round(hi / 30) / 2;
  const said = a === b ? spokenFull(b) : `${spokenBare(a)} to ${spokenFull(b)}`;
  return said;
}

/** One label for field, office and offline conflict sides. Times are job-local. */
export function conflictSideLabel(side: {person?: string; actor?: string|null; device_id?: string|null; device?: string|null; created_at?: string|Date}, other?: {person?: string; actor?: string|null; created_at?: string|Date}, thisDevice?: string): string {
 const first = side.person?.trim().split(/\s+/)[0] || 'Visitor';
 const time = (at?: string|Date) => at && Number.isFinite(new Date(at).getTime()) ? new Date(at).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase() : '';
 const device=side.device_id ?? side.device;
 const clock=time(side.created_at);
 if(thisDevice && device===thisDevice)return `this device${clock?' · '+clock:''}`;
 if(!device)return `office · ${first}`;
 const same=other && (side.actor && other.actor ? side.actor===other.actor : !!side.person && side.person===other.person);
 if(!same)return first;
 const tie=clock && clock===time(other.created_at);
 const order=tie ? (new Date(side.created_at!).getTime()<=new Date(other.created_at!).getTime()?' · earlier':' · later') : '';
 return `${first}${clock?' · '+clock:''}${order}`;
}
