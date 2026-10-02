# Mobile owner-time contract (A19)

Backend contract for the iOS app (`/home/joe/sjcos-mobile`, Expo). The
phone proposes job attendance; the server decides what counts. Owner-only.

## Endpoints (bearer session token, same as the other `/api/mobile/*` routes)

### `POST /api/mobile/time/events`

```json
{ "location": [ { "deviceId": "iphone-…", "clientEventId": "uuid", "kind": "enter|exit|heartbeat",
                  "lat": 44.9, "lng": -93.2, "accuracyM": 30, "at": "2026-09-23T14:02:11Z" } ],
  "designer": [ { "designId": 12, "sessionId": "uuid", "seq": 3, "kind": "focus|heartbeat|blur|idle|end", "at": "…" } ] }
```

Batch, offline-safe: keep original timestamps and stable `clientEventId`s;
replays are ignored (`{ kind: "duplicate" }`). Each event answers independently:

- `prompt` — inside a job site's radius after the dwell time; carries
  `choices` when several jobs are nearby (the app must ask, never pick).
- `discarded_drive_by` — enter→exit within the dwell window.
- `ignored` — cooldown, no site, denied/absent data.
- `exit_suggested` — a confirmed clock-in gets a suggested end time; it is
  **not** clocked out. `exit_review` when nothing was confirmed.

### `POST /api/mobile/time/timer`

`{ "action": "confirm_clock_in", "intervalId": "…", "projectId": "…", "clientEventId": "uuid" }`
also `start`, `stop`, `propose_clock_in`, `clock_out` (`acceptSuggested`),
`correct` (`startAt`, `endAt`, `projectId`, `category`, `state: confirmed|discarded`, `note`).
Send the same `clientEventId` on retry. Conflicts (a timer already running,
a discarded prompt, a job not among the choices) come back as `409` with the
reason.

### `GET /api/mobile/time/review?from=ISO&to=ISO`

Intervals with flags (`overlap`, `long`, `missing_exit`, `inferred`,
`review`, `no_project`), site/office/overhead totals (union, no double
count) and the running timer. Defaults to the last 7 days.

## Phone-side rules (OWNER_TIME_TRACKING.md)

- Native region monitoring with explicit location + notification permission;
  radius/dwell/cooldown come from `job_sites` (server). Denied permission →
  manual timer still works; show the permission problem once, no spam.
- A prompt notification suggests the observed arrival time and lets Joe edit
  it; the tap may come later. Departure suggests an end, never silently ends.
  "Still here" and breaks are ordinary `correct`/`stop`/`start` actions.
- Reconcile on app open: flush the queued events, then fetch the review.
- Collect only what proposes attendance; no route history. Location is never
  part of client updates.

## Device acceptance (owed)

Simulator runs do not prove background arrival detection. Record on a
physical iPhone: arrival prompt at a synthetic job, drive-by discard, boundary
flapping (one prompt), denied permission, offline queue replay, restart.
Until then `feature.owner_time` stays *implemented*, not *proven*.
