// Exact approved words. Placeholder substitution belongs to the caller.
export const failureCopy = [
  {
    "failure": "Get ready: no signal",
    "copy": "Open once with signal before the visit. Or use paper and enter the answers here after the visit. [Try again]",
    "behavior": "Nothing promised offline without a prepared device (§5.2 state 4)"
  },
  {
    "failure": "Get ready: a check fails",
    "copy": "Not ready · ! Problem {check} — {reason}. [Try again]",
    "behavior": "Reasons: \"this browser won't save here (private mode or storage off)\", \"not enough space — free up {n} MB\", \"couldn't download the forms\", \"couldn't download the offline pages\", \"sign-in for offline use failed — sign in again\""
  },
  {
    "failure": "Signal absent or drops",
    "copy": "Status bar second line: No signal · saved on this device · ⇅ {n}",
    "behavior": "Every tap writes to the device first; AI chips wait for signal"
  },
  {
    "failure": "Weak signal while sending",
    "copy": "Sync sheet: Sending answers and photos first. Recordings wait for a better signal.",
    "behavior": "Answers/photos sent before audio; nothing waits on a save"
  },
  {
    "failure": "Tab or phone dies, then reopened",
    "copy": "Back where you were. Recording stopped for {m:ss} — the app was closed. Gap marked.",
    "behavior": "Durable answers resume; up to 30 s of audio may be lost and is shown as a gap"
  },
  {
    "failure": "Camera or call interrupts the mic",
    "copy": "Notes paused — the microphone was interrupted. Check who's here, then [Resume notes].",
    "behavior": "Never restarts by itself; gap marked"
  },
  {
    "failure": "Storage full or blocked mid-visit",
    "copy": "⚠ Storage full — connect to save, or use paper. The last answer saved: {field}.",
    "behavior": "Stops recording and further capture before claiming a save; nothing silently evicted"
  },
  {
    "failure": "Sign-in for offline use expired",
    "copy": "Signed out — your answers are safe on this device. Sign in as {name} to send them. [Sign in]",
    "behavior": "Encrypted queue kept; a different user can't open or send it"
  },
  {
    "failure": "Staff access removed",
    "copy": "Your access to this visit was removed. Your answers are locked on this device and Joe can recover them.",
    "behavior": "Queue quarantined; owner recovery keeps the original author; no wipe"
  },
  {
    "failure": "Transcription failed for a part",
    "copy": "Couldn't transcribe — notes for this part are missing. Your forms are fine. (also a gap line in the transcript drawer and on the visit page)",
    "behavior": "Bounded retries, then one repair to-do; the untranscribed part is deleted at 7 days either way (§9.1, discovery §14)"
  },
  {
    "failure": "Consent not on the recording",
    "copy": "⚠ Consent not on the recording — ask again or keep it manual. [Ask again] [Keep it manual]",
    "behavior": "Capture stopped, that audio quarantined on the device and discarded, never uploaded (§8.1)"
  },
  {
    "failure": "Client says stop",
    "copy": "Recording stopped. Nothing more is recorded. Status bar: Notes off",
    "behavior": "Local tracks stop at once; capture epoch closes. Audio already recorded with their yes is turned into text and deleted as usual; if the client also wants the words gone, Joe uses **Delete transcript** (§8.4)"
  },
  {
    "failure": "The \"yes\" pick couldn't be saved on the device",
    "copy": "⚠ Consent pick didn't save — notes stopped. Keep going by hand.",
    "behavior": "Quarantined audio discarded; no further capture this visit"
  },
  {
    "failure": "The part holding the \"yes\" never turns into text",
    "copy": "Visit page and device (when online): ⚠ Couldn't transcribe the consent answer — notes for {start}–{end} are off.",
    "behavior": "Nothing from that consent is used: later parts are held untranscribed (no chips); a successful retry within 7 days releases them, otherwise consent is unprovable and they are deleted untranscribed; values a person typed stay (§8.1 step 4b)"
  },
  {
    "failure": "Visit cut short",
    "copy": "Visit closed — {n} open items. A Finish consultation to-do was made.",
    "behavior": "Needs finishing; return-visit to-do; never auto-complete"
  },
  {
    "failure": "Same field changed on two devices / after reconnect",
    "copy": "This field changed on another device. Pick which value to keep. [Pick] [Pick] [Enter another]",
    "behavior": "Both revisions kept; no clock decides (§12.2)"
  },
  {
    "failure": "Visitor forgets Close visit",
    "copy": "Next open: This visit wasn't closed. [Close visit] or keep working. Visit page: Visit interrupted",
    "behavior": "No idle timer closes or completes a visit"
  },
  {
    "failure": "Upload rejected (wrong file type or too big)",
    "copy": "This photo couldn't be sent ({reason}). [Retake]",
    "behavior": "Original kept on the device until replaced"
  },
  {
    "failure": "App update arrives mid-visit",
    "copy": "Update ready — reload between rooms. [Reload]",
    "behavior": "Old version keeps working until the queue is sent (§12.4)"
  },
  {
    "failure": "Joe deleted the transcript (client asked)",
    "copy": "The transcript for this visit was deleted.",
    "behavior": "Device drops any unsent audio and cached quotes before showing anything (§8.4)"
  }
] as const;
export const controlCopy = [
  {
    "control": "Prepare the device",
    "copy": "Get ready → Getting ready… → Ready offline ✓",
    "avoid": "sync, precache, lease"
  },
  {
    "control": "Retry a failed check or send · recover",
    "copy": "Try again · Sign in · Reload",
    "avoid": "retry sync, re-auth"
  },
  {
    "control": "Begin the visit",
    "copy": "Start visit",
    "avoid": "begin session"
  },
  {
    "control": "Consent buttons",
    "copy": "They said yes — start notes · They said no — keep it manual",
    "avoid": "grant, consent granted"
  },
  {
    "control": "Recorded confirmation",
    "copy": "They said yes on the recording → playback → That was a yes / Stop notes",
    "avoid": "confirm speaker, auto-consent"
  },
  {
    "control": "Consent banner buttons",
    "copy": "Ask again · Keep it manual",
    "avoid": "confirm again, stop"
  },
  {
    "control": "Capture state (status bar)",
    "copy": "Notes on · Notes paused · Notes off",
    "avoid": "REC, recording active, AI listening"
  },
  {
    "control": "Pause / resume capture (⋯)",
    "copy": "Pause notes · Resume notes",
    "avoid": "mute"
  },
  {
    "control": "Stop capture (on the Notes on chip)",
    "copy": "Stop → sheet [Stop notes] [Keep notes on]",
    "avoid": "end recording"
  },
  {
    "control": "Someone joins (⋯)",
    "copy": "New person here → [They said yes — resume notes] [They said no — keep it manual]",
    "avoid": "add participant"
  },
  {
    "control": "AI chip on a field",
    "copy": "Heard — confirm with Use · Edit · Reject",
    "avoid": "✕, dismiss, suggestion, accept"
  },
  {
    "control": "Skip one field",
    "copy": "Skip this field… (sheet lists the §10.2 reasons)",
    "avoid": "Skip… (global)"
  },
  {
    "control": "Skip reason that stays open",
    "copy": "Get on return visit (mark ⤳ Return visit)",
    "avoid": "later, defer"
  },
  {
    "control": "Move on",
    "copy": "Next ›",
    "avoid": "continue"
  },
  {
    "control": "Leave-section banner",
    "copy": "Go back · Leave for now",
    "avoid": "ignore"
  },
  {
    "control": "End-of-visit sheet",
    "copy": "Before you wrap with Keep working · Close visit · Close visit — needs finishing",
    "avoid": "finish session, submit"
  },
  {
    "control": "Jump from a list to the thing",
    "copy": "Go to field · Review flags · Decide",
    "avoid": "fix, resolve"
  },
  {
    "control": "Flag decision (§10.3)",
    "copy": "Price it · Allowance · Sub must look before pricing · Not an issue — reason",
    "avoid": "dismiss, ignore"
  },
  {
    "control": "Turn the screen to the client",
    "copy": "Show to client",
    "avoid": "client mode"
  },
  {
    "control": "Client acknowledgement",
    "copy": "This is what we went over",
    "avoid": "I agree, accept, sign"
  },
  {
    "control": "Give the device back",
    "copy": "Hand back — hold 2 seconds · Use PIN instead",
    "avoid": "exit, unlock"
  },
  {
    "control": "Photo",
    "copy": "Take photo · Retake",
    "avoid": "capture image"
  },
  {
    "control": "Keypad",
    "copy": "Same as last · Save",
    "avoid": "apply"
  },
  {
    "control": "Send queued work",
    "copy": "Send now",
    "avoid": "force sync"
  },
  {
    "control": "Leave the tool",
    "copy": "Back to SJC OS",
    "avoid": "exit app"
  },
  {
    "control": "Prefill check",
    "copy": "Still right ✓ · Correct",
    "avoid": "prior record, prefilled"
  },
  {
    "control": "Unsynced work after sign-out",
    "copy": "Lock notes on this device",
    "avoid": "discard, wipe"
  },
  {
    "control": "Visit page, after close (Joe or the visitor; optional, nothing waits on it)",
    "copy": "Reopen · Apply findings (only while automatic apply is switched off, §17) · Draft floor plan from consult",
    "avoid": "approve, certify, mark reviewed"
  },
  {
    "control": "Conflict picker",
    "copy": "Pick (on each value) · Enter another",
    "avoid": "resolve, merge"
  },
  {
    "control": "AI note line (visit page)",
    "copy": "Keep · Edit · Dismiss",
    "avoid": "✕, accept"
  },
  {
    "control": "Owner deletion (client asked)",
    "copy": "Delete transcript — sheet: \"Deletes the transcript and any audio still waiting to be turned into text. Measurements you confirmed stay.\"",
    "avoid": "trash audio, delete recording"
  },
  {
    "control": "A part that never turned into text",
    "copy": "Couldn't transcribe — notes for this part are missing (discovery §14 words)",
    "avoid": "STT error, failed chunk"
  },
  {
    "control": "Easier reading outdoors (⋯)",
    "copy": "Sun mode",
    "avoid": "high contrast"
  }
] as const;
