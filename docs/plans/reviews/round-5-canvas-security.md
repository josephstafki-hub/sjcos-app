SCORES: design=10 completeness=10

Round-4 guarantees: still hold

New mechanisms: sound

Reviewed the Canvas PLAN and shared host on `t3/in-app-browser-agent-tools`, including the Round-4 fixes appendix, against my round-4 review commit `f8bc65ee930b81f90bb066c4c2076ef634950ea8`. Requested HEAD was `85a7a5c6`; observed HEAD was `c8aba006`, whose additional browser engineering review does not change these two plans. Read AGENTS.md, shared context and the previous security review, inspected the plan/host diff, and spot-checked the current profile, permission bridge, shared question formatter and interaction response writer. These scores approve the normative plan, not the existing implementation or completed release evidence.

## Synchronous input boundaries

1. **Native and alternate readers:** §§5.1/9.1 remove Read/Glob/Grep from both business runners and the unattended webResearch tool list. Tracked panel runs additionally require an explicit minimal native tool set, strict MCP configuration and effective settings isolation before accepting a complete run epoch. This covers alternate native readers, subagents, inherited hooks/plugins and dynamic server additions; inability to enforce isolation fails launch/completeness closed. Interact denies forbidden readers before auto-allow handling, with no human Allow escape. Operator runs remain unknown/full-catalog. Code-only and unattended runs cannot manufacture complete staff Canvas provenance.
2. **Operating docs:** the replacement list/search/read tools use the same immutable, approved manifest and bounded verified bytes. IDs cannot select arbitrary paths. Component/descriptor checks, hash/version checks and refusal of symlinks, hard-linked aliases, changed files and root escapes prevent the non-sensitive-doc exemption from laundering arbitrary files. Even zero-area results record exact input/output hashes before delivery. The background-doc branch cannot be selected by arguments or become a fallback after failed panel ingestion.
3. **Attachments:** current and older turns use owned-conversation attachment IDs plus pinned generations, current source permissions and trusted sensitivity envelopes. Replacement bytes cannot inherit an old envelope. Extraction has bounded, network-free output and no native-file fallback. Unclassified uploads/imports make the conversation incomplete at ingestion, before a later read; summaries and extraction retain source sensitivity.
4. **Both question paths:** sjcos and interact share authenticated begin/completion ingestion. The sjcos registration joins its existing pending call; interact creates its own before waiting. Website web/mobile response ingestion atomically records response and provenance before answered status. Completion verifies the stored payload and response version/hash, reconstructs validated choices rather than echoing client strings, and gates arbitrary `other` text and returned permission-denial notes. Fixed validated controls may add no areas but retain the prior union. Missing adapters cannot silently use legacy delivery in a tracked panel run.

These mechanisms supplement, rather than replace, §9's exhaustive sjcos registry and tracking of prompts, steers, instructions, historical turns, summaries and floor data. Missing variants, unmatched resumed sessions and uninstrumented inputs remain sticky-unknown; neither model labels nor actor permissions establish completeness. Construction-time stdio identity, HTTP-ALS rejection and website DB revalidation apply to the new context adapter as well as Canvas/file adapters.

## Persistence failure and Save races

Section 9.1 supplies an actual before-delivery interlock. A failed begin performs no read or result delivery and holds/stops the tracked run. A failed or uncertain completion withholds all result bytes and retains unresolved pending/unknown state; safe error handling, timeout, disconnect and restart cannot clear it. A durable unknown result may be delivered only after full-catalog/sticky-unknown state is committed. Staff then cannot create/update/restore/latest/Save, even with every content permission. An unreachable DB cannot validate Save and therefore cannot publish.

Epoch, begin, completion and unknown updates serialize on the same thread row as Canvas writes and Save. A Save that commits before begin cannot contain that unreleased new input. If begin wins, pending state blocks publication; completion changes the revision, so stale Save must refresh/refuse. Reservation is insufficient: ready publication repeats the checks after filesystem work. Canvas finalizes only its own input bookkeeping, never another pending reader/question. Human null-run Save/restore/latest uses the same conversation state. Committed-but-undelivered input can over-restrict, not under-restrict. Existing immutable copies retain their original bytes/policy; retry cannot reuse a weaker generation under a stricter current policy.

Section 10 requires real runner/MCP adapter tests, both question registrations, web/mobile response ingestion, exact delivered hashes, alternate-reader attempts, persistence failures, lost acknowledgements, restart/resume and two-connection races through ready publication. Staff enablement remains blocked until that evidence exists; helper-only tests or eventual stdout traces are not accepted as proof.

## Warning and host changes

Showing per-row warnings only at three or fewer removals changes presentation, not consent. The single initially unchecked acknowledgement still covers the entire exact removed set, with full accessible disclosure. Its owner-only challenge binds actor/session epoch, canvas/version/project, current policy/baseline, sorted removals and expiry. Selection changes, including reticking across the three-removal threshold, clear it. Policy checks run before subset interpretation and again before publication; staff cannot submit declassification fields. Untick all is not acknowledgement, and the private parent remains monotonic.

Pointer-aware controls, floor edit hints and landscape chrome grant no capabilities. Floor scope/edit checks remain server-authoritative. The shared host retains one selector/exit coordinator, Browser leave guards, per-person/thread state, immediate private-pixel clearing and stale-response rejection. The Watch Escape correction closes only Joe's view and does not authorize control or expose the staff source chat.

## Other preserved guarantees

- Opaque HTTP/iframe sandboxes, exact trusted script hashes, zero outbound resources, independent SVG reconstruction, escaped Markdown/source, bounded instance-bound MessagePorts and script-free saved snapshots remain required. Layout does not enlarge bridge authority or waive browser/header release checks.
- Private thread ownership, current session/area checks and construction-time stdio admission still protect source and saved-file MCP operations. HTTP callers claiming exact victim run tuples cannot trigger privileged forwarding. Saved-file lists filter before names/counts/pagination; portal, signature-only and external-delivery paths remain denied.
- Immutable saved bytes/policy, non-removable file profiles, atomic trash/restore association and generation conflicts preserve audience boundaries. Shared copies never confer source-thread access.
- Phase 0 still includes all-Ask journal fences, synchronous independent intent/high-water durability, startup/recovery gating and thread-only maintenance. Missing schema, stale replicas, unavailable authority and primary-volume loss cannot reopen deleted private content. Holds do not restore access; saved job copies retain independent policy.
- Narrow-role restrictions, immutable identity/version history, quotas, audit redaction, floor-writer serialization, owner-grant boundaries, owner-only flags and security-preserving rollback remain normative.

## Required to reach 10

None. No real exploitable or data-exposure gap requiring a plan change was identified.

Only this review file was written. Verification was document/source inspection; no subagents, browsers, servers, builds, live database access, service operations or deployment.
