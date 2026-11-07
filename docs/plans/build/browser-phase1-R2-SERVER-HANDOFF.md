# R2 SERVER: production endpoint interface (QA overlay seam)

`lib/browser/runtime-endpoints.ts` is the **only** file the separate QA-only source overlay replaces. Production has no QA import or selector.

```ts
browserWebEndpoint(): {
 control: string; // /run/sjcos-browser/control.sock
 frames: string; // /run/sjcos-browser/frames.sock
 socketPath(kind: 'control'|'frames'): Promise<string>; // validates fixed root-owned socket
 keys(): {key: Buffer; responseKey: Buffer; frameKey: Buffer};
}
loadWebsiteTrust(input: {db: Pool; key: Buffer; controller: WebController}): Promise<WebsiteHooks>
readinessSource(): {evaluateFlags: typeof evaluatePhase1Flags}
```

Production keys are the existing SJC_BROWSER_WEB_RPC_KEY, SJC_BROWSER_WEB_RESPONSE_KEY and SJC_BROWSER_FRAME_KEY hex values. Production socket validation lives in socketPath in this leaf. Production trust loads the fixed protected installed website bridge, catalog, audit/evidence and runner dependencies. Readiness evaluates the existing production enable/pilot switches; the protected bridge/service retain all actual runtime/independent evidence checks. No QA env or database-name branch exists in this leaf or its production consumers.

Implementation/results appended below.

## Live UI seam (R2)

Status/Join now supply `paused_by: 'agent'|'initiator'|'owner'|'system'|null`, `paused_by_label`, `job_label`, `site_label` (host only, owner Watch), and `busy_with_label` (owner only). In-use items supply `task_label` (purpose <=60 characters), `job_label`, `person_label`, exclude caller's tasks. List items carry their own numeric `revision` alongside the snapshot's string revision and TaskUI state; detail uses the same task snapshot. Read candidate projections supply required `suggested_by: 'agent'|'person'|'page_link'` and nullable `suggested_by_label`; reads page at 20 via existing signed cursor. UI: remove fallback source inference for required `suggested_by` if TypeScript narrows that fallback to never. Settings supplies people `{user_id,label,role,eligible,reason_code}`; create accepts project_id and validates project visibility/existence before catalog classification.

FACTORY checkpoint seam: the client retains `.committed.json` in its protected outbox after sink verification + SQL commit; pending originals reconcile first. Quiet ticks/explicit checkpoint/shutdown/restart return the retained original without re-signing or sending a second original. The pending queue contains only hash-named JSON files; `.committed.json` is the durable head, not pending work.

## Implemented findings and evidence

| Item | Change | Regression |
|---|---|---|
| SECURITY 1 | Removed all production QA selectors/imports; fixed root-owned socket checks and protected installed bridge remain. QA replaces the single documented leaf only in its separate artifact. | browser-routes: production graph/QA-env/real QA-named disposable DB; QA builder owns artifact build comparison |
| ENG 1 | Task-locked join retires invisible/invalid-session viewers, rotates stream IDs/generations and clears frame/control/consent. Orphaned task control is revoked even when session triggers already marked the holder left. | phase1-bridges-db: invisible reload/new device, revoked/expired session, stale presence, two visible devices and independent concurrent LOGIN joins |
| ENG 4 (client) | Reconcile pending originals before signing newer heads; fsync retained original `.committed.json` only after independently verified sink ACK + SQL commit and before pending removal. Unchanged heads return original evidence across minute/explicit/shutdown/restart. | audit-checkpoint; r1-server replay; FACTORY's actual JS→Python exporter quiet/restart/SQL-ACK-loss integration (29/29 exporter file) |
| ENG 5 | Reviewed affected QA task/run SQL and enclosing isolated cluster/role/directory guards; removed stale make/writeQaEnvironment queries; pinned frozen root-fixture source after verifying digest/count/order/RSS/retained events all share one frozen snapshot. Updated only affected census entries and source digests; scanner unchanged. | ask-private-query-scan 11/11 |
| DESIGN server data | Named task/job/pilot roster, owner busy identity and host, durable pause actor, 20-item signed read pages retaining all candidates (bounded 192/64KiB), optional validated project on create, same task snapshot/revision for list and detail. | routes; phase1-bridges-db actor/candidate checks; read-manifest-db; r1-server active host and protected projection snapshot |

Project visibility follows the existing projects-area access model plus record existence, owned conversation and protected catalog classification. No per-project ACL is invented. Suggested person labels come from the task initiator, not route labels. Staff do not receive the owner-only busy identity/current host projection. Pending candidates retain source/provenance and original deadlines; GET paging grants no read authority. Formal approved manifests retain their 128-resource/64-document bounds.

0115 is still the sole unapplied migration. The schema baseline mirrors its additive pause actor columns; function/guard definitions follow the existing ordered-ledger convention. Existing browser SECURITY DEFINER functions write the same already protected tables; no new narrow table write/approval grant or write path is introduced. Manifest note records the new owner-only metadata. Exact `node scripts/db-roles-sql.mjs browser_tasks` output is empty (no grants). All touched functions retain protected search_path.

## Final verification

Each file ran individually with `SJC_TEST_CLUSTER_TAG=browser-p1-r2s-a92f`; final results below have no failures/skips/cancellations. Earlier development failures were corrected fixture assumptions and the evolving QA census; they were rerun. Cross-language exporter integration was supplied by FACTORY and exercised against the final server client.

| tests/*.test.mjs | Pass / fail |
|---|---:|
| browser-routes | 52 / 0 |
| browser-live-view | 13 / 0 |
| browser-flags-db | 12 / 0 |
| browser-schema-db | 31 / 0 |
| browser-roles-db | 12 / 0 |
| browser-controller | 101 / 0 |
| browser-multiturn-db | 5 / 0 |
| browser-website-bridge | 22 / 0 |
| browser-audit-checkpoint | 12 / 0 |
| browser-phase1-bridges | 43 / 0 |
| browser-phase1-bridges-db | 29 / 0 |
| browser-r1-server | 16 / 0 |
| browser-private | 22 / 0 |
| browser-read-manifest-db | 27 / 0 |
| db-roles-manifest-db | 7 / 0 |
| db-roles-paths-db | 4 / 0 |
| ask-private-query-scan | 11 / 0 |
| browser-checkpoint-exporter | 29 / 0 |

**448 passed, 0 failed** across 18 files. Locked tsc: exit 0. `node scripts/db-roles-scan.mjs --diff`: exit 0; sjcos_browser 0 table differences. Existing intentionally withheld agent/worker findings remain; no grants added to silence them. `git diff --check`: exit 0.

## Root-hashed SERVER files changed

Both runtime-lock and launcher inventory intersections:

- lib/browser/phase-flags.mjs
- lib/browser/audit-checkpoint-client.mjs
- lib/browser/audit-service.mjs
- lib/browser/production-bridge.mjs
- lib/browser/read-manifest.mjs
- lib/browser/repository.mjs
- lib/browser/service.mjs
- lib/browser/web-transport.mjs

No inventory refresh was run. Coordinator must refresh combined sources and re-attest exact bytes after all slices commit. Website-only new runtime-endpoints.ts, web.ts, web-rpc.ts and web-types.ts also changed and must be included in the production vs QA artifact separation check.

No push/deploy, Next command, browser/server, sudo/systemctl, npm install, live/5499 DB or service operation. No exit 137/Killed. Disposable cluster stopped through the harness. Actual installed trust/transport/private-canary, QA artifact separation and visual/device acceptance stay with coordinator. In particular verify named jobs and people, actor-specific pause copy, owner host/busy copy, list→pane consistency, and resource 20/21 paging on all target layouts.
