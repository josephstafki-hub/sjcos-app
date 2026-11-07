"""Expectations first: real 12.3.1 connection/TLS classes, process-local sockets.
No DB, browser, daemon, external network, namespace or root privileges.
"""
import asyncio
import hashlib
from ipaddress import ip_address
import json
import socket
import unittest
from unittest.mock import Mock, patch
from mitmproxy.proxy.server import ConnectionHandler
from mitmproxy.proxy.layers.tls import ClientTLSLayer, ServerTLSLayer
from parser_adapter import AllocationOwner, BoundedParser, Refused, QUEUE, HEADER, TRANSPORT_CHARGE
from transport_runtime import TransportRuntime, TransportHandler, canonical_digest
from transport_tls import BoundedClientTLS, BoundedServerTLS, TLSChannel
from transport_dns import FreshResolver, public_address

BINDING = dict(generation=1, guardId='guard1', contextId='context1', taskId='task1', bootId='boot1', targetId='target1')

class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = 100.0
        self.policy = Mock()
        def call(meta, remaining):
            return dict(ok=True, event=meta['event'], id=meta['id'], generation=meta['generation'], listenerCookie=meta['listenerCookie'], guardId=meta['guardId'], durable=True)
        self.policy.call.side_effect = call
        self.runtime = TransportRuntime(self.policy, Mock(), lambda: True, b'k'*32, clock=lambda:self.now)
        self.sockets = []
    def listener(self, **changes):
        s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(2); self.sockets.append(s)
        b={**BINDING, **changes}; cookie=self.runtime.bind_listener(s,b)
        return s,cookie
    async def connection(self, receive_size=None, **changes):
        s,cookie=self.listener(**changes)
        c=socket.socket(); c.setblocking(False); self.sockets.append(c)
        if receive_size:c.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,receive_size)
        await asyncio.get_running_loop().sock_connect(c,s.getsockname())
        a,_=s.accept(); self.sockets.append(a)
        return self.runtime.adopt(a,cookie),c,cookie
    async def asyncTearDown(self):
        self.runtime.revoke_all()
        for s in self.sockets:s.close()
        self.assertEqual(self.runtime.owner.flows,{})
        self.assertTrue(all(v==0 for v in self.runtime.owner.pools.values()))
        self.assertEqual(self.runtime.handlers,{})
    async def test_real_connection_handler(self):
        h,_,_=await self.connection(); self.assertIsInstance(h,ConnectionHandler)
    async def test_real_tls_layer_classes(self):
        self.assertTrue(issubclass(BoundedClientTLS,ClientTLSLayer));self.assertTrue(issubclass(BoundedServerTLS,ServerTLSLayer))
    async def test_listener_identity_kernel_cookie(self):
        s,c=self.listener();self.assertEqual(c,str(int.from_bytes(s.getsockopt(socket.SOL_SOCKET,57,8),'little')))
    async def test_socket_wrong_listener_refused(self):
        _,c=self.listener();a,b=socket.socketpair();self.sockets.extend([a,b])
        with self.assertRaises(Refused):self.runtime.adopt(a,c)
    async def test_generation_reuse_refused(self):
        self.listener();
        with self.assertRaises(Refused):self.listener()
    async def test_revoke_closes_listener_before_rebind(self):
        s,c=self.listener();self.runtime.revoke_listener(c);self.assertEqual(s.fileno(),-1)
        self.listener(generation=2)
    async def test_old_generation_decision_refused(self):
        h,_,c=await self.connection();f=h.flow;meta=self.runtime.event_metadata('http_connect',f)
        self.runtime.revoke_listener(c)
        with self.assertRaises(Refused):self.runtime.apply_verified('http_connect',f,self.policy.call(meta,1))
    async def test_original_deadline(self):
        h,_,_=await self.connection();self.now+=59
        self.assertEqual(self.runtime.remaining(h.flow),1)
        self.now+=1
        with self.assertRaises(Refused):self.runtime.remaining(h.flow)
    async def test_no_third_connection_slot(self):
        h,_,_=await self.connection();self.listener(contextId='context2',guardId='guard2')
        with self.assertRaises(Refused):self.listener(contextId='context3',guardId='guard3')
    async def test_preallocation_expect_refused(self):await self.bad_request(b'Expect: 100-continue\r\nContent-Length: 1\r\n')
    async def test_preallocation_duplicate_length(self):await self.bad_request(b'Content-Length: 1\r\nContent-Length: 1\r\n')
    async def test_preallocation_compression(self):await self.bad_request(b'Content-Length: 1\r\nContent-Encoding: gzip\r\n')
    async def test_preallocation_chunked_upload(self):await self.bad_request(b'Transfer-Encoding: chunked\r\n')
    async def test_preallocation_header_flood(self):await self.bad_request(b'X: '+b'x'*HEADER+b'\r\n')
    async def test_preallocation_oversize_body(self):await self.bad_request(b'Content-Length: 26214401\r\n')
    async def test_tls_handshake_limit(self):
        h,_,_=await self.connection();layer=BoundedClientTLS(h.context)
        with self.assertRaises(Refused):list(layer.receive_handshake_data(b'x'*(QUEUE+1)))
        self.assertEqual(len(layer.recv_buffer),0)
    async def test_directional_queue_limit(self):
        h,_,_=await self.connection()
        with self.assertRaises(Refused):await h.client_io.write(b'x'*(QUEUE+1))
        self.assertEqual(h.client_io.bytes_written,0)
    async def test_client_abort_cleanup(self):await self.terminal('abort')
    async def test_upstream_reset_cleanup(self):await self.terminal('reset')
    async def test_tls_failure_cleanup(self):await self.terminal('tls')
    async def test_timeout_cleanup(self):await self.terminal('timeout')
    async def test_revoke_consumed_unknown_once(self):
        h,_,_=await self.connection();self.runtime.owner.reserve(h.flow.id,0,0);self.runtime.owner.consume(h.flow.id);h.unknown_token='receipt'
        self.runtime.revoke_all();self.runtime.revoke_all()
        self.assertEqual(sum(c.args[0]['event']=='persist_unknown' for c in self.policy.call.call_args_list),1)
    async def test_dns_private_metadata_loopback_refused(self):
        for addr in ['127.0.0.1','169.254.169.254','10.0.0.1','::1','::ffff:8.8.8.8','64:ff9b::808:808','168.63.129.16']:
            self.assertFalse(public_address(addr),addr)
    async def test_host_sni_mismatch(self):
        h,_,_=await self.connection();h.hostname='permit.example';h.client.sni='other.example'
        with self.assertRaises(Refused):h.validate_host('permit.example')
    async def test_digest_canonical_and_body_bound(self):
        a=canonical_digest('POST','https://permit.example/',[['host','permit.example']],hashlib.sha256(b'a').hexdigest())
        b=canonical_digest('POST','https://permit.example/',[['host','permit.example']],hashlib.sha256(b'b').hexdigest())
        self.assertNotEqual(a,b)
    async def certs(self):
        import datetime,tempfile
        from pathlib import Path
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes,serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        if hasattr(self,'cert_file'):return
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'permit.example')])
        now=datetime.datetime.now(datetime.timezone.utc)
        cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('permit.example')]),False).add_extension(x509.BasicConstraints(ca=True,path_length=None),True).sign(key,hashes.SHA256()))
        self.cert_file=str(Path(self.temp.name)/'cert.pem');self.key_file=str(Path(self.temp.name)/'key.pem')
        Path(self.cert_file).write_bytes(cert.public_bytes(serialization.Encoding.PEM));Path(self.key_file).write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        from transport_tls import TLSConfiguration
        from OpenSSL import SSL
        def leaf(host):
            ctx=SSL.Context(SSL.TLS_SERVER_METHOD);ctx.use_certificate_file(self.cert_file);ctx.use_privatekey_file(self.key_file)
            ctx.set_alpn_select_callback(lambda conn,offers:b'http/1.1');return ctx
        self.runtime.tls_config=TLSConfiguration(leaf,self.cert_file)
    async def tls_client(self,h,c,payload):
        import ssl
        def client():
            ctx=ssl.create_default_context(cafile=self.cert_file);ctx.set_alpn_protocols(['http/1.1'])
            c.settimeout(5)
            with ctx.wrap_socket(c,server_hostname='permit.example') as tls:
                tls.sendall(payload)
                return tls.recv(65536)
        return asyncio.create_task(asyncio.to_thread(client))
    async def test_real_client_tls_and_bounded_request(self):
        await self.certs();h,c,_=await self.connection();h.hostname='permit.example'
        self.runtime.resolver=Mock();self.runtime.resolver.resolve.return_value=dict(hostname='permit.example',chain=['permit.example'],addresses=['93.184.216.34'],ttlMs=1000)
        channel=TLSChannel(h.client_io,h.context,True,self.runtime.tls_config,h.hostname,h.deadline);h.client_tls=channel
        task=await self.tls_client(h,c,b'POST / HTTP/1.1\r\nHost: permit.example\r\nContent-Length: 2\r\n\r\nhi')
        await channel.handshake();await h.read_message(channel,False)
        self.assertEqual(h.flow.request.raw_content,b'hi');self.assertLessEqual(channel.max_queue,16384)
        await channel.write(b'ok');self.assertEqual(await task,b'ok')
    async def test_real_server_tls_trust_and_hostname(self):
        await self.server_tls_case('permit.example',True)
    async def test_real_server_tls_wrong_hostname_refused(self):
        await self.server_tls_case('wrong.example',False)
    async def server_tls_case(self,host,allowed):
        import ssl
        from transport_runtime import AsyncSocket
        await self.certs();h,c,_=await self.connection()
        def upstream():
            ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(self.cert_file,self.key_file)
            h.client_io.sock.settimeout(5)
            try:
                with ctx.wrap_socket(h.client_io.sock,server_side=True) as tls:
                    data=tls.recv(65536);tls.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi');return data
            except ssl.SSLError:return None
        task=asyncio.create_task(asyncio.to_thread(upstream))
        h.context.server.state=__import__('mitmproxy.connection',fromlist=['ConnectionState']).ConnectionState.OPEN
        h.context.server.sni=host
        io=AsyncSocket(c,h.io_remaining);channel=TLSChannel(io,h.context,False,self.runtime.tls_config,host,h.deadline);h.server_tls=channel
        if allowed:
            await channel.handshake();await channel.write(b'GET / HTTP/1.1\r\nHost: permit.example\r\n\r\n')
            self.assertIn(b'200 OK',await channel.read());self.assertIn(b'GET /',await task)
        else:
            with self.assertRaises(Refused):await channel.handshake()
            channel.close();await task
    async def test_transport_reserved_before_tls(self):
        h,_,_=await self.connection();self.assertEqual(self.runtime.owner.pools['transport'],TRANSPORT_CHARGE)
        self.assertIn(h.flow.id,self.runtime.owner.transport_reservations)
    async def test_two_real_slow_response_slots_until_drain(self):
        a,_,_=await self.connection();b,_,_=await self.connection(contextId='context2',guardId='guard2')
        for i,h in enumerate((a,b)):
            self.runtime.owner.reserve(h.flow.id,i,0);self.runtime.owner.response_complete(h.flow.id)
            self.assertFalse(self.runtime.close_flow(h.flow.id,True))
        self.assertEqual(self.runtime.owner.max_slots,2);self.assertEqual(len(self.runtime.owner.flows),2)
        for h in (a,b):
            h.drained=True;self.runtime.finish(h,True)
        self.assertEqual(self.runtime.owner.pools['response'],0)
    async def test_policy_wrong_cookie_refused(self):
        h,_,_=await self.connection();meta=self.runtime.event_metadata('http_connect',h.flow);r=self.policy.call(meta,1);r['listenerCookie']='0'
        with self.assertRaises(Refused):self.runtime.apply_verified('http_connect',h.flow,r)
    async def test_unknown_durability_failure_revokes_every_socket(self):
        h,c,l=await self.connection();self.runtime.owner.reserve(h.flow.id,0,0);self.runtime.owner.consume(h.flow.id);h.unknown_token='r'
        self.policy.call.return_value=None;self.policy.call.side_effect=RuntimeError('fixture')
        with self.assertRaises(RuntimeError):self.runtime.revoke_all()
        self.assertEqual(h.client_io.sock.fileno(),-1);self.assertEqual(self.runtime.handlers,{})
        self.assertEqual(self.runtime.owner.transport_reservations,{})
    async def test_fresh_dns_rebinding_per_socket(self):
        from mitmproxy.proxy.server_hooks import ServerConnectionHookData
        h,_,_=await self.connection();h.hostname='permit.example';h.decision=dict(pin=dict(address='93.184.216.34'));h.decision_deadline=102
        self.runtime.resolver=Mock();self.runtime.resolver.resolve.return_value=dict(hostname=h.hostname,chain=[h.hostname],addresses=['127.0.0.1'],ttlMs=1000)
        with self.assertRaises(Refused):await self.runtime.server_connect(ServerConnectionHookData(client=h.client,server=h.context.server),self.policy)
        self.runtime.resolver.resolve.assert_called_once()
    async def test_peer_mismatch_refused(self):
        from mitmproxy.proxy.server_hooks import ServerConnectionHookData
        h,_,_=await self.connection();h.hostname='permit.example';h.decision=dict(pin=dict(address='93.184.216.34'));h.decision_deadline=102
        h.context.server.peername=('127.0.0.1',443);h.context.server.sni=h.hostname
        with self.assertRaises(Refused):await self.runtime.server_connected(ServerConnectionHookData(client=h.client,server=h.context.server),self.policy)
    async def test_fetch_digest_single_use(self):
        _,c=self.listener();self.runtime.register_guard(c,'guard1','target1');self.runtime.register_fetch(c,'a'*64)
        with self.assertRaises(Refused):self.runtime.register_fetch(c,'a'*64)
    async def test_config_cannot_self_attest(self):
        from transport_control import load_config
        import tempfile,os
        f=tempfile.NamedTemporaryFile(delete=False)
        try:
            f.write(b'{"attested":true}');f.close()
            with self.assertRaises(Refused):load_config(f.name)
        finally:os.unlink(f.name)
    async def test_actual_connect_hook_tls_consume_failure_cleanup(self):
        import ssl
        await self.certs();h,c,ck=await self.connection();self.runtime.register_guard(ck,'guard1','target1')
        self.runtime.resolver=Mock();self.runtime.resolver.resolve.return_value=dict(hostname='permit.example',chain=['permit.example'],addresses=['93.184.216.34'],ttlMs=2000)
        base=self.policy.call.side_effect
        def policy(meta,remaining):
            r=base(meta,remaining)
            if meta['event']=='request':
                self.runtime.register_fetch(ck,meta['requestDigest'])
                r.update(allow=True,requestDigest=meta['requestDigest'],decisionId='d1',expiresInMs=2000,pin=dict(hostname='permit.example',address='93.184.216.34'),kind='write',consumed=True,unknownToken='receipt1')
            return r
        self.policy.call.side_effect=policy
        self.runtime.case='failure';self.runtime.fault=dict(point='after_consume',action='raise')
        def browser():
            c.settimeout(5);c.sendall(b'CONNECT permit.example:443 HTTP/1.1\r\nHost: permit.example:443\r\n\r\n')
            response=b''
            while b'\r\n\r\n' not in response:response+=c.recv(1024)
            self.assertIn(b'200 Connection Established',response)
            ctx=ssl.create_default_context(cafile=self.cert_file);ctx.set_alpn_protocols(['http/1.1'])
            with ctx.wrap_socket(c,server_hostname='permit.example') as tls:
                tls.sendall(b'POST / HTTP/1.1\r\nHost: permit.example\r\nContent-Length: 2\r\n\r\nhi')
                self.assertEqual(tls.recv(1024),b'')
        task=asyncio.create_task(asyncio.to_thread(browser));await h.run();await task
        names=[c.args[0]['event'] for c in self.policy.call.call_args_list]
        self.assertEqual(names,['http_connect','requestheaders','request','persist_unknown','close_flow'])
        self.assertEqual(self.runtime.handlers,{});self.assertEqual(self.runtime.owner.flows,{})
        self.assertEqual(h.upstream_plaintext_bytes,0)
    async def test_same_context_multiple_target_guards(self):
        _,c=self.listener();self.runtime.register_guard(c,'guard1','target1');self.runtime.register_guard(c,'guard2','target2')
        self.runtime.register_fetch(c,'a'*64,'guard2','target2')
        self.assertEqual(self.runtime.fetches[c]['targetId'],'target2')
        self.assertEqual(len(self.runtime.listeners),1)
    async def test_metadata_never_contains_body(self):
        h,_,_=await self.connection();meta=self.runtime.event_metadata('http_connect',h.flow)
        self.assertTrue({'body','content','raw_content'}.isdisjoint(meta))
    async def test_fault_control_events_are_actual_and_bounded(self):
        from transport_control import ControlServer
        control=ControlServer(self.runtime,'127.0.0.1',[])
        await control.dispatch(dict(op='case_begin',name='real-closure'))
        h,_,_=await self.connection()
        await control.dispatch(dict(op='fault_arm',point='before_connect',action='close_client'))
        with self.assertRaises(Refused):self.runtime.fault_point('before_connect',h)
        self.assertEqual(h.client_io.sock.fileno(),-1)
        result=await control.dispatch(dict(op='events'))
        self.assertIn('fault',[e['event'] for e in result['events']])
        for _ in range(600):self.runtime.observe('counter')
        self.assertEqual(len(self.runtime.event_log),512);self.assertGreater(self.runtime.dropped_events,0)
    async def test_dns_cname_a_aaaa_each_link(self):
        from mitmproxy.dns import ResourceRecord as RR
        resolver=FreshResolver(clock=lambda:self.now);calls=[]
        def query(name,kind,deadline):
            calls.append((name,kind))
            if name=='permit.example':return [RR.CNAME(name,'final.example')]
            return [RR.A(name,ip_address('93.184.216.34'))] if kind==1 else []
        with patch.object(resolver,'query',query):result=resolver.resolve('permit.example',101)
        self.assertEqual(result['chain'],['permit.example','final.example'])
        self.assertEqual(calls,[(n,t) for n in ('permit.example','final.example') for t in (5,1,28)])
    async def test_dns_private_in_mixed_answer_refused(self):
        from mitmproxy.dns import ResourceRecord as RR
        resolver=FreshResolver(clock=lambda:self.now)
        with patch.object(resolver,'query',return_value=[RR.A('permit.example',ip_address('93.184.216.34')),RR.A('permit.example',ip_address('127.0.0.1'))]):
            with self.assertRaises(Refused):resolver.resolve('permit.example',101)
    async def test_dns_cname_loop_refused(self):
        from mitmproxy.dns import ResourceRecord as RR
        resolver=FreshResolver(clock=lambda:self.now)
        with patch.object(resolver,'query',return_value=[RR.CNAME('permit.example','permit.example')]):
            with self.assertRaises(Refused):resolver.resolve('permit.example',101)
    async def test_dns_wire_through_real_loopback_socket(self):
        await self.dns_wire_case(False)
    async def test_dns_private_additional_wire_refused(self):
        await self.dns_wire_case(True)
    async def dns_wire_case(self,private_additional):
        from mitmproxy import dns
        import struct,dataclasses
        resolver=FreshResolver();listener=socket.socket();self.sockets.append(listener)
        listener.bind(('127.0.0.1',0));listener.listen(1)
        def unbound_fixture():
            conn,_=listener.accept()
            with conn:
                conn.settimeout(5)
                def exact(n):
                    b=b''
                    while len(b)<n:b+=conn.recv(n-len(b))
                    return b
                n,=struct.unpack('!H',exact(2));query=dns.DNSMessage.unpack(exact(n))
                query.query=False;query.recursion_available=True;query.answers=[dns.ResourceRecord.A('permit.example',ip_address('93.184.216.34'))]
                if private_additional:query.additionals=[dns.ResourceRecord.A('other.example',ip_address('127.0.0.1'))]
                raw=query.packed;conn.sendall(struct.pack('!H',len(raw))+raw)
        task=asyncio.create_task(asyncio.to_thread(unbound_fixture))
        import time
        with patch('transport_dns.PINNED_UNBOUND',listener.getsockname()):
            if private_additional:
                with self.assertRaises(Refused):await asyncio.to_thread(resolver.query,'permit.example',1,time.monotonic()+5)
            else:
                answer=await asyncio.to_thread(resolver.query,'permit.example',1,time.monotonic()+5)
                self.assertEqual(str(answer[0].ipv4_address),'93.184.216.34')
        await task
    async def test_actual_blocked_socket_holds_response_slot(self):
        h,c,_=await self.connection();self.runtime.owner.reserve(h.flow.id,0,0);self.runtime.owner.response_complete(h.flow.id)
        h.client_io.sock.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
        c.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024)
        block=b'x'*16384
        # Fill kernel buffers using nonblocking sends; never allocate a queue.
        while True:
            try:h.client_io.sock.send(block)
            except BlockingIOError:break
        task=asyncio.create_task(h.client_io.write(b'x'*QUEUE))
        await asyncio.sleep(0.01)
        self.assertFalse(task.done());self.assertFalse(self.runtime.close_flow(h.flow.id,True));self.assertIn(h.flow.id,self.runtime.owner.flows)
        task.cancel();await asyncio.gather(task,return_exceptions=True);self.runtime.finish(h)
    async def test_tls_post_handshake_control_flood_prechecked(self):
        h,_,_=await self.connection();layer=BoundedClientTLS(h.context);layer.no_plaintext_in=QUEUE
        layer.tls=Mock()
        with self.assertRaises(Refused):list(layer.receive_data(b'x'))
        layer.tls.bio_write.assert_not_called()
    async def test_runtime_proof_does_not_refresh_rpc_deadline(self):
        from mitmproxy import http
        h,_,c=await self.connection();self.runtime.register_guard(c,'guard1','target1')
        h.hostname='permit.example';h.client.sni=h.hostname;h.flow.request=http.Request.make('GET','https://permit.example/')
        h.flow.request.headers['host']=h.hostname;h.flow.request.raw_content=b''
        h.url='https://permit.example/';h.request_headers=[['host',h.hostname]];h.dns=dict(addresses=['93.184.216.34']);h.body_sha=hashlib.sha256(b'').hexdigest();h.request_digest='a'*64
        self.runtime.owner.reserve(h.flow.id,0,0);self.runtime.register_fetch(c,h.request_digest)
        meta=self.runtime.event_metadata('request',h.flow);result=self.policy.call(meta,2)
        result.update(allow=True,requestDigest=h.request_digest,decisionId='d',expiresInMs=2000,pin=dict(hostname=h.hostname,address='93.184.216.34'),kind='read')
        self.now+=2.1
        with self.assertRaises(Refused):self.runtime.apply_verified('request',h.flow,result)
        self.assertIsNone(h.decision)
    async def test_external_revoke_retains_charge_until_send_unwinds(self):
        h,c,ck=await self.connection();self.runtime.owner.reserve(h.flow.id,0,1)
        body=self.runtime.owner.allocate(h.flow.id,1);body[:]=b'x';self.runtime.owner.freeze(h.flow.id,body)
        started=asyncio.Event();released=asyncio.Event()
        async def sender():
            try:
                started.set();await asyncio.Event().wait()
            finally:
                released.set();self.runtime.finish(h)
        task=asyncio.create_task(sender());h.task=task;await started.wait()
        self.runtime.revoke_all()
        self.assertIn(h.flow.id,self.runtime.owner.flows)
        self.assertFalse(released.is_set())
        self.assertTrue(await self.runtime.settled())
        self.assertTrue(released.is_set());self.assertTrue(task.cancelled())
        self.assertEqual(self.runtime.owner.pools['request'],0);self.assertEqual(body,b'\0')
    # RSS lifecycle expectations: real ConnectionHandler, HTTPFlow, HTTP hooks,
    # h11 parsers and TLS layers. Only DNS/policy authority and the dial address
    # are fixtures; every byte travels over loopback sockets.
    async def rss_fixture(self, policy=None, responder=None, write=False):
        import ssl
        import time
        await self.certs()
        self.runtime.clock=time.monotonic;self.runtime.owner.clock=time.monotonic
        self.runtime.resolver=Mock()
        self.runtime.resolver.resolve.return_value=dict(hostname='permit.example',chain=['permit.example'],addresses=['93.184.216.34'],ttlMs=10000)
        base=self.policy.call.side_effect
        def authorize(meta,remaining):
            result=base(meta,remaining)
            if meta['event']=='request':
                if policy:policy(meta,remaining)
                result.update(allow=True,requestDigest=meta['requestDigest'],decisionId=meta['id'],expiresInMs=2000,pin=dict(hostname='permit.example',address='93.184.216.34'),kind='write' if write else 'read')
                if write:result.update(consumed=True,unknownToken='receipt-'+meta['id'])
            return result
        self.policy.call.side_effect=authorize
        real_apply=self.runtime.apply_verified
        def apply(event,flow,result):
            if event=='request':self.runtime.register_fetch(self.runtime.handler(flow).listener.cookie,result['requestDigest'])
            return real_apply(event,flow,result)
        self.runtime.apply_verified=apply
        origin_context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        origin_context.load_cert_chain(self.cert_file,self.key_file)
        origin_tasks=set()
        self.rss_origins=[]
        async def origin(reader,writer):
            task=asyncio.current_task();origin_tasks.add(task)
            try:
                await writer.start_tls(origin_context)
                head=await reader.readuntil(b'\r\n\r\n')
                fields=dict((k.lower(),v) for k,v in (line.split(b': ',1) for line in head.split(b'\r\n')[1:] if b': ' in line))
                left=int(fields.get(b'content-length',b'0'));digest=hashlib.sha256();size=left
                while left:
                    part=await reader.readexactly(min(left,16384));digest.update(part);left-=len(part)
                request=dict(head=head,bodyBytes=size,bodySha256=digest.hexdigest())
                self.rss_origins.append(request)
                if responder:
                    await responder(request,writer);return
                writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 2097152\r\n\r\n')
                for _ in range(128):
                    if writer.is_closing():break
                    writer.write(b'x'*16384);await writer.drain()
                    await asyncio.sleep(0) # deliver an abort before the next fixture chunk
            except (OSError,asyncio.IncompleteReadError):pass
            finally:
                writer.close()
                try:await writer.wait_closed()
                except OSError:pass
                origin_tasks.discard(task)
        server=await asyncio.start_server(origin,'127.0.0.1',0)
        async def stop_origin():
            server.close();await server.wait_closed()
            for task in tuple(origin_tasks):task.cancel()
            await asyncio.gather(*origin_tasks,return_exceptions=True)
        self.addAsyncCleanup(stop_origin)
        real_connect=self.runtime.server_connect
        async def loopback_connect(data,policy):
            await real_connect(data,policy)
            data.server.address=server.sockets[0].getsockname()
        self.runtime.server_connect=loopback_connect
        # Production peer comparison requires a public :443 address; loopback
        # fixtures deliberately replace only this check, never the TLS parser.
        async def connected(data,policy):return True
        self.runtime.server_connected=connected
        ctx=ssl.create_default_context(cafile=self.cert_file);ctx.set_alpn_protocols(['http/1.1'])
        return ctx

    async def rss_client(self,c,ctx,path='/rss'):
        loop=asyncio.get_running_loop()
        await loop.sock_sendall(c,b'CONNECT permit.example:443 HTTP/1.1\r\nHost: permit.example:443\r\n\r\n')
        head=b''
        while not head.endswith(b'\r\n\r\n'):
            part=await loop.sock_recv(c,1)
            if not part:raise ConnectionError('CONNECT refused')
            head+=part
        self.assertIn(b'200 Connection Established',head)
        reader,writer=await asyncio.open_connection(sock=c,ssl=ctx,server_hostname='permit.example',limit=16384)
        writer.write(('GET '+path+' HTTP/1.1\r\nHost: permit.example\r\nAccept-Encoding: identity\r\n\r\n').encode())
        await writer.drain()
        self.addCleanup(writer.close)
        self.addCleanup(writer.transport.abort)
        return reader,writer

    async def wait_state(self,predicate,timeout=2.5):
        async def wait():
            while not predicate():await asyncio.sleep(0.005)
        await asyncio.wait_for(wait(),timeout)

    def assert_finalized(self,ids):
        for key in ids:
            self.assertEqual(sum(e['event']=='flow_closed' and e.get('id')==key for e in self.runtime.event_log),1,key)
            self.assertNotIn(key,self.runtime.handlers)
            self.assertNotIn(key,self.runtime.owner.flows)
            self.assertNotIn(key,self.runtime.owner.transport_reservations)

    async def test_rss_two_slow_readers_six_aborted_candidates(self):
        import threading
        parking=[]
        def parked(meta,remaining):
            if parking:
                entered,release=parking[0]
                entered.set();release.wait(4)
        ctx=await self.rss_fixture(parked)
        a,ca,cka=await self.connection();b,cb,ckb=await self.connection(contextId='context2',guardId='guard2',targetId='target2')
        for h in (a,b):self.runtime.register_guard(h.listener.cookie,h.binding['guardId'],h.binding['targetId'])
        runs=[asyncio.create_task(h.run()) for h in (a,b)]
        self.addAsyncCleanup(self.cancel_runs,runs)
        clients=[await self.rss_client(c,ctx) for c in (ca,cb)]
        await self.wait_state(lambda:all(h.client_io.pending_write for h in (a,b)))
        self.assertEqual(len(self.runtime.owner.flows),2)
        self.assertEqual(self.runtime.owner.pools['response'],112*1048576)
        # There is no body/admission queue: while both contexts are charged,
        # accepted candidates must be refused before allocating a third flow.
        listeners=[asyncio.create_task(self.runtime.serve_listener(ck)) for ck in (cka,ckb)]
        self.addAsyncCleanup(self.cancel_runs,listeners)
        for i in range(6):
            c=socket.socket();c.setblocking(False);self.sockets.append(c)
            await asyncio.get_running_loop().sock_connect(c,self.runtime.listeners[(cka,ckb)[i%2]].address)
            await asyncio.get_running_loop().sock_sendall(c,b'CONNECT permit.example:443 HTTP/1.1\r\nHost: permit.example:443\r\n\r\n')
            c.close()
        await self.wait_state(lambda:sum(e['event']=='admission_refused' for e in self.runtime.event_log)==6)
        self.assertEqual(set(self.runtime.handlers),{a.flow.id,b.flow.id})
        self.assertEqual(len(self.runtime.owner.transport_reservations),2)
        for reader,_ in clients:
            received=0
            while data:=await asyncio.wait_for(reader.read(65536),3):received+=len(data)
            self.assertGreater(received,2097152)
        await asyncio.wait_for(asyncio.gather(*runs),3)
        self.assert_finalized([a.flow.id,b.flow.id])
        self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))
        # Once admitted, each candidate aborts while the real request hook is
        # parked in policy. It must finalize promptly without a late grant.
        for i in range(6):
            ck=(cka,ckb)[i%2];l=self.runtime.listeners[ck]
            c=socket.socket();c.setblocking(False);self.sockets.append(c)
            entered=threading.Event();release=threading.Event();parking[:]=[(entered,release)]
            try:
                await asyncio.get_running_loop().sock_connect(c,l.address)
                reader,writer=await self.rss_client(c,ctx,'/abort')
                await self.wait_state(entered.is_set)
                h=next(h for h in self.runtime.handlers.values() if h.listener is l);key=h.flow.id
                writer.transport.abort()
                await self.wait_state(lambda:key not in self.runtime.handlers,timeout=0.75)
                self.assert_finalized([key])
                self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))
                self.assertFalse(self.runtime.dead)
            finally:release.set()
            await asyncio.sleep(0.01) # let the bounded fixture RPC thread return

    # Expectations written before the fixes: two 25MiB raw TLS responses stay
    # charged throughout a 2s no-read window AND a final 16KiB TCP tail pause.
    # All 15 RSS case names below run independently, not a loop hiding failures.
    async def rss_response(self, request, writer):
        mode=request['head'].split(b' ')[1].decode().strip('/')
        length=25*1048576 if mode in ('two-contexts-eight-candidates','two-25MiB-slow-readers','fair-contention-completion','preallocation-backpressure','disconnect-finally','declared-length') else 256
        extra=b''
        if mode=='oversize-body':length=25*1048576+1
        if mode=='compressed-bomb-no-decode':extra=b'Content-Encoding: gzip\r\n'
        if mode=='chunked-response':extra+=b'Transfer-Encoding: chunked\r\n'
        elif mode!='unknown-length':extra+=b'Content-Length: '+str(length).encode()+b'\r\n'
        writer.write(b'HTTP/1.1 200 OK\r\n'+extra+b'Connection: close\r\n\r\n');await writer.drain()
        if mode=='slow-body-deadline':await asyncio.sleep(61);return
        if mode=='short-body':writer.write(b'short');await writer.drain();return
        if mode=='chunked-response':writer.write(b'4\r\ntest\r\n0\r\n\r\n');await writer.drain();return
        if mode=='compressed-bomb-no-decode':
            import gzip
            writer.write(gzip.compress(b'x'*1048576));await writer.drain();return
        block=b'x'*16384
        while length:
            n=min(length,len(block));writer.write(block[:n]);await writer.drain();length-=n
            await asyncio.sleep(0)

    def rss_raw_client(self, c, ctx, path, *, sent=None, read=None, tail=None, finish_tail=None, body_size=0, abort=False, abort_tail=False):
        # Blocking stdlib TLS deliberately performs NO background reads. Async
        # StreamReader clients read ahead even when the test awaits no read().
        c.settimeout(70)
        try:
            c.sendall(b'CONNECT permit.example:443 HTTP/1.1\r\nHost: permit.example:443\r\n\r\n')
            head=b''
            while not head.endswith(b'\r\n\r\n'):
                part=c.recv(1)
                if not part:raise ConnectionError('CONNECT refused')
                head+=part
            with ctx.wrap_socket(c,server_hostname='permit.example') as tls:
                method='POST' if body_size else 'GET'
                fields=('Content-Length: '+str(body_size)+'\r\n') if body_size else ''
                tls.sendall((method+' /'+path+' HTTP/1.1\r\nHost: permit.example\r\nAccept-Encoding: identity\r\n'+fields+'\r\n').encode())
                block=b'x'*16384;left=body_size
                while left:
                    n=min(left,len(block));tls.sendall(block[:n]);left-=n
                if sent:sent.set()
                if read and not read.wait(8):raise TimeoutError('reader hold not released')
                if abort:return dict(head=b'',received=0,digest=None)
                head=bytearray()
                while not head.endswith(b'\r\n\r\n'):
                    part=tls.recv(1)
                    if not part:return dict(head=bytes(head),received=0,digest=None)
                    head.extend(part)
                    if len(head)>HEADER:raise AssertionError('response header bound')
                length=int(dict(line.split(b': ',1) for line in bytes(head).split(b'\r\n')[1:] if b': ' in line)[b'content-length'])
                received=0;digest=hashlib.sha256()
                while received<length:
                    if tail and received==length-16384:
                        tail.set()
                        if not finish_tail.wait(8):raise TimeoutError('tail hold not released')
                        if abort_tail:break
                    n=min(16384,length-received)
                    if tail and received<length-16384:n=min(n,length-16384-received)
                    part=tls.recv(n)
                    if not part:break
                    received+=len(part);digest.update(part)
                if received==length:self.assertEqual(tls.recv(1),b'')
                return dict(head=bytes(head),received=received,digest=digest.hexdigest())
        finally:c.close()

    async def rss_start_raw(self, ctx, name, *, second=False, **client_options):
        changes=dict(contextId='context2',guardId='guard2',targetId='target2') if second else {}
        h,c,ck=await self.connection(receive_size=8192,**changes)
        self.runtime.register_guard(ck,h.binding['guardId'],h.binding['targetId'])
        run=asyncio.create_task(h.run());self.addAsyncCleanup(self.cancel_runs,[run])
        client=asyncio.create_task(asyncio.to_thread(self.rss_raw_client,c,ctx,name,**client_options))
        return h,run,client

    def assert_slot_stats(self, stats, count):
        self.assertEqual(stats['activeResponseSlots'],count)
        self.assertEqual(stats['flows'],count)
        self.assertEqual(stats['pools']['response'],count*56*1048576)
        self.assertEqual(stats['maxResponseSlots'],self.runtime.owner.max_slots)

    async def rss_multi_case(self, name):
        import threading,time
        from transport_control import ControlServer
        ctx=await self.rss_fixture(responder=self.rss_response)
        control=ControlServer(self.runtime,'127.0.0.1',[])
        read=threading.Event();finish_tails=[threading.Event(),threading.Event()]
        sent=[threading.Event(),threading.Event()];tails=[threading.Event(),threading.Event()]
        self.addCleanup(read.set)
        for release in finish_tails:self.addCleanup(release.set)
        group=[await self.rss_start_raw(ctx,name,second=bool(i),sent=sent[i],read=read,tail=tails[i],finish_tail=finish_tails[i]) for i in range(2)]
        await self.wait_state(lambda:all(x.is_set() for x in sent))
        await self.wait_state(lambda:all(h.client_io.pending_write for h,_,_ in group),timeout=4)
        end=time.monotonic()+2;sample_count=0
        while time.monotonic()<end:
            self.assert_slot_stats(await control.dispatch(dict(op='stats')),2)
            for h,_,_ in group:
                self.assertTrue(self.runtime.owner.flows[h.flow.id].draining)
                self.assertFalse(h.drained)
            sample_count+=1;await asyncio.sleep(.02)
        self.assertGreaterEqual(sample_count,50)
        if name in ('two-contexts-eight-candidates','preallocation-backpressure','fair-contention-completion'):
            accepts=[asyncio.create_task(self.runtime.serve_listener(h.listener.cookie)) for h,_,_ in group]
            self.addAsyncCleanup(self.cancel_runs,accepts)
            before={k:len(v.buffers) for k,v in self.runtime.owner.flows.items()}
            for i in range(6):
                c=socket.socket();c.setblocking(False);self.sockets.append(c)
                await asyncio.get_running_loop().sock_connect(c,group[i%2][0].listener.address)
                await asyncio.get_running_loop().sock_sendall(c,b'CONNECT permit.example:443 HTTP/1.1\r\nHost: permit.example:443\r\n\r\n')
                c.close()
            await self.wait_state(lambda:sum(e['event']=='admission_refused' for e in self.runtime.event_log)==6)
            self.assertEqual({k:len(v.buffers) for k,v in self.runtime.owner.flows.items()},before)
            self.assertEqual(len(self.runtime.owner.transport_reservations),2)
        read.set()
        await self.wait_state(lambda:all(x.is_set() for x in tails),timeout=8)
        # send() acceptance is not a TCP drain ACK: a small tail still fills the
        # raw clients' receive windows. This was the missing terminal boundary.
        await asyncio.sleep(.3)
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),2)
        finish_tails[0].set()
        await asyncio.wait_for(group[0][2],3);await asyncio.wait_for(group[0][1],3)
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),1)
        self.assertIn(group[1][0].flow.id,self.runtime.owner.flows)
        finish_tails[1].set()
        results=await asyncio.wait_for(asyncio.gather(*(client for _,_,client in group)),5)
        await asyncio.wait_for(asyncio.gather(*(run for _,run,_ in group)),5)
        for result in results:
            self.assertEqual(result['received'],25*1048576)
            digest=hashlib.sha256()
            for _ in range(25*64):digest.update(b'x'*16384)
            self.assertEqual(result['digest'],digest.hexdigest())
        self.assert_finalized([h.flow.id for h,_,_ in group])
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),0)
        self.assertEqual(self.runtime.owner.max_slots,2)
        self.assertLessEqual(self.runtime.max_queue,QUEUE)
        if name=='fair-contention-completion':
            # Both contexts must admit and finish a new request after losers
            # were refused; no starvation or retained body/admission queue.
            for h,_,_ in group:
                c=socket.socket();c.setblocking(False);self.sockets.append(c)
                await asyncio.get_running_loop().sock_connect(c,h.listener.address)
                reader,writer=await self.rss_client(c,ctx,'/completion')
                response=await asyncio.wait_for(reader.read(),3)
                self.assertIn(b'200 OK',response)
                await self.wait_state(lambda:not self.runtime.handlers)
                writer.close()
            self.assertEqual(len(self.rss_origins),4)

    async def rss_single_case(self, name):
        import threading,time
        entered=threading.Event();review=threading.Event();self.addCleanup(review.set)
        def policy(meta,remaining):
            if name=='held-request-review':
                entered.set()
                if not review.wait(1.5):raise TimeoutError('review not released')
        ctx=await self.rss_fixture(policy,responder=self.rss_response,write=name=='held-request-review')
        options=dict(body_size=25*1048576) if name=='held-request-review' else {}
        if name=='disconnect-finally':
            read=threading.Event();self.addCleanup(read.set);options.update(read=read,abort=True)
        h,run,client=await self.rss_start_raw(ctx,name,**options)
        if name=='held-request-review':
            await self.wait_state(entered.is_set)
            f=self.runtime.owner.flows[h.flow.id]
            self.assertEqual(self.runtime.owner.pools['request'],50*1048576+4096)
            self.assertEqual([len(b) for d,b in f.buffers if d=='request'],[25*1048576]*2)
            self.assertIsInstance(h.flow.request.raw_content,bytes)
            self.assertEqual(self.rss_origins,[])
            await asyncio.sleep(.15);review.set()
        if name=='disconnect-finally':
            await self.wait_state(lambda:bool(h.client_io.pending_write),timeout=4)
            read.set() # actual client disconnect, not a server-side close
        started=time.monotonic()
        result=await asyncio.wait_for(client,65)
        await asyncio.wait_for(run,3)
        if name in ('short-body','oversize-body','slow-body-deadline','compressed-bomb-no-decode','disconnect-finally'):
            self.assertEqual(result['received'],0)
            if name!='disconnect-finally':self.assertEqual(h.downstream_plaintext_bytes,0)
        else:
            expected=b'test' if name=='chunked-response' else b'x'*(25*1048576 if name=='declared-length' else 256)
            self.assertEqual(result['received'],len(expected))
            self.assertEqual(result['digest'],hashlib.sha256(expected).hexdigest())
        if name=='slow-body-deadline':
            self.assertGreaterEqual(time.monotonic()-started,59)
            self.assertLess(time.monotonic()-started,62)
            self.assertTrue(any(e['event']=='socket_closed' and e.get('reason')=='TimeoutError' or e['event']=='refused' and e.get('reason')=='BROWSER_DEADLINE' for e in self.runtime.event_log))
        if name=='compressed-bomb-no-decode':
            self.assertTrue(any(e['event']=='refused' and e.get('reason')=='BROWSER_ENCODING' for e in self.runtime.event_log))
            self.assertEqual(self.runtime.owner.maxima['response'],56*1048576)
        self.assertEqual(len(self.rss_origins),1)
        self.assert_finalized([h.flow.id])
        self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))

    async def rss_consumed_case(self, name):
        import tempfile
        from pathlib import Path
        ctx=await self.rss_fixture(responder=self.rss_response,write=True)
        base=self.policy.call.side_effect;receipts=[]
        with tempfile.TemporaryDirectory() as directory:
            def policy(meta,remaining):
                result=base(meta,remaining)
                if meta['event']=='persist_unknown':
                    record=dict(outcome='unknown',retry=False,id=meta['id'])
                    with open(Path(directory)/'unknown.json','x') as out:
                        json.dump(record,out);out.flush();__import__('os').fsync(out.fileno())
                    receipts.append(record)
                return result
            self.policy.call.side_effect=policy
            if name=='consumed-write-no-retry':self.runtime.fault=dict(point='after_consume',action='revoke_all')
            else:
                original=self.runtime.adapter.event
                async def loss(event,flow):
                    result=await original(event,flow)
                    if event=='request':
                        # Model controller EOF AFTER its durable consume reply;
                        # transport closes before an upstream connect/write.
                        self.runtime.revoke_all()
                    return result
                self.runtime.adapter.event=loss
            h,run,client=await self.rss_start_raw(ctx,name,body_size=13)
            result=await asyncio.wait_for(client,3);await asyncio.wait_for(run,3)
            self.assertEqual(result['received'],0)
            self.assertEqual(self.rss_origins,[])
            self.assertEqual(h.upstream_plaintext_bytes,0)
            self.assertEqual(receipts,[dict(outcome='unknown',retry=False,id=h.flow.id)])
            self.assertEqual(json.loads((Path(directory)/'unknown.json').read_text()),receipts[0])
            self.assertEqual(sum(c.args[0]['event']=='request' for c in self.policy.call.call_args_list),1)
            self.assert_finalized([h.flow.id])
            self.runtime.revoke_all()
            self.assertEqual(len(receipts),1)

    async def test_response_slot_stats_exclude_transport_only_connections(self):
        from transport_control import ControlServer
        control=ControlServer(self.runtime,'127.0.0.1',[])
        h,_,_=await self.connection()
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),0)
        self.runtime.owner.reserve(h.flow.id,0,0)
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),1)
        self.runtime.owner.response_complete(h.flow.id)
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),1)
        self.runtime.finish(h)
        self.assert_slot_stats(await control.dispatch(dict(op='stats')),0)
        self.assertEqual((await control.dispatch(dict(op='stats')))['maxResponseSlots'],1)

    async def test_controller_socket_eof_after_consume_does_not_retry(self):
        # Actual UnixPolicy framing/peer credentials + an EOF, not an allow
        # boolean. Controller already wrote unknown before losing the channel.
        import os,struct,tempfile,threading
        from pathlib import Path
        from parser_adapter import UnixPolicy
        ctx=await self.rss_fixture(responder=self.rss_response,write=True)
        base=self.policy.call.side_effect;messages=[];stop=threading.Event()
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'policy.sock');journal=Path(directory)/'unknown.json'
            listener=socket.socket(socket.AF_UNIX);listener.bind(path);listener.listen(2);listener.settimeout(.1)
            def serve():
                while not stop.is_set():
                    try:peer,_=listener.accept()
                    except socket.timeout:continue
                    with peer:
                        peer.settimeout(2)
                        def exact(n):
                            data=b''
                            while len(data)<n:
                                part=peer.recv(n-len(data))
                                if not part:raise ConnectionError('policy request EOF')
                                data+=part
                            return data
                        n,=struct.unpack('!I',exact(4));meta=json.loads(exact(n));messages.append(meta['event'])
                        if meta['event']=='server_connect':continue # real reply EOF
                        if meta['event'] in ('persist_unknown','close_flow'):continue
                        result=base(meta,2)
                        if meta['event']=='request':
                            with journal.open('x') as out:
                                json.dump(dict(outcome='unknown',retry=False,id=meta['id']),out);out.flush();os.fsync(out.fileno())
                        raw=json.dumps(result).encode();peer.sendall(struct.pack('!I',len(raw))+raw)
            worker=threading.Thread(target=serve);worker.start()
            unix=UnixPolicy(path,peer_uid=os.getuid()) # test peer only, production requires uid 0
            self.runtime.policy=unix;self.runtime.adapter.policy=unix
            try:
                h,run,client=await self.rss_start_raw(ctx,'controller-loss-unknown',body_size=13)
                result=await asyncio.wait_for(client,4);await asyncio.wait_for(run,4)
                self.assertEqual(result['received'],0);self.assertEqual(h.upstream_plaintext_bytes,0)
                self.assertEqual(self.rss_origins,[])
                self.assertEqual(json.loads(journal.read_text()),dict(outcome='unknown',retry=False,id=h.flow.id))
                self.assertEqual(messages.count('request'),1)
                self.assertEqual(messages.count('persist_unknown'),1)
                self.assertTrue(self.runtime.dead);self.assertTrue(self.runtime.adapter.dead)
                self.assert_finalized([h.flow.id])
                self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))
            finally:
                stop.set();await asyncio.to_thread(worker.join,3);listener.close()
                self.assertFalse(worker.is_alive())

    async def rss_tcp_drain_terminal(self, expire):
        import threading,time
        ctx=await self.rss_fixture(responder=self.rss_response)
        tail=threading.Event();release=threading.Event();self.addCleanup(release.set)
        h,run,client=await self.rss_start_raw(ctx,'declared-length',tail=tail,finish_tail=release,abort_tail=not expire)
        await self.wait_state(tail.is_set,timeout=8)
        await self.wait_state(lambda:h.client_io.pending_write==0)
        await asyncio.sleep(.1)
        self.assertIn(h.flow.id,self.runtime.owner.flows)
        if expire:self.runtime.clock=lambda:time.monotonic()+60
        else:release.set() # peer closes while TCP drain is pending
        await asyncio.wait_for(run,1)
        self.assert_finalized([h.flow.id])
        self.assertFalse(h.drained)
        self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))
        release.set();await asyncio.wait_for(client,3)

    async def test_original_deadline_during_tcp_drain(self):await self.rss_tcp_drain_terminal(True)
    async def test_disconnect_during_tcp_drain(self):await self.rss_tcp_drain_terminal(False)

    async def test_request_decision_deadline_bounds_parked_policy(self):
        import threading
        entered=threading.Event();release=threading.Event()
        def parked(meta,remaining):
            entered.set();release.wait(4)
        ctx=await self.rss_fixture(parked)
        h,c,ck=await self.connection();self.runtime.register_guard(ck,'guard1','target1')
        task=asyncio.create_task(h.run());self.addAsyncCleanup(self.cancel_runs,[task])
        try:
            client=await self.rss_client(c,ctx)
            await self.wait_state(entered.is_set)
            await self.wait_state(task.done,timeout=2.3)
            self.assertTrue(any(e['event']=='socket_closed' and e.get('reason')=='TimeoutError' for e in self.runtime.event_log))
            self.assert_finalized([h.flow.id])
            self.assertIsNone(h.decision)
            self.assertEqual(h.upstream_plaintext_bytes,0)
        finally:release.set()

    async def test_repeated_cancellation_during_monitor_cleanup_finalizes_once(self):
        entered=asyncio.Event()
        ctx=await self.rss_fixture()
        h,c,ck=await self.connection();self.runtime.register_guard(ck,'guard1','target1')
        original=self.runtime.adapter.event
        async def parked(name,flow):
            if name=='request':entered.set();await asyncio.Event().wait()
            return await original(name,flow)
        self.runtime.adapter.event=parked
        task=asyncio.create_task(h.run());self.addAsyncCleanup(self.cancel_runs,[task])
        client=await self.rss_client(c,ctx);await asyncio.wait_for(entered.wait(),1)
        self.runtime.revoke_all()
        # Run enters its finally and yields while joining the client monitor.
        await asyncio.sleep(0)
        task.cancel();self.runtime.revoke_all()
        await asyncio.gather(task,return_exceptions=True)
        self.assert_finalized([h.flow.id])
        self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))

    async def test_listener_repeated_cancellation_settles_accept_task(self):
        ctx=await self.rss_fixture();s,ck=self.listener()
        self.runtime.register_guard(ck,'guard1','target1')
        entered=asyncio.Event();original=self.runtime.adapter.event
        async def parked(name,flow):
            if name=='request':entered.set();await asyncio.Event().wait()
            return await original(name,flow)
        self.runtime.adapter.event=parked
        accept=asyncio.create_task(self.runtime.serve_listener(ck));self.addAsyncCleanup(self.cancel_runs,[accept])
        c=socket.socket();c.setblocking(False);self.sockets.append(c)
        await asyncio.get_running_loop().sock_connect(c,s.getsockname())
        client=await self.rss_client(c,ctx);await asyncio.wait_for(entered.wait(),1)
        ids=list(self.runtime.handlers)
        for _ in range(3):
            self.runtime.revoke_listener(ck);accept.cancel();await asyncio.sleep(0)
        await asyncio.wait_for(asyncio.gather(accept,return_exceptions=True),0.75)
        self.assert_finalized(ids)
        self.assertNotIn(ck,self.runtime.accept_tasks)
        self.assertTrue(await self.runtime.settled())

    async def cancellation_stage(self,route,stage):
        ctx=await self.rss_fixture()
        h,c,ck=await self.connection();self.runtime.register_guard(ck,'guard1','target1')
        entered=asyncio.Event()
        async def park():entered.set();await asyncio.Event().wait()
        real_hook=h.handle_hook
        async def hook(event):
            if event.name==stage:await park()
            return await real_hook(event)
        h.handle_hook=hook
        real_handshake=TLSChannel.handshake
        async def handshake(channel):
            if stage=='tls' and channel.io is h.client_io:await park()
            return await real_handshake(channel)
        real_read=h.read_message
        async def read(io,response):
            if stage==('response_parse' if response else 'request_parse'):await park()
            return await real_read(io,response)
        h.read_message=read
        real_write=TLSChannel.write
        async def write(channel,data):
            if stage=='drain' and channel.io is h.client_io:await park()
            return await real_write(channel,data)
        real_drain=h.client_io.drain
        async def drain():
            if stage=='tcp_drain':await park()
            await real_drain()
        h.client_io.drain=drain
        with patch.object(TLSChannel,'handshake',handshake),patch.object(TLSChannel,'write',write):
            task=asyncio.create_task(h.run());self.addAsyncCleanup(self.cancel_runs,[task])
            client=asyncio.create_task(self.rss_client(c,ctx));self.addAsyncCleanup(self.cancel_runs,[client])
            await asyncio.wait_for(entered.wait(),2)
            # All three cancellation sources are repeated deliberately. A
            # cancellation during an already-running finally must not skip it.
            for _ in range(3):
                if route=='revoke_all':self.runtime.revoke_all()
                elif route=='listener':self.runtime.revoke_listener(ck)
                else:task.cancel()
                await asyncio.sleep(0)
            await asyncio.wait_for(asyncio.gather(task,return_exceptions=True),0.75)
            self.assert_finalized([h.flow.id])
            self.runtime.finish(h) # idempotence, including the terminal ACK
            self.assert_finalized([h.flow.id])
            self.assertEqual(sum(call.args[0]['event']=='close_flow' for call in self.policy.call.call_args_list),1)
            self.assertEqual(self.runtime.owner.pools,dict(request=0,response=0,transport=0))
            self.assertFalse(h.flow.live)
            self.assertIsNone(h.flow.request);self.assertIsNone(h.flow.response)
            self.assertEqual(h.client_io.sock.fileno(),-1)
            if h.upstream_io:self.assertEqual(h.upstream_io.sock.fileno(),-1)
            if not client.done():client.cancel()
            await asyncio.gather(client,return_exceptions=True)

    async def cancel_runs(self,tasks):
        for task in tasks:
            if not task.done():task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)

    async def bad_request(self,headers):
        h,c,_=await self.connection()
        # Exercise actual socket ingress before parser collection. The dedicated
        # read_message method is shared by the real lifecycle, not a second parser.
        await asyncio.get_running_loop().sock_sendall(c,b'POST / HTTP/1.1\r\nHost: permit.example\r\n'+headers+b'\r\n')
        with self.assertRaises(Refused):await h.read_message(h.client_io,False)
        self.assertEqual(self.runtime.owner.flows,{})
    async def terminal(self,kind):
        if kind=='reset':
            import ssl,struct
            from mitmproxy import http
            from transport_runtime import AsyncSocket
            await self.certs();h,c,_=await self.connection()
            h.flow.request=http.Request.make('GET','https://permit.example/')
            self.runtime.owner.reserve(h.flow.id,0,0)
            self.runtime.owner.consume(h.flow.id);h.unknown_token='reset-receipt'
            def upstream():
                ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(self.cert_file,self.key_file)
                h.client_io.sock.settimeout(5)
                with ctx.wrap_socket(h.client_io.sock,server_side=True) as tls:
                    tls.recv(4096)
                    # Real TCP RST, after successful trusted TLS handshake.
                    tls.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack('ii',1,0))
            task=asyncio.create_task(asyncio.to_thread(upstream))
            h.context.server.state=__import__('mitmproxy.connection',fromlist=['ConnectionState']).ConnectionState.OPEN
            channel=TLSChannel(AsyncSocket(c,h.io_remaining),h.context,False,self.runtime.tls_config,'permit.example',h.deadline);h.server_tls=channel
            await channel.handshake();await channel.write(b'GET / HTTP/1.1\r\nHost: permit.example\r\n\r\n')
            with self.assertRaises((Refused,OSError)):await h.read_message(channel,True)
            await task;self.runtime.finish(h)
            self.assertEqual(sum(c.args[0]['event']=='persist_unknown' for c in self.policy.call.call_args_list),1)
        elif kind in ('abort','tls'):
            import ssl
            await self.certs();h,c,ck=await self.connection();self.runtime.register_guard(ck,'guard1','target1')
            self.runtime.resolver=Mock();self.runtime.resolver.resolve.return_value=dict(hostname='permit.example',chain=['permit.example'],addresses=['93.184.216.34'],ttlMs=1000)
            def browser():
                c.settimeout(5);c.sendall(b'CONNECT permit.example:443 HTTP/1.1\r\nHost: permit.example:443\r\n\r\n')
                response=b''
                while b'\r\n\r\n' not in response:response+=c.recv(1024)
                if kind=='tls':c.sendall(b'\x16\x03\x03\xff\xff');c.close();return
                ctx=ssl.create_default_context(cafile=self.cert_file);ctx.set_alpn_protocols(['http/1.1'])
                with ctx.wrap_socket(c,server_hostname='permit.example') as tls:
                    tls.sendall(b'POST / HTTP/1.1\r\nHost: permit.example\r\nContent-Length: 4\r\n\r\nhi')
            task=asyncio.create_task(asyncio.to_thread(browser));await h.run();await task
            if kind=='abort':self.assertEqual(self.runtime.owner.max_slots,1)
        else:
            h,c,_=await self.connection();self.runtime.owner.reserve(h.flow.id,0,0);self.now+=60;c.close();await h.run()
        self.assertEqual(self.runtime.handlers,{})

# Each lifecycle boundary is a named unittest, so a missing matrix cell cannot
# be hidden by a loop that exits on its first cancellation failure.
def cancellation_test(route,stage):
    async def test(self):await self.cancellation_stage(route,stage)
    return test

for route in ('revoke_all','listener','cancelled_error'):
    for stage in ('http_connect','tls','request_parse','requestheaders','request',
                  'server_connect','server_connected','response_parse','responseheaders','response','drain','tcp_drain'):
        setattr(TransportTests,'test_'+route+'_parked_at_'+stage,cancellation_test(route,stage))

# Inventory mirrors lib/browser/acceptance.mjs; one named loopback test per case.
RSS_CASES = ('two-contexts-eight-candidates','two-25MiB-slow-readers','held-request-review',
             'fair-contention-completion','declared-length','unknown-length','chunked-response',
             'short-body','oversize-body','slow-body-deadline','compressed-bomb-no-decode',
             'preallocation-backpressure','disconnect-finally','controller-loss-unknown','consumed-write-no-retry')
def rss_case_test(name):
    async def test(self):
        if name in ('two-contexts-eight-candidates','two-25MiB-slow-readers','fair-contention-completion','preallocation-backpressure'):
            await self.rss_multi_case(name)
        elif name in ('controller-loss-unknown','consumed-write-no-retry'):await self.rss_consumed_case(name)
        else:await self.rss_single_case(name)
    return test
for name in RSS_CASES:setattr(TransportTests,'test_rss_case_'+name.replace('-','_'),rss_case_test(name))

if __name__=='__main__':unittest.main()
