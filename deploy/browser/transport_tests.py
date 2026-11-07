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
    async def connection(self, **changes):
        s,cookie=self.listener(**changes)
        c=socket.socket(); c.setblocking(False); self.sockets.append(c)
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
        for _ in range(100):self.runtime.observe('counter')
        self.assertEqual(len(self.runtime.event_log),64);self.assertGreater(self.runtime.dropped_events,0)
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

if __name__=='__main__':unittest.main()
