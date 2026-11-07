# SJC parser / transport ABI v1

`transport_runtime.py` is the dedicated executable for mitmproxy **12.3.1**.
It subclasses the real `ConnectionHandler`, dispatches real HTTP/server hooks,
and drives the real `ClientTLSLayer` / `ServerTLSLayer` handshake generators.
`transport_tls.py` overrides their growing plaintext collector and imposes
record/handshake bounds before BIO input. `BoundedParser` uses the installed
mitmproxy HTTP/1 head parser and h11 body readers. It replaces stock HttpStream
collection; no stock StreamReader/Writer, HttpStream, DumpMaster, flow store,
protocol guessing, content logging, or shared package mutation is used.

## Launch and deployment boundary

```sh
/opt/sjcos-browser/py/bin/python /opt/sjcos-browser/transport_runtime.py --config /etc/sjcos-browser/<run>.json
```

Root supplies the config and installs the seven exact hashed Python sources.
The config and all ancestors must be root-owned and not group/other-writable;
symlinks are refused. The config is at most 32768 bytes, with exactly:

```json
{
  "controlSocket": "/run/sjcos-browser/<private-run>/gate.sock",
  "policySocket": "/run/sjcos-browser/controller-<run-uuid>.sock",
  "listenHost": "10.203.0.2",
  "listenPorts": [18081, 18082],
  "clientCert": "/etc/sjcos-browser/fixture-chain.pem",
  "clientKey": "/etc/sjcos-browser/fixture-key.pem",
  "upstreamCa": "/etc/sjcos-browser/fixture-ca.pem",
  "sourceHashes": {
    "parser_adapter.py": "<sha256>",
    "transport_runtime.py": "<sha256>",
    "transport_tls.py": "<sha256>",
    "transport_dns.py": "<sha256>",
    "transport_control.py": "<sha256>",
    "egress_gate.py": "<sha256>",
    "closed_dispatcher.py": "<sha256>"
  },
  "deniedAddresses": []
}
```

`deniedAddresses` must include the root-reviewed public app/host/alternate IP
inventory. Private/reserved/loopback/metadata/mapped/translation addresses are
always refused independently. `upstreamCa:null` uses system trust; verification
is never disabled. The supplied client certificate must cover every approved
fixture hostname (a reviewed dynamic CA factory can be supplied to the Python
factory instead). The CLI client chain is <=32 KiB. Private keys/CA <=64 KiB.
Root creates a private socket directory accessible to the dedicated process;
the policy server remains uid 0. The control socket is mode 0600 and authenticates
uid 0 via SO_PEERCRED; the policy client also requires uid 0 via SO_PEERCRED.

This root-protected, hash-pinned config is a **candidate test launch capability**,
not signed completed acceptance. There is no `attested:true` config, automatic
signer, installer, release flag, root path override or fixture network bypass.
The coordinator still verifies wheel/transitive/binary locks, namespace/cgroup
policy, independent signatures and full runtime readiness outside this process.
Do not replace that deployment check with a true-returning predicate in a
production Python embedding. Stock masters cannot attest by attaching an object.

Python embedding:
`create_runtime(policy, tls_config, verify_deployment, key, *, denied_addresses=())`
returns a `TransportRuntime`; its `.adapter` is the `RuntimeAdapter` addon ABI.
`key` is 32 bytes. `tls_config` is `TLSConfiguration(client_context_factory,
ca_file=None)`; the factory returns a verified client-facing OpenSSL context.
`bind_listener(sock,binding)` takes a listening TCP socket and returns a decimal
Linux SO_COOKIE string. `await serve_listener(cookie)` owns accepting it.
`revoke_listener(cookie)` and `revoke_all()` synchronously close listener FDs and
all matching TCP sockets, persist unknowns, and cancel active handlers. `await runtime.settled()` waits for their send frames
to unwind before every reservation/reference is dropped.
An error still attempts cleanup for every other flow before being raised; the
async owner must always await settlement, including in its finally block.

## Root control framing and commands

Each connection carries one uint32 network-order length and one JSON object,
1..32768 bytes. One reply uses the same framing. No HTTP or TCP control endpoint.
An invalid peer/message revokes the process. Existing socket paths are never
unlinked at startup. SIGTERM/SIGINT close listeners/connections and clean up.

- `bind`: `{op:"bind",port:18081,binding:{generation,guardId,contextId,taskId,bootId,targetId}}`.
  Generation is a positive integer; IDs match `[A-Za-z0-9_-]{1,120}`. Returns
  `{ok:true,listenerCookie,generation}`. Bind once per context, max two contexts.
- `guard`: `{op:"guard",listenerCookie,generation,guardId,targetId}`. Max 16
  registered target/guard pairs per context listener; multiple pages/OOPIFs
  share the context listener. The root controller registers these after actual
  guard attachment. Kernel state identifies the socket/listener/context;
  browser target identity is derived from this root-authenticated registration
  and exact paused-Fetch correlation, never from HTTP or a claimed TCP target.
- `fetch`: `{op:"fetch",listenerCookie,generation,requestDigest,guardId,targetId}`.
  One pending correlation per listener. Register this DURING the policy
  `request` RPC, before returning its decision, after matching actual paused
  Fetch metadata to normalized parser metadata. The policy RPC runs in a bounded
  worker, so the control loop remains available. CDP header bytes need not equal
  Chromium's normalized HTTP bytes. Correlation selects a registered pair and
  is consumed exactly once. No body IPC, URL-only or origin-only fallback.
- `revoke`: `{op:"revoke",listenerCookie,generation}`. Closes listener before
  reuse, awaits handler shutdown and returns `{ok:true,closed:true,durable:true}`
  only when required terminal RPCs acknowledged. `revoke_all` is boot-terminal.
  Listener cookies never repeat; old-generation/old-cookie results are refused.
- `stats`: current flows/handlers/transport reservations/pools, observed maxima,
  max response slots, max directional queue bytes, listener count and dead state.
- `events`: last <=64 content-free observations with monotonic sequence/time,
  droppedEvents and lastSequence. No URL/header/body/secret history. Real events
  include flow_open, hook, connect_pin, peer_verified, drained, flow_closed,
  listener_closed and fault. Closure reports plaintext presented to TLS and
  actual encrypted socket bytes accepted by `send`, including partial sends.
  These are distinct metrics and do not prove origin receipt.
- `case_begin {name}`: starts a telemetry interval with no active flow. It does
  not create DNS/origin fixtures or return a fixture URL. `case_end` returns
  name/events/stats and clears the interval/fault. The ring can drop events;
  acceptance must refuse dropped/missing evidence.
- `fault_arm {point,action}`: one root-authorized real interruption during an
  active case. Points: before_request_decision, after_consume, before_connect,
  after_connect, before_drain. Actions: revoke_all, close_client,
  close_upstream, raise. A raise is boot-fatal. This does not synthesize DNS,
  peer mismatch, SNI, Host, CDP, packet, fixture-ingress or acceptance events.

## Metadata policy RPC

All events carry `{v:1,event,id,listener,generation,listenerCookie,guardId,
contextId,taskId,bootId,targetId,remainingMs}`. The initial target is advisory
until the exact request correlation selects a registered guard. Early events
also carry bounded `guardCandidates`; later events/terminal receipts carry the
selected target. Bindings are stored privately and checked again after EVERY
await before forwarding. Each flow's deadline starts at accept, never refreshes
at CONNECT or request/keepalive. This is conservative relative to CONNECT+60s.

- http_connect: canonical DNS authority + :443, HTTP/1.1, Host exactly authority.
  No dial, server certificate sniffing, passthrough or body. ClientHello SNI
  must exactly match; ALPN is absent or only http/1.1.
- requestheaders: method,url,projected headers,hostAuthority,sni,
  dns:{hostname,chain,addresses,ttlMs}. Host must match CONNECT/SNI. Only
  origin-form request targets. Accept-Encoding is projected to identity before
  hashing/authorization; controller must approve this exact projection.
- request: the above plus bodyBytes,bodySha256,requestDigest. Digest is SHA-256
  of sorted-key canonical UTF-8 JSON `{method,url,headers,bodySha256}` (no spaces;
  Unicode is UTF-8, matching JS canonical()). The immutable body stays local.
- server_connect: fresh dns,hostname,address. Every actual new socket repeats
  CNAME/A/AAAA for each link, through fixed 10.204.0.2:53 TCP Unbound; <=8 links,
  <=32 addresses, <=64 RRs/query, <=4096 wire bytes. No libc DNS/cache/fallback.
  Every returned A/AAAA is validated; a mixed private answer fails entirely.
  Original approved pin must remain in fresh answers. Dial numeric IP:443 only.
- server_connected: dns,hostname,peerAddress. Kernel getpeername must equal the
  pin/443. SNI is original hostname; OpenSSL verifies trust AND hostname with CN
  fallback disabled. Decision expiry bounds DNS/dial/TLS; no expiry refresh.
- responseheaders: status,headers. response: bodyBytes,bodySha256. No content IPC.

Reply echoes `{ok:true,event,id,generation,listenerCookie,guardId}`. A request
reply additionally requires `{allow:true,requestDigest,decisionId,expiresInMs,
pin:{hostname,address},kind:"read"|"write"}`. Duration is finite, positive,
<=2000ms, measured conservatively from RPC START and bounded by DNS TTL/original
deadline. Writes require `{consumed:true,unknownToken}` after the controller
verifies its signed proof, durable consume and independent checkpoint. Python
selects only the registered Fetch correlation and forwards its exact frozen
projection. It does not trust a browser/header supplied digest or receipt.

Terminal calls work after revocation but cannot authorize a send:
`persist_unknown` carries unknownToken and requires `{ok:true,durable:true}`;
`close_flow` carries success and requires `{ok:true}`. The owner attempts consumed
unknown once before dropping body storage. External revoke keeps body charges
until cancelled async send frames unwind; control ACK waits for that settlement. Persistence failure kills the boot,
closes every listener/socket and still cleans every other flow. Success requires
a real completed downstream kernel send and durable terminal ACK; the response
slot remains charged during blocked sends. It is not released by response hooks.

## Allocation and lifecycle

56/112/24 MiB are separate nonborrowing pools. Before any socket/TLS scratch is
allocated, each of at most two accepted connections precharges 2 MiB transport
for bounded socket, TLS, head, h11 and metadata scratch/copies. Request head
validation reserves two exact body representations +4096 request overhead and
56 MiB response capacity, max two globally and one/context. No losing body queue.
Transport precharge transfers into the request reservation without double charge.

Headers <=32768 bytes/128 fields. Reject duplicates (including equal duplicate
lengths), Expect, upload TE, trailers, upgrades, nonidentity encoding, unknown or
>25 MiB upload before allocating its body or replying 100-continue. Responses
use fixed <=25 MiB collection/frozen copy; chunked and clean TLS close-delimited
responses use the same bounded reader. No decompression/decoded accessor.

TLS record <=18432 encrypted bytes, plaintext <=16384 per fragment, handshake
input/output <=65536, post-handshake control bytes without plaintext <=65536;
checks precede client-hello append/BIO input. No TLS renegotiation/compression/
session cache/tickets. Every output fragment drains before the next generator
step; no growing plaintext flight or paused Layer queue. Socket send/receive
buffers are requested at 32 KiB (Linux doubles to 64 KiB); application directional
queues <=65536. A nonblocking send loop tracks partial sends accurately.

The dedicated lifecycle intentionally closes after ONE request and response.
It refuses pipelining rather than retaining keepalive decisions. Original
monotonic accept+60s and body+15s deadlines never refresh. A one-byte disconnect
watch runs after complete upload while policy/upstream/response work proceeds;
EOF, further input, reset, TLS failure, timeout, cancellation, any hook exception
and revoke all close sockets, persist consumed unknown, zero mutable bodies and
drop HTTP/TLS/parser references. Unexpected dispatcher failures revoke the boot.

## Evidence boundary

`transport_tests.py` and `parser_adapter_tests.py` run against the installed
12.3.1 package with process-local loopback TLS/DNS/TCP fixtures only. They do not
claim root namespace/firewall/cgroup results. The coordinator must install the
new sources, wire the launcher/controller to THIS executable, refresh lock/source
hashes, complete the real network and parser-transport/RSS fixtures, run capped
acceptance, and independently review/sign evidence. `parserTransportIntegrated`
can identify this real transport only once that installed wiring is demonstrated.
Keep all release/feature readiness OFF until the entire acceptance gate passes.
