# Round 3 — confirmation check (Design & field UX · Contractor & MN legal)

Narrow check: the fixes for `round-3-design.md` and `round-3-domain.md` "Required to reach 10", whether the three plans agree, and whether this round's other edits (sub §10.1c paper copies, consult §9.3 suggestion evidence) changed anything for UX or legal. Plans were read, not edited.

SCORES (Design & field UX): sub-agreements design=9 completeness=10 | discovery-call design=10 completeness=10 | in-home-consult design=10 completeness=10
SCORES (Contractor & MN legal): sub-agreements design=10 completeness=9 | discovery-call design=10 completeness=10 | in-home-consult design=10 completeness=10

---

## Design R3 items

| Item | Status | Evidence |
|---|---|---|
| Sub §9.B endorsements | FIXED | Lines 364–367: four stacked rows, each with a full `ready` mark (`✓ Done` ×3, `○ Not yet`). "AI" is spelled out as "Additional insured". |
| Sub §9.D portal line | FIXED | Line 420: `Sub agreement  ✓ Done · Signed Nov 2, 2026  [Download]`. |
| Discovery §5.1 step 5 + §6.3 | FIXED | Prose (line 204) and wireframe (lines 306–311): tapping **They said yes on the recording** stops the countdown, then shows 48 px rows (time + exact text, newest first), then the picked row → **That was a yes** / **Stop notes**. The tap plus the segment id/revision is the attestation, never Joe's own question. |
| Consult §8.1 steps 4–5, wireframe, §3 | FIXED | **This is their answer** is gone (grep finds none in either plan). Step 4: tapping stops the countdown and opens the strip, which ends with **That was a yes** / **Stop notes**. Step 5: "Stop notes whenever in doubt … no separate ambiguous card in consult mode". The wireframe (lines 1615–1618) matches. The §3 row reads `They said yes on the recording → playback → That was a yes / Stop notes`. |
| Consult script device word | FIXED | "on this {tablet/phone}" fills from the device. It is listed for the attorney packet as the notice's one variable, and the phone wireframe shows "on this phone". |

**Cross-plan consent buttons, word for word:** the same in both plans. **They said yes — start notes**, **They said no — keep it manual**, **They said yes on the recording**, **That was a yes**, **Stop notes**, **Ask again** / **Keep it manual**, and the Stop sheet all agree. The only difference is the documented "call" → "visit" swap. Sizes agree: 48 px on calls, 56 px in the consult, and discovery says so in line 204.

## Legal R3 item

| Item | Status | Evidence |
|---|---|---|
| Discovery §5.1 step 5 negative pattern | FIXED | The negative list is exactly the requested set: `no, nope, not, never, don't, do not, isn't, ain't, wouldn't, won't, can't, rather not, prefer not, stop`, plus any leftover `\b\w+n't\b`. The yes-phrases are stripped first. Positive is matched on the original text and negative on the stripped text. Both → ambiguous (Joe picks) and never an automatic yes. |
| Tests | FIXED | "not ok", "that's not okay", "that isn't fine", "I'm not okay with that" → ambiguous (never yes); "I'd prefer not", "never" → no. The earlier yes cases are kept. |

I traced edge cases. "No, that's not fine" → negative. "No problem? No, I do have a problem" → ambiguous. "Don't go ahead" → ambiguous. No refusal reaches an automatic yes, and the consult can't hit this matcher at all because it is person-attested only. Non-blocking: "I wouldn't mind" now reads as a refusal. That fails safe (capture stops, Joe taps **Ask again**), so no fix is needed.

## Other edits this round (UX/legal impact only)

- **Consult §9.3 suggestion evidence:** no UX or legal change. It is still **Heard — confirm** with **Use · Edit · Reject**, and purge follows discovery §14.
- **Sub §10.1c paper copies:** clause 24 already lets a sub ask to sign on paper. The import invents no packet, PNG, e-sign consent or `executed_*` value, and scopes require the rules sheet to be initialed. Dates can't be in the future and are taken as written. The `wc_basis` is recorded and only an owner can import. That is legally sound in principle. A paper scope signed under an electronic agreement, or the reverse, is fine. Clause 24's "agree to electronic records" text in a paper-signed agreement does no harm and covers later electronic scopes. "Add paper copy" reads right. Two problems, below.

## Remaining required fixes (sub-agreements plan only)

1. **Legal: §10.1c step 2 lets paper skip the checks that electronic signing enforces.** Today it accepts a parent in `draft` or `ready`. A paper scope could therefore be marked signed from a `draft` that never passed the §14 validator. That contradicts §6 item 2 ("A line with an unverified measurement cannot be signed") and §11.2 step 1, and it lets `sub_start_ready()` count an incomplete scope (pay terms, license rows, exclusions) as ready. Replace step 2 with:
   > "2. Requires the same preconditions as **Joe signs** (§11.2 step 1), with no open packet (`packet_open`): an agreement in `draft` with an approved counsel template and complete agreement fields; a scope in `ready` with the current `draft_hash`, a complete §14 validator and a `signed` Sub agreement for the same sub effective for this job (`agreement_missing`, `not_ready`, `template_unapproved`). The parent's `draft_hash` is recorded in the event so the paper is tied to the text Joe printed."

   Add "draft scope / unapproved template refused" to `tests/sub-agreements-paper-db.test.mjs`, and change "draft/ready version he printed" in §17 Phase 1 to "the ready version he printed (or the agreement draft)".
2. **Design: the paper status line breaks the plan's own date format.** §10.1c shows **Signed on paper · 11/04/2026**. Every other screen uses "Nov 2, 2026". Change it to:
   > "Screens show **Signed on paper · Nov 4, 2026** (the later of the two written signing dates) in place of the Document ID line, e.g. portal `Sub agreement  ✓ Done · Signed on paper · Nov 4, 2026  [Download]`; the download is the scan."

## Optional (not required for 10)

- Consult §3 still has the "Ambiguous recorded answer" row, although §8.1 step 5 now says the consult has no separate ambiguous card. Either delete the row or add "(consult: same strip as above)".
- Discovery §6.3 wireframe says "recent client-side segments", but its example rows include Joe's own line, and the prose says "recent segments of the call". Use "recent segments" in the wireframe.
