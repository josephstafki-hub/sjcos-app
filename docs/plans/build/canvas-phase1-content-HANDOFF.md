# Canvas Phase 1: pure content and renderer slice

Implemented on `t3/in-app-browser-agent-tools`, starting HEAD
`365c250d6c1a2354f90d33779cd1e4a4fd63ba1a`. Only the seven files in this
slice were written/staged. Concurrent slice 0-A files were left alone.

## Delivered interfaces

- `lib/canvas-content.mjs`: `validateCanvasContent({kind:'diagram',source})`,
  `validateDiagramSource(source)`, `validateCanvasSvg(svg)`, `CANVAS_LIMITS`,
  and the self-contained `createCanvasContentValidator()` factory used by the
  fixed child script. No Mermaid, third-party parser, DB, filesystem or network.
- `lib/canvas-renderer.mjs`: `buildCanvasRendererDocument({mermaidBundle,
  mermaidSha256})` returns `{html,headers,hashes}`. Only trusted code is accepted;
  there is no content/title/URL/CSP/identity parameter. `canvasResponseHeaders`
  supports `renderer`, `preview`, `error`, `wrapper`, `print`, `api`, `code`.
  Bootstrap/style strings, base64 SHA-256 digests, L2/error CSP and iframe sandbox
  constant are exported for integration. Node's built-in crypto is the only import
  beyond this slice's content module.
- `lib/canvas-classification.mjs`: pure, versioned registry shape validator,
  `assertEveryToolClassified(toolNames,registry)`, `classifyToolAreas`. No actual
  tool registry or permission catalog is populated, and no DB/provenance gate is
  implemented. The caller supplies the complete real content catalog in catalog
  order, excluding `ai`/`projects`. Empty areas must be an explicit trusted claim.
  Base and variant areas are unioned; unknown tools/variants return the entire
  supplied catalog with `complete:false`. A tool with variants requires an explicit
  recognized variant, even when its base areas are empty. The helper's `complete`
  means schema coverage only, never authenticated/persisted conversation provenance.

Registry shape:

```js
{
  version: 1,
  content_areas: [/* ALL real content PermissionKeys in catalog order */],
  tools: {
    tool_name: {
      areas: [/* always-touched areas, including incidental fields */],
      variants: { known_variant: { areas: [/* additional areas */] } } // optional
    }
  }
}
```

## Grammar and limits

The input gate accepts `flowchart`/`graph` (optional fixed direction),
`sequenceDiagram`, `stateDiagram-v2`. This is a deliberately bounded subset,
not a replacement for Mermaid's parser. ASCII node IDs, ordinary shape labels,
arrows, pipe or plain edge labels, fan-out/chains, comments, bounded subgraphs,
sequence participants/actors/messages/notes/loop/alt/opt/par/critical/break blocks,
and state aliases/transitions/composites/descriptions are supported. Unsupported
extensions fail closed. There are no author styles/classes, configuration,
registrations, links, images or HTML/Markdown links. Safe quoted words such as
"click", "href" and "style" remain text. Unicode labels are preserved. Only a
leading BOM and CR/CRLF are normalized; input bytes are checked before normalization.
Returned `source_bytes` describes the normalized source. Hash/persist that exact
accepted string; keep original request hashing separate for idempotency.

Early limits: 32,768 UTF-8 source bytes; 100 layout nodes (clusters included;
composite state namespaces distinct); 200 flowchart edges (fan-out multiplies);
12 nesting levels including lexical bracket ceilings; sequence/state use the
100-participant/state and 400-statement equivalents. Repeat references do not
create new nodes. Parser/model preflight remains a second gate in the child.

SVG output is parsed/reconstructed with a closed XML drawing/attribute grammar.
No HTML parser repair, script/style, events, foreignObject, use, SMIL, images,
external href, XML declarations/DOCTYPE/entities or unknown attributes are accepted.
Predefined/numeric text entities are decoded then escaped. Every local drawing
reference must resolve to a unique ID, and IDs/references are rewritten. Budgets:
512 KiB at input AND canonical output, 10,000 elements, depth 32, finite dimensions
and numeric coordinates bounded to 8192, 100,000 aggregate path units (each command
plus each coordinate pair, rounded up per command). Polygon/polyline pairs count
too. These units conservatively cover both points and commands; arc flags and
command arity are checked.

Errors have fixed messages, `retryable:false`, `status`, and `toJSON()` yielding
the §5.1 error envelope. Codes emitted by the content module:

- `INVALID_INPUT` (400): shape/empty/invalid Unicode/structural input; field names only.
- `UNSUPPORTED_KIND` (422): non-diagram content or unsupported diagram family.
- `UNSAFE_CONTENT` (422): fixed `details.rule`, never input fragments.
- `CONTENT_TOO_LARGE` (413): `max_bytes`, `received_bytes` only.
- `TOO_COMPLEX` (422): counts only.

The bridge additionally returns fixed `RENDER_FAILED` errors, without raw parser
messages. Asset/configuration/registry programming errors throw fixed-message
TypeError/Error; route adapters must map them safely rather than leaking stacks.

## Renderer and headers

The returned document inlines only the verified standalone bundle and fixed bridge.
It has no source in its HTML/URL and no external script tag. Exact hashes are
computed over the actual inline UTF-8 script bytes; HTML script-end tokens, HTML
comment openers, runtime imports and source-map URLs in trusted scripts are rejected.
Layout style has its own exported digest; §6.4 intentionally uses
`style-src 'unsafe-inline'`, not a style-only hash policy, for SVG/layout attributes.

L1/L2 HTTP CSP uses `sandbox allow-scripts`, hash-only script sources,
`script-src-attr 'none'`, `default-src 'none'`, the complete §6.4 resource-denial
list and `frame-ancestors 'self'`. Error documents have `sandbox` and no scripts.
Wrapper/print only add `frame-ancestors 'none'` plus `X-Frame-Options: DENY`;
DENY is deliberately absent from renderer/preview headers. Every header set is
private/no-store, nosniff, no-referrer, has an explicit MIME and no CORS/cookies.
Child sets also contain the exact Permissions-Policy from §6.4.

The fixed bridge generates separate random 128-bit instance and nonce values,
announces `canvas-ready`, and accepts one parent-only `connect` with the same pair
and one MessagePort. Parent must verify current WindowProxy + null child origin +
pair before transfer. Child rejects a null parent origin. Subsequent bounded
messages include instance, nonce and increasing integer sequence. One render per
frame; replacement is required for another version/retry. Commands are `render`
(diagram only), `measure`, `dispose`. There are no save/approve/navigation/tool
commands. Height is clamped to 8192 at at most 5/s; focus/Escape events contain
control data only. Dispose clears private pixels, disconnects observation and
closes the port. Parent must implement its own 3-second render watchdog and disposal
on all policy/selection/logout/hidden transitions. Child handshake expires in 10 s.

Mermaid is initialized with strict security, HTML labels disabled (globally and
flowchart), fixed theme/font/layout, secured config keys, no bindFunctions, and
bounded input/edges. Parser-model accessors fail closed when absent/unrecognized.
Upstream SVG is parsed inertly, stylesheet/class styling is replaced with fixed
presentation values, forbidden executable/resource elements are refused, and the
independent shared SVG gate reconstructs the result. Runtime ID prefixes and the
final serialized byte budget are applied before replying. Parent/server must still
revalidate this reply before export; a child reply never constitutes a saved change.

## Exactly what the coordinator must wire

1. Pin/install **Mermaid 12.3.0** and its lockfile in the coordinator's authorized
   isolated packaging workflow. This slice did NOT install anything: worktree
   node_modules points at the live installation.
2. Verify package integrity/advisories. Package **dist/mermaid.min.js**, the standalone
   bundle, at server-only placeholder `renderer-assets/mermaid-12.3.0.min.js`
   (`MERMAID_ASSET_PATH`), or resolve an equivalent private build asset. Include it
   in Next output tracing. Never use an ESM/dynamic-import entrypoint or CDN.
3. Review/remove any distribution source-map directive or safely serialize any literal
   script-end/comment-opener tokens **before hashing**. Compute the expected SHA-256
   **base64** digest over those exact final UTF-8 bytes, pin that reviewed digest in
   trusted server packaging/configuration, and pass `{mermaidBundle,mermaidSha256}`.
   `MERMAID_ASSET_SHA256` is intentionally `null`; no fake production digest or
   permissive fallback exists. Merely hashing whatever file is present at request
   time is not package-integrity verification. Cache public code bytes only.
4. Add authenticated raw routes and all error headers; call the builder for renderer.
   Implement wrapper/print Next headers and no-store proxy branches without matching
   `/api/canvas/*` with wrapper DENY. Implement JSON/code MIME paths separately.
   No route, next.config.ts or proxy.ts was edited here.
5. Build the parent MessageChannel protocol/strict reply validator, selected-version
   controls, SVG export submission and lifecycle/watchdog. Do not grant same-origin
   sandbox privileges or interpolate source into scripts/documents.
6. Run pinned-library compatibility/golden fixtures for all three families: actual
   `diagram.db.getVertices/getEdges`, `getActors/getMessages`, `getStates/getRelations`
   shapes and counts; fixed-theme label/arrow/color/text bounds; SVG attribute
   compatibility. Unknown shapes/attributes currently fail closed. These runtime
   paths were NOT tested against Mermaid because it is absent and may need reviewed
   pinned-version adaptation before release. Run emitted-build script-byte/hash
   checks too (the builder derives bootstrap source with function.toString()).
7. Verify actual HTTP 200/401/404/redirect headers and browser/Safari CSP/network,
   opaque origin, direct raw-route access, print behavior, phone render responsiveness,
   compression and ≤1.7 MiB gzip budget. No browser/server/build was run here.
8. Populate the exhaustive server tool/result-variant registry against the real
   catalog and wire authenticated synchronous provenance/DB gates. No actor-area or
   model-label completeness fallback. This slice alone does not enable staff Canvas.

Not delivered: full L2 HTML/CSS sanitizer or page-document builder (page content is
rejected), print-layout messaging, floor plans, app routes/components, migrations,
tool registration, provenance persistence, export storage, permissions/admission,
quotas or deployment. The exported L2 bootstrap/CSP are fixed primitives only.

## Verification

Tests/30 fresh adversarial expectations were written first. Both test files first
failed with expected missing-module imports; implementation followed. Final checks:

- `node --test tests/canvas-content.test.mjs`: **51 passed, 0 failed**, including
  the plan's entire pure-content Phase 1 bullet and extra registry/SVG boundaries.
- `node --test tests/canvas-renderer.test.mjs`: **6 passed, 0 failed**, exact CSP and
  script-byte hashing, MIME/wrapper split, asset rejection, plus fixed-bootstrap
  execution and handshake negatives in a Node VM with control-only DOM stubs.
- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.

These are unit/schema checks, not proof of browser CSP enforcement or real Mermaid
rendering. No DB, dependency installation, browser, server, build, service operation,
deploy or subagent was used. No process exited 137.
