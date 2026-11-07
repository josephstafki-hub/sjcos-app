# Mandatory SJC parser adapter ABI v1 — activation blocker

The stock mitmproxy wheel cannot enforce a ledger before its own allocations.
`egress_gate.py` therefore refuses stock startup. Do not add a dummy
`sjc_runtime_v1` or treat passing counter tests as parser evidence.

The dedicated patched launcher installs `closed_dispatcher.install()` before
constructing DumpMaster, calls seal(master, required_addon, kill_all) before
accepting sockets, loads only EgressGate and minimal protocol addons (no
script hot reload, dumper, save, replay, UI, flow store). The master must expose
`sjc_runtime_v1` with these exact methods:

- `attested()` verifies package wheel + transitive lock, parser patch/bundle,
  addon/dispatcher and policy digests, root-owned signed deployment acceptance.
- `assert_options(options)` requires lazy connection, body limit 25m, no request
  or response streaming, HTTP2/3/websocket/rawtcp/upstream_cert/ssl_insecure OFF;
  empty ignore_hosts, no passthrough/upstream/replay/save/history or content logs.
- `remaining(flow)` uses original monotonic deadline (60 s, body 15 s).
- async `event(name,flow)` maps kernel listener port/generation, boot/task and
  guarded target to RequestGate. Never accept these bindings from HTTP headers.
  `http_connect` checks canonical HTTPS/443 authority, no origin dial/sniffing.
  `requestheaders` calls headers() and rejects before parser allocation, reserves
  two body copies + transport + fixed response slot; no queued body. `request`
  calls body() only after complete bounded collection; sends digest/nonce/exact
  safe request manifest to authenticated controller RPC, verifies signed <=2s
  single-use proof (durable consume receipt + independent checkpoint for writes).
  Forwards ONLY immutable returned bytes; no later addon header edits. Bind exact
  read manifest revision/hash/use/provenance in verifier, never origin-only allow.
- async `server_connect(data)` obtains complete fresh Unbound CNAME/A/AAAA proof,
  validates and selects public IP, sets address=(pin,443), original SNI and normal
  certificate validation. No DNS hostname connect fallback or upstream auth.
  `server_connected(data)` checks actual peer and pin/generation/expiry.
- `release(flow,success=False)` persists unknown for consumed writes before
  releasing every copy/reference. Release successful response slot only AFTER
  downstream drain. `revoke_all()` atomically invalidates decisions/listeners,
  closes all TCP/TLS/upstream/keepalive; generation reuse waits for close ack.

Patch the pinned parser's ingress *before* socket read/bytearray append,
Content-Length/chunk parser concat, immutable copies and TLS/outgoing queues.
Charge 56/112/24 MiB nonborrowing pools with one shared owner. Response reserve
56 MiB BEFORE read consume/upstream/action consume, two globally, one/context;
rotate simultaneous contenders without body queues. Reject compressed encoding
before decode and never call decoded accessors. Max payload 25 MiB, directional
queue/chunk 64 KiB. Pause read before high-water allocation, resume after drain.
Header size 32 KiB; reject duplicate/ambiguous lengths, request TE/trailers/Expect,
unknown upload length and non-identity request encoding before 100-continue/body.
Response unknown/chunked collection is bounded; reject short/oversize/slow flows.
Transport metadata, DNS/cert caches bounded; measured baseline <=144 MiB,
accounted <=336 MiB, RSS/cgroup <=384 MiB with 48 MiB untouched headroom.

This slice supplies addon/dispatcher/policy and acceptance driver protocol, NOT
this mitmproxy internal parser patch or a production Unix RPC adapter. Until a
reviewed implementation and measured tests exist, runtime preflight MUST fail.

## Acceptance implementation boundary (2026-11-06, network builder)

`parser_adapter.py` now implements the bounded pinned head/body parser, reserved
collection/frozen copy owner, fixed recv_into/write transport primitives and
root-peer length-framed metadata RPC. Offline tests import the installed
12.3.1 parser classes, not doubles for those classes. `RuntimeAdapter` exposes
the addon ABI but deliberately requires an actual reviewed transport implementing
`attested`, `event_metadata`, `apply_verified`, `server_connect`,
`server_connected`, `persist_unknown`, `close_flow`, `revoke_all`.
This is NOT yet a patch to stock mitmproxy's TLS/ConnectionHandler/HttpStream.
No stock master can attest by attaching this object alone. The private TLS and
kernel-listener/target binding, signed verifier, DNS proof and durable controller
integration remain required. `parserPatchSha256` identifies the adapter source,
not a declaration that the full transport is accepted; readiness additionally
requires `parserTransportIntegrated:true` in reviewed signed evidence.

No driver may set `realRuntime:true` based only on `AllocationOwner`/RequestGate
counters. `network-driver` has real direct packet probes; its launcher scenarios
must supply the independent origin/parser measurements. `rss-driver` refuses
until an integrated `/opt/sjcos-browser/fixtures/parser-transport-driver` exists.
That integrated driver is NOT implemented by this change. This is a named
remaining implementation blocker, not a coordinator install-only step.
