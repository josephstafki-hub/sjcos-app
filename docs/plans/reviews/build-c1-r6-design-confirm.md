SCORES: design=10 completeness=10

# Canvas Phase 1 build, round 6 confirm: design & UX judge

Reviewed HEAD `dbdfc42c` on branch `t3/in-app-browser-agent-tools`. I read the `bc6ff8a5` and `dbdfc42c`
diffs (`components/panel/CanvasSaveDialog.tsx`, `tests/canvas-save-dialog.test.mjs`). I also read the
owner Save PNGs and the staff chips PNGs in `/home/joe/qa-sjcos/abc/shots/c1-r6/`, plus `c6-log.json`.
I re-ran `node --test tests/canvas-save-dialog.test.mjs`: 30/30 pass.

## R5-1: fixed

**Code.**
- The footer alert is now `<p role="alert" className="basis-full text-body text-flag">`. It always
  takes its own full-width line, so **Cancel** and **Save** always share the next row. The hint keeps
  `mr-auto` and sits beside the buttons, as before. The ternary means only one of the two shows at a
  time.
- The acknowledgement label now uses `scroll-mb-28`, which leaves room for the taller error footer.
- A new effect, `if(error&&needsAck)ackRow.current?.scrollIntoView({block:'nearest'})`, runs whenever an
  error appears while an acknowledgement is needed. `dbdfc42c` widened it from "unticked only" to any
  error. That is the right call: the reshoot showed that a ticked row can be clipped by the taller
  footer too. It is still a `nearest` scroll, so nothing jumps when the row is already in view.
- The tests pin `basis-full`, `scroll-mb-28` and the effect.

**Screens:**

| Capture | What it shows |
|---|---|
| owner-phone360-save-error | **Couldn't save right now. Try again.** sits in flag colour on its own line inside the footer. **Cancel / Save** share the row below it. Both lines of the ticked **I checked this canvas…** row are fully above the footer rule. The round-5 split pair and the checkbox sliver are gone. |
| owner-desk1280-save-error | The same layout: the error line, then **Cancel / Save**, with the two-line acknowledgement fully visible. |
| owner-phone360-save-ack-expired | **Review who can read this copy again.** is in the footer, and Save is disabled. The unticked acknowledgement is fully visible (log rect bottom 675 < footer top 698), so Joe can see what to re-tick. |
| two-unticked / untick-all (360) | No regression: the hint sits beside **Cancel / Save (disabled)** on one row, and the acknowledgement is fully in view. |
| staff chips (360) | **🔒 Staff**, the "Staff who can open…" sentence, the portal line, **Cancel / Save**. No radios. |

The log shows `leaked:false` and `overflow:0` on every capture, and `alertInFooter:true` at both widths.
The ack POST returns 200 when ticked. The only console lines are the two forced 503s.

## REQUIRED fixes

None.

## Not required

- In the error and expiry captures, the **All removed areas** summary that follows the acknowledgement
  sits partly under the footer. It is secondary content below the row Joe acts on, and it scrolls into
  view normally. This is fine.
- The comment above the new effect still says the error "can untick the row". Since `dbdfc42c` the
  effect runs on any error. Update the comment wording if the file is touched again.
