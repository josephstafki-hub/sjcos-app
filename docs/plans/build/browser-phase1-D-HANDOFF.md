# Browser Phase 1 D — privacy, exact reads and submit guard

2026-11-07, branch `t3/browser-phase1`, implemented from `20b0d7fa` in the shared
worktree. Identify D's commit with `git log -1 --format=%H -- this-file`.
No subagents, push, migration, dependency install, live DB/service, installed
runtime, browser, Next server/build, sudo or systemctl operation.

## Delivered

- `privacy.mjs`: synchronously close public output before any awaited lock,
  cancel observations, stop/ACK capture, drain public queues, commit permanent
  privacy through the frozen repository, rotate handles and ACK before input.
  Every pointer/wheel/key/IME/Type it uses one authority check. No textbox-type,
  focus, preference, vault flag or apparent-secret exception. Failure stays
  fenced; Done stays private/paused; fresh reset destroys/fences first and accepts
  only a distinct boot and exactly next anonymous generation.
- `read-manifest.mjs`: one existing strict URL parser; trusted public-provenance
  classifier required, never a caller public label. Known business facts and
  base64/base64url/hex derivatives refuse. Immutable exact canonical bytes,
  purpose-HMAC, approval/session/expiry, next parent epoch, 1 document use,
  <=32 resource uses; <=20 resources per review; no static rules installed.
  Discovery is blocked and yields <=20 verified candidates for a human sheet.
- `read-authority.mjs`: separate production authority, actual request HMAC binds
  headers/body digest and listener/guard/target/context/nonce. Independent audit
  intent/checkpoint precedes SQL consume; transaction must COMMIT before signing
  Ed25519 dispatch. Successful SQL proof identity/entry/use/bindings are compared.
  Durable flow claim burns on failure; <=2s decision; post-TLS current eligibility,
  principal/run/epochs/revisions/document/target and expiry checked again;
  dispatch is one-use. No fixture signer or fixture OPTIONS/write permission.
- `outbound-data.mjs`: GET/HEAD plus verified exact manifest only, fixed anonymous
  headers, empty body, known public provenance; no Cookie/Auth/Referer/custom
  values, implicit same-origin assets, beacon/popup/subframe or arbitrary GET.
  Known mutation semantics refuse even if a classifier says public; this regex
  is defense in depth, never sufficient authorization.
- `submit-guard.mjs`: generic click/fill/check/select/Enter/unknown model steps
  all stop. Only local public scroll/Tab/Shift+Tab/Escape can continue. Exact
  navigation uses the separate reviewed read path. All unknown outgoing writes
  refuse at the independent gate, including manually/JS initiated requests.
  Fixed card: “This version stops here. Nothing was submitted.” / “Close”.
- `public-observation.mjs`: public structured visible extraction only; hidden,
  editable text, credential/payment/OTP/token controls, values, raw HTML,
  titles, console and network payloads have no projection. <=32KiB total encoded
  JSON, <=150 unique controls, <=30s TTL. Untrusted strings live solely inside
  frozen `ObservationV1.untrusted_page`. Private output is fixed adapter-null,
  empty-controls schema without inspecting raw data. Ref registry independently
  binds read revision/document/generation/expiry. Public output fence checks at
  the synchronous sink after awaits, including already-started observations.
- `controller-gate.mjs`: explicit production Phase 1 path preflights header/value
  policy before collection, requires durable read authority, uses its signed
  decision ID, and rechecks authority after TLS. Old 0b fixture path preserved.

28 fresh adversarial expectations were written in
`tests/fixtures/browser-phase1-privacy/adversarial.mjs` before implementation.
HTML stimuli are authored real-shaped forms/script-heavy pages, not claimed
captures from a real browser. The mock hostile canary reflects/encodes values
in DOM/title/query/error during an outstanding observation. Real 1248 remains
a coordinator gate.

## Exact exported hooks

All are server ESM; import frozen shapes from `phase1-contracts.mjs` and
`contracts.mjs`, not these modules. `now` is numeric epoch milliseconds except
where explicitly a clock function.

```js
// privacy.mjs
createPublicOutputFence({contextGeneration})
// => {contextGeneration,ticket(),fence(),isOpen(),publish({ticket,task,sink,value,emit})}
enterPrivate({taskId,bootId,expectedEpoch,contextGeneration,reason:'manual',io})
// => {privacy_mode:'private',context_generation,control_epoch,stream_generation,drained:true}
persistPrivateWithRepository({transaction}, args)
// args = {tid,boot,expected_epoch,mode:'private'}; uses browserEnterPrivate(client,args)
authorizeManualInput({task,viewer,control,frame,event,now}) // => {allowed:true}
ensurePrivateBeforeInput({task,input,io,viewer,control,frame,now}) // input is InputEvent
finishPrivateInput({io}) // => private paused TaskSafe
freshAnonymousReset({task,io}) // => {task:TaskSafe,outputFence}

// read-manifest.mjs
validateReadProposal({proposal,task,confirmedFacts,now})
// => {entries,candidates,blocked_entries}; candidates are ReadCandidate, human only
buildReadManifest({proposal,actorProof,expectedRevision}) // => verified ReadManifestV1
publishReadManifest({proposal,actorProof,expectedRevision,repository}) // => ReadManifestV1
stageReadCandidates({proposal,task,confirmedFacts,repository,now})
// => {candidates,blocked_entries}; no transmit or approval
readManifestDigest(manifest,key)
verifyReadManifest(manifest,{key,now}) // => deeply frozen verified ReadManifestV1
isVerifiedReadManifest(manifest)
hasMutationSemantics(url) // defense in depth ONLY

// outbound-data.mjs
validatePublicHeaders(headers,url) // => boolean; pairs, no ambient header copying
classifyRequest({request,task,readManifest,provenance,now})
// => {kind:'read',entry_id} | {kind:'blocked',code,notice_kind}
// EMPTY_BODY_SHA256 is exported.

// read-authority.mjs
actualRequestHmac({actualRequest,binding,flow,key})
prepareReadDispatch({task,entry,actualRequest,flow,binding,repository,audit})
// => ReadDispatchV1
verifyReadDispatch(dispatch,{publicKey,now})
createPhase1ReadAuthority({contextFor,repository,audit,manifestKey,requestKey,
  dispatchPrivateKey,dispatchPublicKey,journal,now,monotonicNow})
// => {phase:1, authorizeFetch(request,meta), authorizeRequest(request,meta),
//     authorizeDispatch(receipt,meta), unknownAll()}
// authorizeRequest => {kind:'read',expiresAt:number,dispatch:ReadDispatchV1}

// submit-guard.mjs
submitGuard({operation,observation,actualRequest,phase:1,classify})
// => {allowed:true,kind:'local'|'read',entry_id?} | fixed blocked card/code
// PHASE1_STOP_CARD is exported. No release/approval operation exists.

// public-observation.mjs
sanitizePublicObservation({raw,task,observationId,now}) // => ObservationV1
observePublic({readTask,capture,outputFence,emit,registry,now,observationId})
// now here is a clock function; => ObservationV1, fixed private schema on a race
createObservationRegistry({maxEntries=64})
// => {register({observation,task,now}), resolve({observationId,task,ref,now}),clear()}
```

`createGateAuthority` retains old arguments and adds `phase`; production must
pass **phase:1** and D's `createPhase1ReadAuthority` instance. It also selects
Phase 1 automatically for `authority.phase===1`. Explicit phase:1 refuses a
fixture authority. Old default behavior exists solely for 0b acceptance fixtures.

## Requests for A

These are required installation/service/web call sites, intentionally NOT
edited by D. Missing hooks refuse; this handoff is not a claim of integrated
production activation.

1. **Per-context privacy IO**, at `BrowserService.open` and
   `BrowserService.manualInput` / the take_over control handler:
   create one `createPublicOutputFence({contextGeneration:task.context_generation})`
   and one `createObservationRegistry()` per fresh anonymous context. Pass this
   exact IO object to `enterPrivate`:

   ```js
   io = {
     outputFence,
     fenceCommands({taskId,contextGeneration}), // synchronous true, disable agent commands
     withContextLock(taskId,fn),               // fn runs under existing context lock
     readTask(),                              // current TaskSafe, not raw DB row
     cancelAndDrainCommands(),                // cancel/finish pending agent commands; true
     cancelObservations(),                    // await all pending reads, registry.clear(); true
     stopAndAckScreencast(),                   // await actual stop/ACK; true
     drainPublicOutputs(),                    // clear/drop ALL pending public queues; true
     persistPrivate(args),                    // transaction(COMMIT) browserEnterPrivate
     rotatePrivateHandles(savedTask),         // {stream_generation:positive integer}
     ackPrivate(binding),                     // publisher confirms new private-only handles; true
     pauseAfterFailure(),                     // no input delivery on error
   };
   ```

   `manualInput` already holds `service.locked`: `withContextLock` must execute
   under that already-held lock, NOT try to reacquire it. `fenceCommands` must
   disable agent commands/output without making `service.live()` reject the
   subsequent private-person input. SQL increments viewer stream generation;
   `rotatePrivateHandles` must use that committed generation, not increment it
   a second time. Take over performs this barrier BEFORE granting person control,
   not only on first key. Store its ACK in `r.privateBarrier`. Repeat inputs call
   `authorizeManualInput` against that retained ACK and current server authority.
   No confirmation/preference/vault shortcut.

2. **Resolved manual authority**, `service.io.resolveInput(r,proof)` must return:

   ```js
   { event: InputEvent,
     viewer:{id,task_id,web_session_id,stream_id,stream_generation,last_frame_uuid,
       consented:true,session_valid:true,present_until:number,expires_at:number},
     control:{drained:true,context_generation,control_epoch,holder_viewer_id,
       web_session_id,expires_at:number,claimSequence({frame_id,event})},
     frame:{id,task_id,viewer_id,context_generation,document_epoch,control_epoch,
       stream_id,stream_generation,expires_at:number} }
   ```

   `claimSequence` synchronously burns the exact accepted memory-only input
   sequence/proof once; text is not persisted. B's browserWebInput proof/frame/
   session/device checks happen first, then this check immediately before CDP.
   Re-read these associations after privacy rotation: the old public frame is
   not authority. Private manual authority is independent of browser_authorize:
   browser_enter_private revokes model capabilities. Do not use revoked model
   capability to deny/authorize subsequent human input. Use current web proof.
   Done uses `finishPrivateInput({io:{stopInputAndCapture,pausePrivate}})`;
   both IO operations must finish before resolving, pausePrivate returns TaskSafe.
   Fresh uses `freshAnonymousReset({task,io:{outputFence,
   destroyAndFenceOldGeneration,commitFreshGeneration}})`; commitFreshGeneration
   calls website `browserWebControl(op:'fresh_browser')` with completed fence proof,
   never browser_runtime_transition to clear privacy.

3. **Actual output sinks**, replace `BrowserService.observe`'s unconditional
   `await raw()` with `observePublic` and per-context fence/registry. Private
   contexts must not even invoke capture. Raw extraction shape is
   `{url,textNodes:[{kind:'text'|'paragraph'|'heading'|'link',text,visible,hidden?,
   editable?,sensitive?,type?,name?}],controls:[{ref:'c123',role,label,visible,
   hidden?,sensitive?,type?,name?,autocomplete?}]}`. The trusted extractor derives
   visibility/sensitivity; never accept these flags from page-provided JSON.
   Register refs and use `registry.resolve` in agent-runtime's `io.observation`.
   Every model/log/transcript/receipt/error/download/title/query/DOM/console/
   network/trace/public-frame sink must obtain a ticket BEFORE awaiting and call
   `outputFence.publish({ticket,task,sink,value,emit})` AFTER awaiting. `emit` is a
   synchronous enqueue; repeat the fence check when flushing queued transport.
   In particular `createTaskMcpHandler` awaits authorize after forming output:
   fence/sanitize again at its actual return, not only in service.observe.
   Human private frames use B's separate private-view consent path, never this
   public sink or model pipeline.

4. **Production read installation**, instantiate D authority and pass it to
   `createGateAuthority({phase:1,...})`. `contextFor({id,targetId,...})` must freshly
   return `{eligible:true,task,manifest,binding,provenance}` only after current DB
   session/areas/record/flags/attendance/boot/listener checks. Task includes
   `TaskSafe` fields plus `listener_generation`. Binding is
   `{taskId,bootId,generation,contextGeneration,guardId,targetId,listenerCookie,
   listener,contextId}` from the guarded flow, not route JSON. Provenance is
   `{classification:'public_nonbusiness'}` from trusted classifier output.
   `repository.transaction(fn)` passes an explicit service pg client and resolves
   only after COMMIT. `audit.anchorReadIntent({task_id,binding})` must independently
   checkpoint the exact frozen read-intent binding before resolving; D's SQL
   wrapper then calls browserReadConsume. `journal.claim` is the fsynced
   DurableJournal seam. Installation supplies purpose-separated manifest/request
   HMAC keys and Ed25519 private/public KeyObjects, never fixture keys.
   `flow` for a direct prepareReadDispatch call is
   `{nonce,deadline:number,monotonicDeadline:number,monotonicNow:clock,now:clock,
   manifestDigest,readManifest:verifiedManifest,
   provenance,requestKey,dispatchPrivateKey}`. actualRequest is exactly
   `{method,url,kind,headers,bodySha256,requestDigest}`. No direct prepare call
   accepts an unsigned/unverified manifest. Keep existing independent parser,
   target guard, pinned TLS/peer checks and final kernel pidfd send checks.
   Configure anonymous UA to `SJC-Public-Browser/1` and remove unsupported
   Chromium headers BEFORE actual request digest collection; never rewrite
   bytes after signing. Unknown headers currently fail closed.

5. **Web classifier / publication / candidates**: B's current makeManifest call
   fits `buildReadManifest`. `actorProof` must be trusted server memory:
   `{task,confirmedFacts:{values:string[],classifyPublicUrl(url,{role,source})},
   key,userId,sessionId,sessionExpiresAt:number,now?:number,authorize:()=>true}`.
   `values` includes ALL known company/private facts, never business lookup
   authority; classifier must prove whole exact URL public/nonbusiness without
   interpolation. Missing/unknown classification refuses even for the owner.
   Proposal labels/source are not proof. `repository.publishReadManifest`
   adapter receives `{manifest,expectedRevision}` and invokes browserWebReads
   in B's same transaction as its web proof. SQL already validates the frozen
   manifest/use/epoch/session shapes; no change requested to those checks.
   `repository.stageReadCandidates({taskId,expectedRevision,candidates})` remains
   a required A repository/SQL addition for durable pending review. Exact proposed
   website-only SQL API for 0115:
   `browser_web_read_candidates(tid uuid,vid uuid,expected_revision integer,
   proposal jsonb,i uuid,d bytea) RETURNS jsonb`, repository wrapper
   `browserWebReadCandidates(client,{tid,vid,expected_revision,proposal,i,d})`.
   `proposal` is `{v:1,candidates:ReadCandidate[]}` with 1..20 entries, human-only;
   result `{revision:positive integer,candidates:ReadCandidate[]}`. Lock task
   first, validate current initiator viewer/session and same-transaction review
   proof/digest, expected read revision, public state, canonical exact public
   candidates and original <=60s deadlines. Persist a NEW immutable PENDING
   browser_read_manifests revision, no approval identity/active authorization,
   no browser_actions or grant. Denial/expiry terminal; publication/activation
   must use the reviewed exact candidate content and a new deliberate request.
   Add wrapper/strict result validator/SQL_FUNCTIONS and website-only execute
   boundary in 0115; never grant service candidate approval. Exact SQL body is
   A-owned because the pending catalog and candidate storage are not frozen.
   Until present, stageReadCandidates refuses and no discovered request transmits.
   Current 0115 binds every published resource to the NEXT document epoch:
   D supports doc + <=20 exact resources reviewed together for a deliberate
   reload. Resource-only approval into the existing document is not implemented;
   do not silently claim it or replay the blocked asset.
   B's `currentManifest` currently wraps `row.public_entries` as `entries`, but
   0115 stores the ENTIRE ReadManifestV1 there: use
   `ReadManifestV1.parse(row.public_entries)` and human projection `.entries`.

6. **Before control and at blocked egress**, keep agent-runtime's submitGuard
   call; do not add generic click/Enter fallback. A owns staging a fixed refusal
   notice (not action/grant) and content-free audit. At a known origin/exact-read
   miss call stageReadCandidates with trusted classifier; never review inside
   the <=2s transport decision or replay the flow. Existing controller-gate still
   invokes its fatal fence on policy refusal, preserving 0b fail-closed behavior;
   routing recoverable candidate discovery BEFORE this fatal transport path is
   required for usable missing-assets review. A must not weaken fatal handling of
   containment/binding/transport faults to make discovery work.

## Verification

Each file ran separately with `SJC_TEST_CLUSTER_TAG=browser-p1-d-1107d`.
All DB clients use only `tests/_harness/testdb.mjs` URLs; LOGIN clients are explicit.
The disposable owner fixture simulates independently verified checkpoint
attestations; DB tests do not claim production verifier/sink integration.

| File / command | Pass | Exit |
|---|---:|---:|
| tests/browser-private.test.mjs | 22 | 0 |
| tests/browser-read-manifest-db.test.mjs | 26 | 0 |
| tests/browser-submit-guard.test.mjs | 20 | 0 |
| tests/browser-outbound-data.test.mjs | 31 | 0 |
| tests/browser-egress-gate.test.mjs | 27 | 0 |
| tests/browser-network.test.mjs (unchanged) | 94 | 0 |
| tests/browser-runtime-gate.test.mjs (unchanged) | 61 | 0 |
| tests/browser-round2.test.mjs (unchanged) | 26 | 0 |
| tests/browser-flags-db.test.mjs (unchanged) | 12 | 0 |

319 passed, no skips. `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`:
exit **0** (shared-tree snapshot while other builders run). No resource-limit kill.
`SJC_TEST_CLUSTER_TAG=browser-p1-d-1107d node scripts/test-db.mjs stop`: exit 0,
reported stopped. No D test cluster/listener/browser left running.

## Root inventories / coordinator-only work

D changed **lib/browser/controller-gate.mjs** from the root-hashed set.
D did NOT change gate.mjs, network-policy.mjs, controller-authority.mjs,
target-barrier.mjs, or any deploy/browser file. Its new imports depend on the
six new D modules; include their transitive source files in the installed source
inventory before acceptance. Refresh/relock inventories and provision the exact
candidate only through the coordinator; no installed runtime was modified here.

Not done: A/B installation and sink adapters above, durable candidate SQL/repository
and human candidate projection, current-document resource-only review, real
Chromium 1248 canary, all 28 root network +15 RSS/peer/target/pidfd gates, resolved
Claude CLI/history integration, SSE/device/take-over/visual acceptance. The 0b
root result is historical and does not attest the changed controller gate.
No activation/readiness/zero-time physical-death guarantee is asserted.
