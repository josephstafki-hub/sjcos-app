# Round 3 — Design & field UX judge
SCORES: sub-agreements design=9 completeness=10 | discovery-call design=9 completeness=10 | in-home-consult design=9 completeness=9

I checked the plan text itself, not only the revision logs. Every round-2 required item in
all three plans is fixed in the text. `CoverageMark` now has one owner (discovery §6.0) with
two exact word sets, and both other plans cite it by name. The consent words match across
the plans. What's left are three small problems:

- One wireframe line still breaks the shared mark rule (sub §9.B).
- The recorded-yes confirmation step is not drawn in discovery. In the consult it is drawn,
  but its button doesn't say "yes", and the ambiguous card can't be reached.
- The consult consent script says "on this tablet" on a phone.

Each one is a single-line edit.

**About the consult's two decisions:**

- **Declining "✓ Answered": right.** Discovery §6.0 owns the mark words and forbids
  Answered. "✓ Covered" on fields is consistent and loses nothing. I withdraw that round-2
  suggestion.
- **Adding "This is their answer": the step is right, the word is not.** Discovery §5.1
  requires the visitor to pick the client's reply out of the local playback, so a confirm
  control is needed. But the label only says *which clip* is the answer, not that the
  answer *was a yes*. A visitor could mark a "no, I'd rather not" clip as "their answer",
  and the screen would let them grant consent. It also leaves the consult's ambiguous card
  (§8.1 step 5) with no way in. Fix it with discovery's existing words, not a new one: see
  consult Required #1 and Cross-plan 1.

---

## 1. Sub agreements (`sub-agreements-plan.md`)

### Round-2 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | §9 Shared rules uses `CoverageMark` `variant="ready"` from discovery §6.0 by name: ✓ Done · ○ Not yet · ! Problem. §9.A phone and desktop use those words. (One leftover in §9.B, see New issues.) |
| 2(a) | FIXED | §9.H "Waiting on details" has no main action and shows "Waiting for North Star's answer · asked Nov 2 10:20", Joe's question, and Decline as a secondary action. §9.G adds **Joe asked: [question] · Answer** on the sub's job card, using the same field with VoiceButton and photo. Answering returns the request to New. |
| 2(b) | FIXED | The tick box **SJC absorbs this — no client price change** shows in New and Client reviewing when the work is Required. Ticking it enables **Approve for the sub** with lump sum and days. §8.5 step 5 matches. |
| 2(c) | FIXED | **Client declined → closed** is in the state list. The status-words table has "Client declined" / "Not approved — the client said no". |
| 3 | FIXED | §9.D lists five actions, including Message Joe, in both prose and wireframe. |
| 4 | FIXED | §8.4 and §9.F: "press and hold 2 seconds or use Joe's PIN", with a hold ring and a keyboard-accessible PIN input. |

### New issues
- **§9.B Paperwork, endorsements line:** `Endorsements: AI ongoing ✓ · AI completed ✓ ·
  Primary/non-contrib ✓ · Waiver of subrogation ○ Not yet`.
  - Three marks are bare ✓ with no word, sitting next to a worded "○ Not yet". That
    breaks the rule this plan adopts from discovery §6.0: "Every mark always renders its
    word, including compact views and accessible names". A builder can't tell whether
    this line uses `CoverageMark` or not.
  - "AI" here means *additional insured*. On a screen where sage "AI" means Claude, it
    reads wrong to anyone who isn't reading a COI at that moment.
- **§9.D portal home, `Sub agreement ✓ Signed · Nov 2, 2026`:** a ✓ with a word that is
  not in the `ready` set. The §9 shared rules say status marks use `CoverageMark`, so the
  builder has to guess whether this is a mark ("✓ Done") or plain status text.
- Not required: what happens to a client document already out for review when Joe later
  ticks "SJC absorbs this" in Client reviewing. That is a domain/engineering edge case
  (void the client document?), not a screen question.

### Required to reach 10
1. **§9.B endorsements and §9.D Sub agreement line:**
   - In §9.B, stack the endorsements one per line, each with a full ready-set mark:
     `Additional insured — ongoing work      ✓ Done`,
     `Additional insured — completed work    ✓ Done`,
     `Primary and non-contributory           ✓ Done`,
     `Waiver of subrogation                  ○ Not yet`.
   - In §9.D, write `Sub agreement   ✓ Done · Signed Nov 2, 2026   [Download]`. Or add
     one sentence saying "Signed" there is plain status text, not a `CoverageMark`. Pick
     one.

---

## 2. Discovery call (`discovery-call-plan.md`)

### Round-2 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | §6.4a is wireframed exactly as asked: `Checklist · started 10:42`, `Lead: Link later ▾ · Call: none ▾ · Saved`, the **By hand — AI can't hear this call** chip, the nine rows, and a sticky 48 px **Finish checklist** bar. It also covers the summary at hangup and Finish checklist in the header ⋯ for a call whose hangup the app can't see. |
| 2 | FIXED | **They said yes on the recording** is in the §1.1 words table, the §6.3 after-yes block (with countdown), and the §6.7 "Speakers unknown" state row. **That was a yes / Stop notes** is added for the ambiguous case. |
| 3 | FIXED | §6.0 defines exactly two word sets with stored states. It says "Never use ! for Open, or substitute Answered/Missing" and "A required field uses ○ Open plus its separate `*` marker". Flags show beside the state. |

### New issues
- **§5.1 / §6.3 Unknown voices: the "select the response" step is not drawn.** §5.1 says
  "Joe selects the actual recorded response; his tap plus its segment id/revision is the
  attestation". §6.3 shows only `[They said yes on the recording]`, and nothing says what
  appears after Joe taps it, or whether the 45 s countdown keeps running while he
  chooses. The consult drew its version (a playback strip). The call version, which picks
  from transcript segments, has no wireframe, so a builder would invent the picker.
- Not required: the §6.4 phone live header doesn't draw the ⋯ that §6.4a says holds
  **Finish checklist** for unseen hangups. That is a rare case and the prose is clear.

### Required to reach 10
1. **§6.3 "after yes", Unknown voices (and one clause in §5.1):** replace the single line
   with the block below and keep the words as written.
   ```
   Unknown voices: [They said yes on the recording]  48 px   (stops the 45 s countdown)
     → Pick their answer (client segments since your question, newest first):
       [00:41  "yeah that's fine"            ]  48 px row, whole row tappable
       [00:38  "okay we're recording now…"   ]
     selected row → [That was a yes] (primary)  [Stop notes]
   ```
   Then add one sentence to §5.1: "In unknown-speaker mode the picked row plus **That was
   a yes** is the attestation; there is no separate ambiguous card because the person's
   pick is the judgment."

---

## 3. In-home consultation (`in-home-consult-plan.md`)

### Round-2 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | The §6.4 tablet wireframe is redrawn. It has per-field **Skip this field…** only, no helper line, and **Use · Edit · Reject**. There is no ☀ in the bar; Sun mode is in ⋯ at every width. §5.3 step 7 says Reject. The §6.8 desktop row reads "! Conflict · phone 36″ / iPad 36½″ [Pick] [Pick] [Enter another]", and Mark reviewed is disabled with "1 conflict to pick". |
| 2 | FIXED (my suggestion rightly declined) | One legend in §6.1, mapping discovery §6.0's coverage words onto fields and sections. "! Open" is retired, and a required field is ○ Open plus `*`. Declining "✓ Answered" follows the owner rule, which is correct. All wireframes use the shared words. |
| 3 | FIXED | §5.7 has a "Visitor sees" column with exact copy and buttons for all 19 rows. |
| 4 | FIXED | §5.2 names six checks in plain words, with engineering names in parentheses. A 390 px wireframe shows four states (Checking, Ready offline ✓, a check failed, No signal) in the `ready` word set, with paper fallback and Try again. |
| 5 | PARTLY | The buttons, banner, Stop sheet, New person buttons and "ask again or keep it manual" all match discovery verbatim, and the consent card is wireframed. The new playback confirm, **This is their answer**, attests the clip but not the yes. The ambiguous card (step 5) has no entry. See New issues. |
| 6 | FIXED | §3 now lists every visitor and reviewer control, one word each, plus Notes on / paused / off. REC is gone, and the wireframes use these words. |

### New issues
- **§8.1 steps 4–5, consent wireframe, §3 row "Recorded confirmation":**
  - **This is their answer** confirms *which clip*, not that the client said *yes*. The
    tap grants consent, so its words must say yes.
  - The ambiguous card ("Notes paused · [That was a yes] [Stop notes]") has no control
    that leads to it. With batch audio there is no automatic check to flag ambiguity, so
    nothing can ever show it.
  - Nothing says whether the 45 s countdown stops once the visitor taps **They said yes
    on the recording**. If it doesn't, a gloved visitor dragging the ≤20 s handles will
    hit step 6 ("no answer within 45 s → discard") partway through.
  - §3 says the consent words are "discovery verbatim, 'call' → 'visit'", but this row
    adds a word discovery doesn't have.
- **§8.1 consent script, "record our conversation on this tablet":** §1 and §6.3 support
  phones too. On a phone, the visitor reads a false sentence aloud as part of the legal
  notice.
- Not required:
  - The §6.4 tablet Ceiling row shows `○ Open` without the `◌ Heard — confirm` flag
    beside it that the phone row shows. The chip line directly below makes this clear.
  - §10.1 says "Needs finishing (n open)" while §6.3 says "Needs finishing — 2 open".
    Pick one form when building.

### Required to reach 10
1. **§8.1 step 4–5, the consent wireframe, and the §3 "Recorded confirmation" row:** use
   discovery's existing words instead of a new one.
   - Tapping **They said yes on the recording** stops the 45 s countdown and opens the
     playback strip.
   - The strip ends with **[That was a yes]** (56 px, primary) and **[Stop notes]**
     (56 px, secondary).
   - Delete **This is their answer**, and delete the separate "ambiguous" line. The
     visitor's pick in the strip is the human judgment, matching discovery Required #1.
   - Rewrite step 5 as: "Can't tell from the playback → **Stop notes** (or **Ask again**
     from the banner)".
   - The §3 row becomes `They said yes on the recording → playback → That was a yes ·
     Stop notes`. The "verbatim" sentence is then true.
2. **§8.1 consent script:**
   - Replace "on this tablet" with "on this {device}", filled as "tablet" or "phone" from
     the capture device.
   - Or use "on this device" and flag the change for the attorney packet with the
     notice version.

---

## Cross-plan

1. **Human-attested recorded yes: one interaction, one word.** Discovery (picking a
   transcript segment) and the consult (picking from playback) should both end with the
   picked item followed by **That was a yes** / **Stop notes**. Tapping **They said yes on
   the recording** stops the countdown in both plans. No new consent words. Fix: discovery
   Required #1 + consult Required #1.
2. **`CoverageMark`: resolved.**
   - Discovery §6.0 owns both word sets.
   - The consult §6.1 maps fields and sections onto `coverage` and uses `ready` only for
     Get ready.
   - The sub plan uses `ready` everywhere except the §9.B/§9.D leftovers (sub Required
     #1).
   - The "!" glyph now means Conflict in `coverage` and Problem in `ready`. Each meaning
     is defined inside its own word set and never used for Open.
3. **Hand back: resolved.** Hold 2 seconds or PIN with a keyboard alternative in both the
   sub plan (§8.4/§9.F) and the consult (§6.3/§6.4). Words: consult "Hand back — hold 2
   seconds · Use PIN instead"; sub "Hand back to Joe" → "press and hold 2 seconds or use
   Joe's PIN". The audiences differ (client vs sub), so the different wording is fine.
4. **Matched, no action needed:**
   - 48 / 56 px target rule stated the same way in all three plans;
   - consent buttons, banner, Stop sheet and New-person words;
   - Notes on / Notes off;
   - engine states shown as Open / Partly / Covered / N/A;
   - the Heard — confirm / Use · Edit · Reject chip;
   - `consultScopeFacts` feeding the sub Visit column;
   - client-facing words (pre-con agreement · rough estimate · formal estimate · Pre-con
     change · change order · upsell);
   - `call_nudge` / `call_live` are calls-only.
