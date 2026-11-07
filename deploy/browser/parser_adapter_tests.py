"""Offline tests against REAL pinned classes. No listening sockets or network."""
import socket
import struct
import unittest
from unittest.mock import Mock
from parser_adapter import *

REQ = b"GET / HTTP/1.1\r\nHost: permit.example\r\n\r\n"

def post(extra=b"Content-Length: 0\r\n"):
    return b"POST / HTTP/1.1\r\nHost: permit.example\r\n" + extra + b"\r\n"

class Source:
    def __init__(self, *parts):
        self.parts = list(parts)
    def read(self, limit=QUEUE):
        if not self.parts:
            return b""
        part = self.parts.pop(0)
        if len(part) > limit:
            self.parts.insert(0, part[limit:])
            part = part[:limit]
        return part

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.o = AllocationOwner(lambda: self.now)
        self.p = BoundedParser(self.o, "a")
    def tearDown(self):
        self.o.revoke_all()
        self.assertEqual(self.o.flows, {})
        self.assertEqual(self.o.pools, dict.fromkeys(CAPS, 0))
    def reject(self, header, response=False):
        p = self.p
        if response:
            request = self.p.begin(REQ)
            p = BoundedParser(self.o, "a", response=True, request=request)
        with self.assertRaises(Refused):
            p.begin(header)
    def test_header_limit(self): self.reject(post(b"X: " + b"a" * HEADER + b"\r\n"))
    def test_header_fragment_limit(self):
        self.p.feed_head(b"x" * (HEADER-1))
        with self.assertRaises(Refused): self.p.feed_head(b"xx")
        self.assertEqual(self.p.used, HEADER-1)
    def test_duplicate_length(self): self.reject(post(b"Content-Length: 1\r\nContent-Length: 1\r\n"))
    def test_conflicting_length(self): self.reject(post(b"Content-Length: 1\r\nContent-Length: 2\r\n"))
    def test_expect(self): self.reject(post(b"Content-Length: 1\r\nExpect: 100-continue\r\n"))
    def test_request_compression(self): self.reject(post(b"Content-Length: 1\r\nContent-Encoding: gzip\r\n"))
    def test_response_compression(self): self.reject(b"HTTP/1.1 200 OK\r\nContent-Encoding: br\r\n\r\n", True)
    def test_chunked_upload(self): self.reject(post(b"Transfer-Encoding: chunked\r\n"))
    def test_unknown_upload(self): self.reject(post(b""))
    def test_oversize_length(self): self.reject(post(b"Content-Length: 26214401\r\n"))
    def test_negative_length(self): self.reject(post(b"Content-Length: -1\r\n"))
    def test_comma_length(self): self.reject(post(b"Content-Length: 1, 1\r\n"))
    def test_leading_zero(self): self.reject(post(b"Content-Length: 01\r\n"))
    def test_request_trailer(self): self.reject(post(b"Content-Length: 0\r\nTrailer: x\r\n"))
    def test_response_trailer(self): self.reject(b"HTTP/1.1 200 OK\r\nTrailer: x\r\n\r\n", True)
    def test_response_upgrade(self): self.reject(b"HTTP/1.1 101 Switching Protocols\r\n\r\n", True)
    def test_two_slow_slots(self):
        self.o.reserve("a", 0, 0); self.o.reserve("b", 1, 0)
        self.o.response_complete("a"); self.o.response_complete("b")
        with self.assertRaises(Refused): self.o.reserve("c", 0, 0)
        self.assertEqual(self.o.max_slots, 2)
        self.assertEqual(self.o.pools['response'], 112*MIB)
    def test_one_per_context(self):
        self.o.reserve("a", 0, 0)
        with self.assertRaises(Refused): self.o.reserve("b", 0, 0)
    def test_nonborrowing_request(self):
        self.o.reserve("a", 0, PAYLOAD)
        with self.assertRaises(Refused): self.o.reserve("b", 1, PAYLOAD)
        self.assertEqual(len(self.o.flows), 1)
    def test_queue_limit(self):
        io = BoundedIO(Mock(), 200)
        with self.assertRaises(Refused): io.read(QUEUE+1)
        self.assertFalse(io.sock.recv_into.called)
    def test_short_body(self):
        self.p.begin(post(b"Content-Length: 4\r\n"))
        with self.assertRaises(Exception): self.p.collect(Source(b"ab"))
        self.assertEqual(self.o.flows, {})
        self.assertIsNone(self.p.body)
    def test_oversize_body(self):
        self.p.begin(post(b"Content-Length: 1\r\n"))
        with self.assertRaises(Refused): self.p.collect(Source(b"ab"))
        self.assertEqual(self.o.flows, {})
    def test_chunked_response(self):
        request = self.p.begin(REQ)
        p = BoundedParser(self.o, "a", response=True, request=request)
        p.begin(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
        result = p.collect(Source(b"2\r\nhi\r\n", b"0\r\n\r\n"))
        self.assertEqual(bytes(result), b"hi")
        self.assertIsInstance(p.reader, _http1.ChunkedReader)
        p.close()
    def test_deadline(self):
        self.p.begin(post(b"Content-Length: 1\r\n")); self.now = 115
        with self.assertRaises(Refused): self.p.collect(Source(b"a"))
        self.assertEqual(self.o.flows, {})
    def test_terminal_cleanup(self):
        for consumed in (False, True):
            self.o.reserve("a", 0, 2)
            b = self.o.allocate("a", 2); b[:] = b"hi"
            if consumed: self.o.consume("a")
            self.assertEqual(self.o.release("a"), "unknown" if consumed else "failed")
            self.assertEqual(b, b"\0\0")
            self.assertEqual(self.o.flows, {})
    def test_unix_oversize(self):
        p = UnixPolicy('/tmp/test-policy')
        with self.assertRaises(Refused): p.encode({'headers': 'a'*HEADER})
        with self.assertRaises(Refused): p.encode({'body': 'private'})
    def test_unix_peer(self):
        p = UnixPolicy('/tmp/test-policy')
        sock = Mock(); sock.getsockopt.return_value = struct.pack('3i', 123, 1000, 1000)
        with self.assertRaises(Refused): p.verify_peer(sock)
    def test_stock_unattested(self):
        t = Mock(); t.attested.return_value = False
        r = RuntimeAdapter(self.o, None, t, lambda: True, b'x'*32)
        self.assertFalse(r.attested())
    def test_immutable_copy(self):
        self.p.begin(post(b"Content-Length: 2\r\n"))
        self.p.collect(Source(b"hi")); frozen = self.o.freeze('a', self.p.body)
        self.p.body[:] = b"no"
        self.assertEqual(frozen, b"hi")
        with self.assertRaises(Refused): self.o.freeze('a', self.p.body)
    def test_revoke_cleanup(self):
        self.p.begin(post(b"Content-Length: 2\r\n"))
        self.p.collect(Source(b"hi")); self.o.revoke_all()
        self.assertIsNone(self.p.body)
        self.assertIsNone(self.p.message)
    def test_header_failure_cleanup(self):
        request = self.p.begin(REQ)
        p = BoundedParser(self.o, "a", response=True, request=request)
        with self.assertRaises(Refused): p.feed_head(b"x"*(HEADER+1))
        self.assertEqual(self.o.flows, {})
    def test_fatal_transport_cleanup(self):
        self.o.reserve("a", 0, 0)
        t=Mock();t.revoke_all.side_effect=RuntimeError("fixture")
        r=RuntimeAdapter(self.o,None,t,lambda:False,b"x"*32)
        with self.assertRaises(RuntimeError):r.revoke_all()
        self.assertEqual(self.o.flows,{})
    def test_response_drain(self):
        self.o.reserve('a', 0, 0)
        with self.assertRaises(Refused): self.o.drained('a')
        self.o.response_complete('a')
        self.assertEqual(len(self.o.flows), 1)
        self.assertEqual(self.o.drained('a'), 'succeeded')

    # Integration regressions FIRST; all flows/connections are real mitmproxy
    # data classes, with no socket listener or browser launch.
    def runtime(self, left=1):
        from mitmproxy.test import tflow
        flow = tflow.tflow()
        t = Mock(); t.remaining.return_value = left
        r = RuntimeAdapter(self.o, Mock(), t, lambda: True, b'x'*32)
        return r, t, flow
    def test_connect_deadline_not_refreshed_by_request(self):
        r,t,f = self.runtime(0.25)
        self.o.reserve(f.id,0,0)
        self.assertEqual(r.remaining(f),0.25)
    def test_expired_connect_refused_after_reservation(self):
        r,t,f = self.runtime(-1)
        self.o.reserve(f.id,0,0)
        with self.assertRaises(Refused): r.remaining(f)
    def test_nonfinite_connect_refused(self):
        for left in (float('nan'),float('inf'),None,True):
            r,t,f=self.runtime(left)
            with self.assertRaises(Refused): r.remaining(f)
    def test_original_deadline_bounds_owner(self):
        r,t,f=self.runtime(500)
        self.o.reserve(f.id,0,0); self.now+=59
        self.assertEqual(r.remaining(f),1)
    def test_expiry_persists_unknown_before_release(self):
        r,t,f=self.runtime()
        self.o.reserve(f.id,0,0);self.o.consume(f.id); self.now+=60
        t.persist_unknown.side_effect=lambda key:self.assertIn(key,self.o.flows)
        with self.assertRaises(Refused):r.remaining(f)
        t.persist_unknown.assert_called_once_with(f.id)
    def test_parser_error_persists_consumed_unknown(self):
        r,t,f=self.runtime()
        self.o.reserve(f.id,0,0); self.o.consume(f.id)
        self.o.release(f.id)
        t.persist_unknown.assert_called_once_with(f.id)
    def test_success_requires_transport_drain_ack(self):
        r,t,f=self.runtime()
        self.o.reserve(f.id,0,0); self.o.consume(f.id)
        t.close_flow.return_value=False
        with self.assertRaises(Refused):r.release(f,True)
        self.assertIn(f.id,self.o.flows)
        t.persist_unknown.assert_not_called()
        r.release(f,False)
        t.persist_unknown.assert_called_once_with(f.id)
        self.assertEqual(self.o.flows,{})
    def test_unknown_persistence_failure_cleans_and_revokes(self):
        r,t,f=self.runtime()
        self.o.reserve(f.id,0,0); self.o.consume(f.id)
        t.persist_unknown.side_effect=RuntimeError('fixture')
        with self.assertRaises(RuntimeError):r.release(f)
        self.assertTrue(r.dead)
        self.assertEqual(self.o.flows,{})

# _http1 is not included by wildcard imports.
from parser_adapter import _http1
if __name__ == '__main__': unittest.main()
