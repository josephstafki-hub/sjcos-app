"""Bounded ingress for mitmproxy 12.3.1. Not an addon-after-allocation patch.

Only BoundedIO may read the socket. Every payload allocation has a pre-existing
nonborrowing reservation. No decoded accessors, flow history, body IPC or logs.
The dedicated TLS transport must use this boundary; stock DumpMaster is refused.
"""
import asyncio
import importlib.metadata
import json
import math
import re
import socket
import struct
import time
from dataclasses import dataclass, field

from mitmproxy.net.http import http1
from mitmproxy.proxy.layers.http import _http1
from mitmproxy.net.http.http1.read import expected_http_body_size
from h11 import Data, EndOfMessage, ProtocolError
from h11._receivebuffer import ReceiveBuffer

MIB = 1024 * 1024
PAYLOAD = 25 * MIB
HEADER = 32768
QUEUE = 65536
CAPS = {"request": 56 * MIB, "response": 112 * MIB, "transport": 24 * MIB}


class Refused(Exception):
    """Content-free failure, never include peer data in an exception."""

    def __init__(self, code="BROWSER_BAD_INPUT"):
        super().__init__(code)


@dataclass
class Reservation:
    context: str
    request: int
    deadline: float
    body_deadline: float
    consumed: bool = False
    draining: bool = False
    unknown_attempted: bool = False
    buffers: list = field(default_factory=list)
    parsers: list = field(default_factory=list)


class AllocationOwner:
    """One owner for all parser instances, reserve BEFORE creating body storage."""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.persist_unknown = None
        self.flows = {}
        self.pools = dict.fromkeys(CAPS, 0)
        self.maxima = dict.fromkeys(CAPS, 0)
        self.next_context = 0
        self.max_slots = 0

    def reserve(self, key, context, size):
        if context not in (0, 1) or not isinstance(size, int) or not 0 <= size <= PAYLOAD:
            raise Refused()
        if key in self.flows or len(self.flows) >= 2 or any(f.context == context for f in self.flows.values()):
            raise Refused("BROWSER_BUFFER_BUSY")
        request = size * 2 + 4096
        charge = {"request": request, "response": 56 * MIB, "transport": 6 * QUEUE}
        if any(self.pools[k] + charge[k] > CAPS[k] for k in CAPS):
            raise Refused("BROWSER_BUFFER_BUSY")
        now = self.clock()
        self.flows[key] = Reservation(context, request, now + 60, now + 15)
        for k in CAPS:
            self.pools[k] += charge[k]
            self.maxima[k] = max(self.maxima[k], self.pools[k])
        self.max_slots = max(self.max_slots, len(self.flows))
        self.next_context = 1 - context

    def contenders(self, candidates):
        # Batch only metadata; caller must refuse bodies for every losing contender.
        if len(candidates) > 16:
            raise Refused()
        order = sorted(candidates, key=lambda c: c[1] != self.next_context)
        result = []
        for key, context, size in order:
            try:
                self.reserve(key, context, size)
                result.append(key)
            except Refused:
                pass
        return result

    def live(self, key, body=False):
        f = self.flows.get(key)
        if f is None or self.clock() >= (min(f.deadline, f.body_deadline) if body else f.deadline):
            self.release(key)
            raise Refused("BROWSER_DEADLINE")
        return f

    def allocate(self, key, size, response=False):
        f = self.live(key, body=not response)
        if not 0 <= size <= PAYLOAD:
            raise Refused()
        # Each direction has at most mutable collection + frozen copy. The
        # reservation is worst-case; append cannot grow a bytearray implicitly.
        direction = "response" if response else "request"
        existing = [(d, b) for d, b in f.buffers if d == direction]
        limit = PAYLOAD * 2 if response else f.request - 4096
        if sum(len(b) for _, b in existing) + size > limit or len(existing) >= 2:
            raise Refused("BROWSER_BUFFER_BUSY")
        b = bytearray(size)
        f.buffers.append((direction, b))
        return b

    def freeze(self, key, b, response=False, length=None):
        f = self.live(key, body=not response)
        direction = "response" if response else "request"
        if not any(d == direction and x is b for d, x in f.buffers):
            raise Refused()
        if len([1 for d, _ in f.buffers if d == direction]) != 1:
            raise Refused()
        if length is None:
            length = len(b)
        if not isinstance(length, int) or not 0 <= length <= len(b):
            raise Refused()
        frozen = bytes(memoryview(b)[:length])  # second copy reserved before read
        f.buffers.append((direction, frozen))
        return frozen

    def consume(self, key):
        self.live(key).consumed = True

    def response_complete(self, key):
        self.live(key).draining = True

    def drained(self, key):
        if not self.live(key).draining:
            raise Refused()
        return self.release(key, True)

    def release(self, key, success=False):
        f = self.flows.get(key)
        if f is None:
            return "failed"
        # Every terminal path, including parser errors and deadline expiry,
        # crosses this boundary. Keep the reservation until durable persistence
        # has been attempted; failure must still zero and drop body storage.
        try:
            if not success:
                self.persist_unknown_once(key)
        finally:
            self._release_storage(key, f)
        return "succeeded" if success else "unknown" if f.consumed else "failed"

    def persist_unknown_once(self, key):
        f = self.flows.get(key)
        if f and f.consumed and not f.unknown_attempted and self.persist_unknown is not None:
            # A persistence error revokes the boot; never retry a consumed write
            # or retry its terminal persistence implicitly during cleanup.
            f.unknown_attempted = True
            self.persist_unknown(key)

    def _release_storage(self, key, f):
        self.flows.pop(key, None)
        self.pools["request"] -= f.request
        self.pools["response"] -= 56 * MIB
        self.pools["transport"] -= 6 * QUEUE
        for _, b in f.buffers:
            if isinstance(b, bytearray):
                v = memoryview(b)
                zeros = bytes(QUEUE)
                for i in range(0, len(b), QUEUE):
                    n = min(QUEUE, len(b) - i)
                    v[i:i+n] = memoryview(zeros)[:n]
        f.buffers.clear()
        for parser in f.parsers:
            parser._drop()
        f.parsers.clear()

    def revoke_all(self):
        outcomes, error = {}, None
        for key in tuple(self.flows):
            try:
                outcomes[key] = self.release(key)
            except BaseException as exc:
                error = error or exc
        if error is not None:
            raise error
        return outcomes


class BoundedIO:
    """Fixed recv_into scratch + synchronous drain. No user-space send queue.

    TLS integration must give an equivalently bounded recv_into/send transport;
    asyncio StreamReader/StreamWriter are deliberately not accepted implicitly.
    """
    def __init__(self, sock, deadline, clock=time.monotonic):
        self.sock, self.deadline, self.clock = sock, deadline, clock
        self.scratch = bytearray(QUEUE)
        self.max_queue = 0
        self.bytes_read = 0
        self.bytes_written = 0

    def remaining(self):
        left = self.deadline - self.clock()
        if left <= 0:
            raise Refused("BROWSER_DEADLINE")
        self.sock.settimeout(left)

    def read(self, maximum=QUEUE):
        if not isinstance(maximum, int) or not 0 < maximum <= QUEUE:
            raise Refused("BROWSER_QUEUE_LIMIT")
        self.remaining()
        n = self.sock.recv_into(memoryview(self.scratch)[:maximum], maximum)
        self.max_queue = max(self.max_queue, n)
        self.bytes_read += n
        return memoryview(self.scratch)[:n]

    def write(self, data):
        data = memoryview(data)
        for start in range(0, len(data), QUEUE):
            view = data[start:start+QUEUE]
            while view:
                self.remaining()
                n = self.sock.send(view)
                if n <= 0:
                    raise Refused("BROWSER_DISCONNECTED")
                self.bytes_written += n
                self.max_queue = max(self.max_queue, len(view))
                view = view[n:]


class BoundedParser:
    """Pinned real mitmproxy head parser / h11 body readers, bounded beforehand."""
    def __init__(self, owner, key, context=0, response=False, request=None):
        if importlib.metadata.version("mitmproxy") != "12.3.1":
            raise Refused("BROWSER_RUNTIME_PIN")
        self.owner, self.key, self.context = owner, key, context
        self.response, self.request = response, request
        self.head = bytearray(HEADER)
        self.used = 0
        self.message = None
        self.size = None
        self.body = None
        self.received = 0

    def feed_head(self, data):
        # The transport reads at most the remaining head space, before append.
        if self.message is not None or len(data) > HEADER - self.used:
            self.owner.release(self.key)
            self._drop()
            raise Refused("BROWSER_HEADER_LIMIT")
        self.head[self.used:self.used+len(data)] = data
        self.used += len(data)
        end = self.head.find(b"\r\n\r\n", 0, self.used)
        if end < 0:
            if self.used == HEADER:
                self.owner.release(self.key)
                self._drop()
                raise Refused("BROWSER_HEADER_LIMIT")
            return None
        end += 4
        # Copies are bounded by HEADER, never by body length.
        raw = bytes(memoryview(self.head)[:end])
        self.begin(raw)
        return memoryview(self.head)[end:self.used]

    def begin(self, raw):
        if self.message is not None or len(raw) > HEADER or not raw.endswith(b"\r\n\r\n"):
            self.owner.release(self.key)
            self._drop()
            raise Refused("BROWSER_HEADER_LIMIT")
        try:
            lines = raw[:-4].split(b"\r\n")
            fields = []
            seen = set()
            for line in lines[1:]:
                name, value = line.split(b":", 1)
                name = name.lower()
                if not re.fullmatch(rb"[a-z0-9!#$%&'*+.^_`|~-]+", name) or name in seen:
                    raise Refused()
                value = value.strip(b" \t")
                if any(c < 32 or c == 127 for c in value):
                    raise Refused()
                seen.add(name)
                fields.append((name, value))
            headers = dict(fields)
            if len(fields) > 128 or any(k in headers for k in (b"expect", b"trailer", b"upgrade")):
                raise Refused()
            if headers.get(b"content-encoding", b"identity") != b"identity":
                raise Refused("BROWSER_ENCODING")
            cl = headers.get(b"content-length")
            te = headers.get(b"transfer-encoding")
            if cl is not None and (not re.fullmatch(rb"0|[1-9][0-9]{0,7}", cl) or int(cl) > PAYLOAD):
                raise Refused()
            if te is not None and (not self.response or te != b"chunked" or cl is not None):
                raise Refused()
            if self.response:
                message = http1.read_response_head(lines)
                if message.status_code == 101 or 100 <= message.status_code < 200:
                    raise Refused()
                size = expected_http_body_size(self.request, message)
                self.owner.live(self.key)
            else:
                message = http1.read_request_head(lines)
                method = message.method
                if method not in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                    raise Refused()
                body_method = method in ("POST", "PUT", "PATCH", "DELETE")
                if (body_method and cl is None) or (not body_method and cl not in (None, b"0")):
                    raise Refused()
                size = int(cl or 0)
                self.owner.reserve(self.key, self.context, size)
            if message.http_version != "HTTP/1.1":
                raise Refused()
            self.owner.live(self.key).parsers.append(self)
            self.message, self.size = message, size
            self.reader = _http1.make_body_reader(size)
            return message
        except (ValueError, IndexError, ProtocolError):
            self.owner.release(self.key)
            raise Refused() from None
        except BaseException:
            self.owner.release(self.key)
            raise

    def collect(self, io, prefix=b""):
        if self.message is None:
            raise Refused()
        try:
            capacity = self.size if self.size is not None and self.size >= 0 else PAYLOAD
            self.body = self.owner.allocate(self.key, capacity, self.response)
            buf = ReceiveBuffer()
            data = prefix
            while True:
                self.owner.live(self.key, body=not self.response)
                if len(data) + len(buf) > QUEUE:
                    raise Refused("BROWSER_QUEUE_LIMIT")
                buf += data
                while True:
                    event = self.reader(buf)
                    if event is None:
                        break
                    if isinstance(event, Data):
                        n = len(event.data)
                        if n + self.received > capacity:
                            raise Refused("BROWSER_BODY_LIMIT")
                        self.body[self.received:self.received+n] = event.data
                        self.received += n
                    elif isinstance(event, EndOfMessage):
                        if event.headers or buf:
                            raise Refused()
                        return self._complete()
                if isinstance(io, BoundedIO):
                    f = self.owner.live(self.key, body=not self.response)
                    io.deadline = min(io.deadline, f.deadline if self.response else f.body_deadline)
                data = io.read(QUEUE - len(buf))
                if not data:
                    eof = self.reader.read_eof()
                    if not isinstance(eof, EndOfMessage) or buf:
                        raise Refused("BROWSER_SHORT_BODY")
                    return self._complete()
        except BaseException:
            self.owner.release(self.key)
            self.body = self.message = None
            raise

    def _complete(self):
        if self.size is not None and self.size >= 0 and self.received != self.size:
            raise Refused("BROWSER_SHORT_BODY")
        # Unknown-length storage remains fixed; return view, never trim/grow/copy.
        return memoryview(self.body)[:self.received]

    def _drop(self):
        self.body = self.message = self.request = self.head = None
        self.reader = None

    def close(self, success=False):
        self._drop()
        return self.owner.release(self.key, success)


class UnixPolicy:
    """Root-peer authenticated, bounded metadata-only Unix RPC. No body IPC.

    Controller verifies digest/manifest and returns immutable instructions; this
    transport supplies no origin-only allow fallback. SO_PEERCRED is mandatory.
    """
    def __init__(self, path, peer_uid=0):
        if not isinstance(path, str) or not path.startswith("/") or len(path) > 100:
            raise Refused()
        self.path, self.peer_uid = path, peer_uid

    def verify_peer(self, sock):
        _, uid, _ = struct.unpack("3i", sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != self.peer_uid:
            raise Refused("BROWSER_POLICY_PEER")

    def encode(self, payload):
        if not isinstance(payload, dict) or any(k in payload for k in ("body", "content", "raw_content", "password")):
            raise Refused()
        data = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
        if len(data) > HEADER:
            raise Refused("BROWSER_POLICY_LIMIT")
        return struct.pack("!I", len(data)) + data

    def call(self, payload, remaining):
        data = self.encode(payload)
        if remaining <= 0:
            raise Refused("BROWSER_DEADLINE")
        deadline = time.monotonic() + min(remaining, 2)
        with socket.socket(socket.AF_UNIX) as sock:
            def timeout():
                left = deadline - time.monotonic()
                if left <= 0:
                    raise Refused("BROWSER_POLICY_DEADLINE")
                sock.settimeout(left)
            timeout()
            sock.connect(self.path)
            self.verify_peer(sock)
            timeout()
            sock.sendall(data)
            def exact(n):
                target = bytearray(n)
                used = 0
                while used < n:
                    timeout()
                    got = sock.recv_into(memoryview(target)[used:], n-used)
                    if not got:
                        raise Refused("BROWSER_POLICY_LOST")
                    used += got
                return target
            n, = struct.unpack("!I", exact(4))
            if not 0 < n <= HEADER:
                raise Refused("BROWSER_POLICY_LIMIT")
            result = json.loads(exact(n))
            if not isinstance(result, dict) or result.get("ok") is not True:
                raise Refused("BROWSER_POLICY_DENIED")
            return result


class RuntimeAdapter:
    """ABI glue, requires reviewed transport/controller/attestation implementations.

    Stock mitmproxy master never satisfies transport.attested(); do not inject a
    True marker. bind(flow) must derive listener/guard identity from kernel state.
    """
    def __init__(self, owner, policy, transport, verify_deployment, key):
        self.owner, self.policy, self.transport = owner, policy, transport
        self.verify_deployment, self.key = verify_deployment, key
        self.dead = False
        def persist_unknown(key):
            try:
                self.transport.persist_unknown(key)
            except BaseException:
                self.dead = True
                raise
        self.owner.persist_unknown = persist_unknown

    def attested(self):
        return (not self.dead and importlib.metadata.version("mitmproxy") == "12.3.1"
                and self.verify_deployment() is True and self.transport.attested() is True)

    def assert_options(self, options):
        expected = {"connection_strategy": "lazy", "body_size_limit": "25m",
                    "stream_large_bodies": None, "http2": False, "http3": False,
                    "websocket": False, "rawtcp": False, "upstream_cert": False,
                    "ssl_insecure": False, "ignore_hosts": [], "allow_hosts": [],
                    "save_stream_file": None}
        if any(getattr(options, k, object()) != v for k, v in expected.items()):
            raise Refused("BROWSER_RUNTIME_OPTIONS")

    def remaining(self, flow):
        # CONNECT precedes reservation. A new request must never restart its
        # connection's original monotonic deadline (including on keepalive).
        left = self.transport.remaining(flow)
        if type(left) not in (float, int) or not math.isfinite(left) or left <= 0:
            self.owner.release(flow.id)
            raise Refused("BROWSER_DEADLINE")
        if flow.id in self.owner.flows:
            left = min(left, self.owner.live(flow.id).deadline - self.owner.clock())
        return min(60, left)

    async def event(self, name, flow):
        if not self.attested():
            raise Refused("BROWSER_RUNTIME_UNATTESTED")
        # Dedicated transport owns charged parser buffers and immutable request
        # projection. Never use decoded flow.content or trust HTTP binding headers.
        metadata = self.transport.event_metadata(name, flow)
        result = await asyncio.to_thread(self.policy.call, metadata, self.remaining(flow))
        return self.transport.apply_verified(name, flow, result) is True

    async def server_connect(self, data):
        if not self.attested():
            raise Refused("BROWSER_RUNTIME_UNATTESTED")
        return await self.transport.server_connect(data, self.policy)

    async def server_connected(self, data):
        if not self.attested():
            raise Refused("BROWSER_RUNTIME_UNATTESTED")
        return await self.transport.server_connected(data, self.policy)

    def release(self, flow, success=False):
        # A successful addon hook is not a downstream drain acknowledgment.
        if success:
            try:
                drained = self.transport.close_flow(flow.id, True) is True
            except BaseException:
                self.owner.release(flow.id)
                raise
            if not drained:
                # Keep BOTH representations and the response slot until an
                # actual drain ACK, cancellation, or original deadline.
                raise Refused("BROWSER_DRAIN_PENDING")
            return self.owner.release(flow.id, True)
        try:
            self.owner.persist_unknown_once(flow.id)
        finally:
            try:
                self.transport.close_flow(flow.id, False)
            finally:
                outcome = self.owner.release(flow.id)
        return outcome

    def revoke_all(self):
        self.dead = True
        error = None
        for key in tuple(self.owner.flows):
            try:
                self.owner.persist_unknown_once(key)
            except BaseException as exc:
                error = error or exc
        try:
            self.transport.revoke_all()  # persist unknown + close ACK, no reuse
        finally:
            outcomes = self.owner.revoke_all()
        if error is not None:
            raise error
        return outcomes
