# A19 — Owner job-time tracking

Plan addendum, September 17, 2026. Requested by Joe during implementation
planning. This adds owner time capture to the build; employee payroll remains
out of scope. Requirements only: no tracking or app features have been enabled.

## Intended experience

**At a job site:** the mobile app recognizes proximity to an assigned job and
asks, "At [job]? Clock in." Joe confirms with one tap. A departure prompts him
to clock out or correct the time. Manual start, stop, pause and correction remain
available. Location suggests attendance; it does not establish that work occurred.

**In the office:** the 3-D designer records active work against its current job.
Opening a project identifies the proposed job/category; focused interaction
starts or resumes a session under Joe's enabled time-tracking setting. Switching
jobs splits the session. Idle, background, locked and closed sessions stop adding
active time. Keep design, estimating, project administration and on-site hours
separate. Initially integrate the designer being built by Joe's other coding
agents; do not build a competing designer or assume its interface already exists.

Reading/thinking can happen without mouse movement. After an idle gap, offer a
simple keep/adjust/discard review of the uncertain interval rather than assuming
all of it was work or silently erasing it. Work outside instrumented SJC OS tools
uses a job-specific manual timer or entry. Do not claim passive awareness of all
office activity or use keylogging, screenshots, or unrelated browsing history.

**Review:** show a daily/weekly job-time list with site/office totals and editable
entries. Flag overlaps, very long sessions, missing clock-outs and uncertain
intervals. Corrections keep an audit history. User-confirmed timers may become
usable entries directly; unresolved inferred intervals stay out of verified cost
learning until resolved. Avoid demanding confirmation of every ordinary minute.

## Mobile implementation contract

- Use native mobile location/region facilities and explicit location/notification
  permissions. Verify the actual app stack and current Apple/Android requirements
  before coding; do not promise reliable background arrival detection from a
  browser-only app. Test on supported physical devices.
- Store verified job coordinates and configurable arrival radius/dwell/cooldown.
  Nearby jobs require a selection rather than silently picking the nearest.
  Passing a site or briefly losing GPS must not create paid/verified work time.
- An arrival notification suggests the observed arrival time and permits editing;
  the tap may happen later. Departure can suggest an end time but must not
  silently clock Joe out while he is still working. Support "still here" and
  breaks. No response leaves an explicit review item rather than counting forever.
- Background delivery can be delayed or unavailable depending on permissions,
  device state and OS limits. Reconcile when the app opens; always retain a manual
  fallback. Show permission problems without repeated notification spam.
- Offline events sync with stable IDs and original timestamps. Server validation
  rejects duplicate actions and flags conflicting clocks or sessions. UTC storage,
  Central-time display and daylight-saving tests are required.
- Collect only data needed to propose job attendance, with an enable/disable
  control and deletion/retention settings. Avoid continuous route history.
  Time/location details are internal, not part of client weekly photo updates.

## Designer and office implementation contract

- Agree a small integration contract with the existing designer team: authenticated
  user, stable project ID, session ID, activity category, foreground/idle state,
  start/heartbeat/end timestamps and sequence/idempotency keys. These are proposed
  fields, not existing tool names or routes. Validate access and project identity
  server-side; do not trust arbitrary client-submitted job IDs/durations.
- Count bounded active intervals using a configurable idle threshold. Initial
  proposed default: five minutes, with a reviewable gap. Background rendering,
  AI generation and an unattended open tab do not automatically count as labor.
- Stop stale sessions using their last credible activity; do not rely on a browser
  close event arriving. Reconcile after crashes, offline use and device restart.
- Multiple tabs/devices and an existing site timer must not double-count the same
  person's wall-clock time. Enforce one running manual/site timer, deduplicate
  activity intervals, and present conflicting site/office classifications for
  resolution without deleting source evidence.
- Manual timers cover phone calls, supplier coordination and other job work.
  Non-job administration is overhead and must not be assigned to an arbitrary job.

## Job costing and learning

Capture hours even before an hourly cost has been agreed. Value them only using
an explicit, dated owner-labor assumption approved by Joe. Keep on-site and office
categories distinct and preserve rate history. Hours without an agreed rate show
"cost not configured," never zero cost.

Owner-time valuation is an internal estimating/job-profitability measure. It
must not automatically create payroll, vendor bills, bank transactions or expense
entries in QuickBooks. Owner draws remain separately recorded; do not count them
again as hourly labor expense. Any accounting treatment is a separate decision.

At closeout, compare estimated versus verified actual hours by category and, when
available, scope/quantity. Separate scope changes, rework and unusual conditions
before updating future productivity assumptions. Verified results may update
internal cost estimates under Joe's stated permission; changes to markup/profit
targets still require approval. Time entries do not automatically bill clients
or change a signed fixed price.

## Acceptance criteria

1. Arrival at a synthetic job creates one relevant clock-in prompt; drive-by,
   repeated boundary crossings and overlapping regions do not create duplicate
   confirmed sessions. Denied permissions leave manual tracking usable.
2. Clock-in/out taps are authenticated, replay-safe and editable. Offline retry,
   restart, notification delay and a missed exit preserve a recoverable record.
3. Active designer work is allocated to the right job. Switching project, leaving
   a tab open, device lock, lost heartbeat and simultaneous devices cannot inflate
   time silently. Thinking/idle gaps can be corrected.
4. A simultaneous site timer and designer session cannot count the same time
   twice. Corrections and conflict resolutions remain auditable.
5. Cross-user/project requests are rejected; location and internal time records
   never enter the client portal or automatic client summary by default.
6. Verified hours reach closeout/estimate learning with provenance and dated rate
   assumptions. Missing rates and unresolved time stay explicit. No automatic
   payroll, client charge or QuickBooks expense is generated.

## Build handoff

Build as part of the complete requested scope, not a calendar phase. Coordinate
with A15 estimate learning, A16 field capture and the existing mobile/designer
work. Backend/manual/office capture can be developed while native permissions
and on-device behavior are verified. Add schema migrations, shared authenticated
commands, interval/conflict tests, fake location/activity adapters and physical
device acceptance results. Do not claim background detection proven by simulator
tests alone. Preserve the existing business authorization rules.

This specification is integrated into A19 of the complete September 17 build
plan. Owner time capture is included now; employee payroll remains outside scope.
See DECISIONS.md for the confirmed authority and accounting boundaries.

Platform reference for implementation verification:
https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions
