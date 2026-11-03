// Plan §7.2 and §8.1 scripts, verbatim (spoken words only in `text`; stage directions in `direction`).
// Placeholders are filled by the caller: {helper}, {name}, {duration}, {estimate_date}, {open_selections}, {tablet/phone}, {Name}.

export interface ScriptLine { n: string; text: string; direction?: string; answer_to?: string }

export const OPENING_JOE: ScriptLine[] = [
  { n: '1', text: 'Hi, I\'m Joe — thanks for having us. This is {helper}, who\'ll help me measure.', direction: 'skip the second sentence if alone' },
  { n: '2', text: 'Today is the detailed visit. The rough estimate you signed set the direction; today I measure everything and look behind the walls as much as I can — the panel, the plumbing, what\'s under the floor — so the formal estimate is exact and we have fewer surprises once we start.' },
  { n: '3', text: 'It takes about {duration}. We\'ll start with a few questions here, then walk each room together, and at the end I\'ll read back what we went over so you can correct me.' },
  { n: '4', text: 'Some of what I check is under sinks, in closets, in the basement and at the attic hatch. I\'ll ask before I open anything, and I won\'t take anything apart.' },
  { n: '4b', text: 'I’ll take photos of the rooms, closets, the basement and the mechanicals so I can price it right — I’ll keep people and personal things out of them. Is that okay?', answer_to: 'house.photos_ok' },
  { n: '5', text: 'I won\'t have prices for you today — those come with the formal estimate. If I see something today that changes the plan from the rough estimate, I\'ll tell you while we\'re standing there.' },
  { n: '6', text: 'Before we start — is there anything you want to make sure we look at today?', direction: 'answer goes into House & household › Client\'s own list', answer_to: 'house.client_list' },
];

/** Staff opening: replaces lines 1–2; lines 3–6 (including 4b) unchanged. */
export const STAFF_OPENING_LINE = 'Hi, I\'m {name} with SJ Carpentry. Joe asked me to do the detailed measurements today. Everything I gather goes straight to Joe for the formal estimate.';
export const OPENING_STAFF: ScriptLine[] = [{ n: '1–2', text: STAFF_OPENING_LINE }, ...OPENING_JOE.slice(2)];

export const CLOSING_JOE: ScriptLine[] = [
  { n: '1', text: 'That\'s everything I need. Let me read back what we went over, so you can tell me if I missed or misheard anything.', direction: '→ Walk-through summary screen, turned to the client.' },
  { n: '2', text: 'Next, I price this with our trade partners and suppliers. You\'ll have the formal estimate by {estimate_date}. It shows each part of the work, the allowances for the things you\'re still choosing, and what isn\'t included.' },
  { n: '3', text: 'The things still to choose are: {open_selections}. Those don\'t hold up the estimate — they show as allowances until you pick.' },
  { n: '4', text: 'If you think of anything — old drawings, the survey, a picture of something you like — reply to my email or text me.' },
  { n: '5', text: 'Any questions for me before we go?', direction: 'answers → Closing › Client questions', answer_to: 'closing.client_questions' },
  { n: '6', text: 'Thanks for your time. We\'ll put back anything we moved.' },
];
/** Staff closing: adds this line after line 2. */
export const STAFF_CLOSING_LINE = 'Joe prices the estimate from everything I measured today, and he may call you with a question or two.';
export const CLOSING_STAFF: ScriptLine[] = [...CLOSING_JOE.slice(0, 2), { n: '2b', text: STAFF_CLOSING_LINE }, ...CLOSING_JOE.slice(2)];

export const SCRIPT_RULES = {
  opening: 'Shown on the Start screen, one card per line, Next advances; field-entry Next differs as §6.3 defines.',
  placeholders: '{helper} / {name} from the logged-in users on the consult. {duration} from the template.',
  estimate_date: '{estimate_date} is picked by the visitor on the Closing screen (date picker, default blank, required); it also files a to-do for Joe due that day: "Formal estimate promised to {client}."',
  open_selections: '{open_selections} is read from the Selections module (status ≠ exact product).',
} as const;

/** `{duration}` per template (§7.2). */
export const TEMPLATE_DURATIONS: Record<string, string> = {
  bath: '90–120 min', kitchen: '2 h', basement: '2 h', deck: '60 min', addition: '2 h', whole: '3–4 h or two scheduled visits', general: '45 min',
};

export const LEAD_SAFE_PAMPHLET = {
  when: 'house built before 1978, work disturbs paint — shown inside the Era hazards module',
  text: 'Because the house was built before 1978, the law requires us to give you this pamphlet about lead-safe work — it\'s called Renovate Right. Could you initial here that you got it?',
  direction: 'client initials on SignaturePad',
} as const;

/** §8.1 recording consent — notice `consult-2026-11-v2`. The device word is the notice's one variable. */
export const CONSENT = {
  notice_version: 'consult-2026-11-v2',
  method: 'verbal_in_person',
  variable: '{tablet/phone}',
  script: 'Before we start — I\'d like to record our conversation on this {tablet/phone} so I don\'t miss anything you tell me. An AI tool we use turns the words into my notes and measurements. We turn the recording into text on our own server and then delete the recording. The text goes to our AI provider, and our secure offsite backups keep copies for a limited time. We don\'t post it or share it beyond the services we use for this work. Is that okay with everyone here? You can tell me to stop at any time.',
  card_heading: 'Ask first (say this):',
  yes_button: 'They said yes — start notes',
  no_button: 'They said no — keep it manual',
  recorded_confirmation_line: 'Okay, we\'re recording now — and you\'re fine with that, right?',
  recorded_yes_button: 'They said yes on the recording',
  countdown_seconds: 45,
  playback_buttons: ['That was a yes', 'Stop notes'],
  no_card: 'No problem — I\'ll just take notes by hand.',
  banner: 'Consent not on the recording — ask again or keep it manual.',
  banner_buttons: ['Ask again', 'Keep it manual'],
  stop_sheet: 'Stop recording and AI notes for this visit? The visit keeps going.',
  stop_buttons: ['Stop notes', 'Keep notes on'],
  new_person: '{Name}, I\'m recording our conversation and using an AI tool to take notes — is that okay with you too? You can tell me to stop at any time.',
  new_person_buttons: ['They said yes — resume notes', 'They said no — keep it manual'],
} as const;
