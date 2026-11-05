SCORES: design=10 completeness=10

Round-3 guarantees: still hold

New mechanisms: sound

Reviewed the Canvas PLAN at `22a48134`, branch `t3/in-app-browser-agent-tools`, against round-3 review commit `6b3cfa0d8215567ca4ed858063e600b5e8d97b37`. Read AGENTS.md, shared context decisions 1–9, the previous security review, the revised plan including its Round-3 fixes/security-preservation appendix, and the changes to the plan and shared host. Rechecked the business profile/Ask runner and permission catalog in source. These scores approve the normative security design, not an implementation or completed release tests.

## Staff provenance and laundering

Sections 5.1 and 9 require complete authenticated conversation tracking before staff Canvas ships. The new mechanism does not substitute authenticated identity for input classification:

1. Every tool call registers durably as pending before invocation or result exposure. Conservative areas are recorded before results reach the model. The registry covers every tool and result/scope variant, including mutations and data-bearing failures. Incidental financial fields in `get_project` explicitly require their financial areas; classifying merely by the Projects route is forbidden. Missing entries, unknown schemas/variants and tracking failures produce incomplete/full-catalog classification, never an empty set. Section 10's `canvas-provenance-db.test.mjs` explicitly requires every registry tool to be covered, mixed variants/incidental money fixtures and failed/pending/storage-gap denial. Missing classification is therefore a required test failure, not a permissive default.
2. Context assembly accounts for prompts/page context, steers, person replies, earlier turns, generated summaries, extracted attachments, injected instructions and floor inputs before releasing them. Arbitrary pasted/imported business facts cannot be called non-sensitive by a model or keyword scanner; an attachment without a trusted sensitivity envelope is incomplete. Only positively established non-sensitive instructions/templates may contribute no areas.
3. Prior sensitivity survives later turns, summaries, truncation, compaction, model changes and null-run restore/latest/Save. Untracked history, unmatched resumed sessions and operator/shell/web contamination make completeness sticky-unknown. A second conversation cannot inherit an old CLI session/private context as a clean start, and copying untracked facts into it still requires classification. A new chat does not sanitize the copied data.
4. The operating-doc exemption is limited to canonical read-only `docs/automation-reliability` identities/versions; arbitrary paths cannot claim it. Those reads still require provenance records. The current staff profile excludes shell/edit/web/repo tools, and the Ask runner does not enable the separate permit-research web exception. Any uninstrumented input remains incomplete under the plan regardless of profile assumptions.
5. Under thread serialization, the whole conversation union/revision is checked at content commits and Save, including final publication. Other pending data calls block commits. The Canvas call's own finalized input record avoids self-deadlock without exempting other calls. Parent requirements only grow. Staff lacking requirements are refused; incomplete staff chats cannot create/update/save even if that person holds all areas. Actor permissions and model references never supply evidence of completeness.

This closes the requested area-laundering paths in the plan. Implementation must prove these input boundaries; the existing runner alone is not evidence that provenance already exists.

## Owner Save acknowledgement

Sections 4.2 and 8.4 preserve the security contract while reducing the number of acknowledgement rows. Unknown operator context preselects all 21 content areas. Untick all changes selection only; it neither acknowledges nor grants authority. One initially unchecked acknowledgement covers the entire exact removed set, with warnings and an accessible full list.

The owner-only, Origin/CSRF-protected challenge binds actor/session authentication epoch, canvas/version/project, current policy revision/baseline hash, sorted removed set and five-minute expiry. Policy revision incorporates whole-parent requirements and classifier/catalog/provenance revisions. Save compares that revision before reservation and again before publication, before treating the owner's smaller selection as intentional declassification. Selection changes/reticking and changed project, source, revision or expiry clear the acknowledgement. Wrong-set, expired and stale tokens cannot downgrade; a default Save cannot manufacture consent. Audit retains requested/effective/removed areas, revision and acknowledgement hash/time without token secrets. Staff audience/ack fields and MCP challenge acquisition remain forbidden; API omission remains owner-only. Only the saved copy is declassified, never the private parent. Section 10 retains corresponding positive and adversarial tests.

## Remaining round-3 guarantees

- Sections 5.2/8.4 retain construction-time stdio admission, captured runner identity, HTTP-ALS rejection and website DB revalidation for Canvas and every saved-file MCP path. Exact-victim HTTP claims cannot trigger privileged forwarding. Lists filter before names/counts/pagination; human access uses separate authentication.
- Sections 6 and 8.4 retain opaque HTTP/iframe sandboxes, hash-only trusted scripts, zero outbound resources, independent SVG reconstruction, escaped source/Markdown, bounded MessagePorts and static saved-file serving. No generated content can save, approve, invoke tools or access credentials. Browser enforcement remains a release gate.
- Saved copies retain immutable bytes/policy, current file authorization, signature-only/portal denial, external-delivery refusal at enqueue and delivery, non-removable profiles and atomic trash/restore associations. Retry and replacement conflicts cannot recover a weaker generation. Shared file access never grants source-thread access.
- Sections 8.5/10 and H5 move independent journal durability, fences, startup replay and thread-only maintenance into Phase 0. This strengthens release ordering. Missing shared 0100, partial/incompatible schema, stale replicas, unreachable authority and primary-volume loss cannot reopen private content. Deletion success still requires independent durable high-water plus tombstone; holds never restore access. Saved job copies remain independently protected.
- Team-label changes preserve stable permission keys and catalog revision checks. Compact layout/chip changes introduce no capabilities or policy reductions. Deletion/recovery copy suppresses fenced titles; floor-reference titles/links appear only when every reference is the requesting person's live readable canvas. Other-person, deleted and held references use generic copy. H2 still clears private pixels and reauthorizes on identity/thread changes; host layout does not authorize operations.
- Narrow-role protections, current-session checks, quotas, immutable history, owner-grant boundaries and security-preserving rollback remain required. No new client publication or send capability appears.

## Required to reach 10

None. No real exploitable or data-exposure gap requiring a plan change was identified.

Only this review file was written. No source/plan edits, subagents, browsers, servers, builds, database access, service operations or deployment. Verification was document/source inspection; implementation tests remain future release requirements.
