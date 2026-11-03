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
  notPreparedYet: "This device hasn't been made ready yet.",
  usePaper: 'Or use paper and enter the answers here after the visit.',
  tryAgain: 'Try again',
  signIn: 'Sign in',
  reload: 'Reload',
  startVisit: 'Start visit',
  // PIN (§12.1: offline unlock uses the visitor's PIN)
  pinChoose: 'Choose a PIN for this device',
  pinChooseHelp: 'You type it to open this visit without signal. 4 to 8 digits.',
  pinConfirm: 'Type the PIN again',
  pinMismatch: "The two PINs don't match.",
  pinShort: 'Use 4 to 8 digits.',
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
  more: 'More',
  // Opening / sections
  opening: 'Opening',
  sections: 'Sections',
  script: 'Script',
  say: 'Say:',
  next: 'Next ›',
  previous: '‹ Back',
  whatWeKnow: 'What we know so far',
  stillRight: 'Still right ✓',
  correct: 'Correct',
  tapToEnter: 'tap to enter',
  required: 'required',
  skip: 'Skip this field…',
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
  unitAmbiguous: 'Is that inches or feet?',
  outOfRange: "That doesn't look right for this field — check the number.",
  invalidLength: "That isn't a length this keypad can read.",
  // Photos §6.3
  takePhoto: 'Take photo',
  retake: 'Retake',
  photoSaved: 'Saved on device',
  photoUploading: 'Uploading',
  photoUploaded: 'Uploaded ✓',
  photoRefused: 'This photo couldn\'t be sent ({reason}). [Retake]',
  photosOff: 'The client said no to photos — skip each shot with a reason.',
  // Leave check §5.3/§6.3
  leaveStill: '{section} still needs · {list}',
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
  reviewFlags: 'Review flags',
  decide: 'Decide',
  flagsLine: 'Flags: {n} needs a decision',
  flagsLinePlural: 'Flags: {n} need a decision',
  tradeWalksLine: 'Trade walks: {trade} — needs a decision',
  conflictsLine: 'Conflicts: {field} — changed on another device',
  visitClosedSending: 'Visit closed — sending',
  complete: 'Complete',
  needsFinishing: 'Needs finishing',
  needsFinishingN: 'Needs finishing — {n} open; a Finish consultation to-do was made.',
  visitCutShort: 'Visit closed — {n} open items. A Finish consultation to-do was made.',
  notClosed: "This visit wasn't closed.",
  orKeepWorking: 'or keep working.',
  promisedBy: 'Formal estimate promised by',
  photosOk: 'Photos okay?',
  // Flags §10.3 check 9
  flagTitle: 'Flags to decide',
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
  rrpReceipt: 'Renovate Right pamphlet given and receipt initialled',
  rrpFirm: 'SJC firm certification is current',
  rrpRenovator: 'Certified renovator certification is current',
  rrpRedelivery: 'Work starts more than 60 days from today — re-deliver before start',
  rrpRedeliveryDay: 'Re-deliver on',
  // Client view §6.3/§6.4
  showToClient: 'Show to client',
  whatWeWentOver: 'What we went over today',
  stillToDecide: 'Still to decide',
  openQuestions: 'Open questions',
  nextStep: 'Next',
  nextFormal: 'formal estimate {date}',
  initials: 'Initials',
  clearInitials: 'Clear',
  thisIsWhat: 'This is what we went over',
  handBackHold: 'Hand back — hold 2 seconds',
  usePin: 'Use PIN instead',
  handBackPin: 'Visitor PIN',
  initialsSaved: 'Initials saved ✓',
  noInitialsWhy: 'Why were initials skipped?',
  noInitialsAbsent: 'Client absent',
  noInitialsDeclined: 'Client declined',
  // Conflict picker §6.8
  conflictTitle: '! Conflict · {field}',
  conflictBody: 'This field changed on another device. Pick which value to keep.',
  pick: 'Pick {value}',
  enterAnother: 'Enter another',
  pickReason: 'Picked at close',
  // Visit page §6.8
  reopen: 'Reopen',
  reopenReason: 'Why reopen it?',
  applyFindings: 'Apply findings',
  findingsApplied: 'Findings applied ✓ {when}',
  findingsFailed: "Couldn't apply findings to the scope — [Try again]",
  findingsWaiting: 'Applying findings…',
  visitInterrupted: 'Visit interrupted',
  notSyncedYet: '{photos} still on {name}’s device',
  evidence: 'Evidence',
  feeds: 'Feeds',
  openTheVisit: 'Open the in-home consultation',
  // Office schedule §6.9
  schedule: 'Schedule',
  scheduleTitle: 'In-home consultation · {client}',
  whoGoes: 'Who goes',
  date: 'Date',
  time: 'Time',
  templates: 'Templates',
  addOns: 'Add-ons',
  visitorNotes: 'Visitor notes',
  estimatedVisit: 'Estimated visit: {duration}',
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
  storage: "this browser won't save here (private mode or storage off)",
  space: 'not enough space — free up {n} MB',
  forms: "couldn't download the forms",
  pages: "couldn't download the offline pages",
  signin: 'sign-in for offline use failed — sign in again',
} as const;

/** Which §5.7 reason a Get ready failure code gets, by the check it failed in. */
export function readyReason(check: ReadyCheck, code: string, neededMb = 50): string {
  if (code === 'storage_full') return fill(READY_REASON.space, { n: neededMb });
  if (/storage|invalid_capacity/.test(code)) return READY_REASON.storage;
  if (check === 'forms' || code === 'checksum_mismatch' || code === 'missing_forms') return READY_REASON.forms;
  if (check === 'offline_pages' || /precache|manifest|update_required|capture_blocked|no_worker/.test(code)) return READY_REASON.pages;
  if (check === 'saving_on_device') return READY_REASON.storage;
  if (check === 'visit_details' && code === 'snapshot_unavailable') return "couldn't download the visit details";
  return READY_REASON.signin;
}

/** §10.2 — the skip sheet lists exactly these, in this order. */
export const SKIP_REASONS: SkipReason[] = ['Not on this job', 'No access', 'Not safe to measure', 'Client declined', 'Get on return visit', 'Sub/supplier will measure', 'Other'];
export const SKIP_HELP: Record<SkipReason, string> = {
  'Not on this job': 'Counts once the job conditions show it isn’t needed.',
  'No access': 'Needs a written assumption or exclusion for the estimate.',
  'Not safe to measure': 'Needs a written assumption or exclusion for the estimate.',
  'Client declined': 'Needs a written assumption or exclusion if it prices the job.',
  'Get on return visit': 'Stays Open; one return-visit to-do is made.',
  'Sub/supplier will measure': 'Needs who measures, an assumption, and a trade walk decision.',
  'Other': 'Needs a note.',
};

/** §10.3 — the eleven checks in plain words, in order. */
export const CHECK_WORDS: Record<string, string> = {
  required_fields: 'Every required answer is in, or skipped with a reason that counts',
  required_photos: 'Every required photo is uploaded, or skipped with a reason',
  module_requirements: 'Every room and item the template needs is on the visit',
  permissions: 'Recording and photo permission were asked',
  client_acknowledgement: 'The client initialled the walk-through summary, or you wrote why not',
  promised_date: 'The formal estimate promised-by date is set',
  close_manifests: 'Everything on this device reached the office, with no conflict left to pick',
  rrp: 'Renovate Right receipt and certifications are recorded',
  flag_decisions: 'Every flag has a decision',
  risk_assumptions: 'Every no-access or unsafe skip has a written assumption',
  trade_walks: 'Every touched trade has a sub walk-through decision',
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
  switch (c) {
    case 'no_signal': case 'network': return 'No signal. Saved on this device; sends when signal returns.';
    case 'signed_out': return fill('Signed out — your answers are safe on this device. Sign in as {name} to send them.', { name: ctx.name ?? 'yourself' });
    case 'offline_locked': return fill('Signed out — your answers are safe on this device. Sign in as {name} to send them.', { name: ctx.name ?? 'yourself' });
    case 'revoked': case 'offline_quarantined': case 'device_access_denied': case 'access_denied':
      return 'Your access to this visit was removed. Your answers are locked on this device and Joe can recover them.';
    case 'deleted': return 'This visit was removed from the office. Nothing more can be sent from this device.';
    case 'update_required': return 'Update ready — reload between rooms.';
    case 'storage_full': return fill(W.storageFull, { field: ctx.field ?? '—' });
    case 'storage_blocked': case 'storage_unavailable': return "This browser won't save here (private mode or storage off).";
    case 'invalid_pin': return "That PIN doesn't match. Try again.";
    case 'pin_retry_later': return 'Too many tries. Wait a minute, then try the PIN again.';
    case 'not_prepared': return "This device hasn't been made ready yet. Open once with signal before the visit.";
    case 'capture_disabled': case 'capture_blocked': return 'In-home consultations are switched off right now. Use paper and enter the answers here later.';
    case 'conflict': return 'This changed in the office since you opened it. Reload to see the latest.';
    case 'rebase_required': return 'This visit was reopened since this answer was typed. Pick which value to keep.';
    case 'complete_locked': return 'This visit is Complete, so answers are locked. Reopen it to change anything.';
    case 'visit_not_started': return 'Start the visit first.';
    case 'manifest_sequence_gap': case 'unresolved_rejections': return 'Some answers haven’t reached the office yet. Send now, then close again.';
    case 'manifest_blob_missing': case 'manifest_initials_missing': return 'Some photos haven’t reached the office yet. Send now, then close again.';
    case 'invalid_operation': return "This answer couldn't be saved in the office. Check it and enter it again.";
    case 'out_of_range': return W.outOfRange;
    case 'length_precision': return 'Lengths save to the nearest 1/16″.';
    case 'text_required': return 'Type an answer, or skip this field with a reason.';
    case 'distinct_choices_required': return 'Pick at least one.';
    case 'photo_permission_required': return 'The client said no to photos on this visit.';
    case 'invalid_image': return 'wrong file type';
    case 'body_too_large': return 'too big';
    case 'upload_expired': return 'it took too long — take it again';
    case 'hash_mismatch': case 'invalid_hash': return 'the photo changed while sending — take it again';
    case 'owner_required': return 'Only Joe can do this.';
    case 'invalid_visitor': return 'That person can’t do visits. Pick someone with Projects access.';
    case 'csrf': return 'Reload this page, then try again.';
    case 'consult_key_unavailable': return 'The office server isn’t ready. Try again in a minute.';
    case 'local_conflict': return 'This visit is open in another tab. Close the other tab, then reload.';
    case 'missing_precache': case 'checksum_mismatch': case 'invalid_manifest': return "Couldn't download the offline pages.";
    case 'snapshot_unavailable': return "Couldn't download the visit details.";
    case 'unknown_proposal': case 'proposal_mismatch': return 'That value was already decided.';
    case 'stale_snapshot': return 'This device has an older copy of the visit. Reload.';
    case 'findings_failed': return "Couldn't apply findings to the scope — Try again";
    default: return 'Something went wrong. Your answers are still saved on this device. Try again.';
  }
}

/** Plain duration from the template (§7.2 `{duration}`). */
export const TEMPLATE_DURATION: Record<string, string> = {
  bath: '90–120 min', kitchen: '2 hours', basement: '2 hours', deck: '60 min', addition: '2 hours', whole: '3–4 hours', general: '45 min',
};
export function visitDuration(keys: string[]): string {
  const list = keys.filter((k) => TEMPLATE_DURATION[k]);
  if (keys.includes('whole')) return '3–4 hours; offer separate visits';
  if (list.length > 1) return `${list.map((k) => TEMPLATE_DURATION[k]).join(' + ')}; offer separate visits`;
  return TEMPLATE_DURATION[list[0] ?? 'general'];
}
