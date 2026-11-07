"""Offline control tests. No sockets, servers or browsers."""
import asyncio,sys,unittest
from types import SimpleNamespace
from transport_control import ControlServer
class ControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_proxy407_fault_uses_real_connect_reply_checkpoint(self):
        r=SimpleNamespace(case='proxy-407',fault=None)
        c=ControlServer(r,'10.203.0.2',[18081,18082])
        self.assertTrue((await c.dispatch({'op':'fault_arm','point':'before_connect_reply','action':'proxy407'}))['ok'])
        self.assertEqual(r.fault,{'point':'before_connect_reply','action':'proxy407'})
    async def test_terminal_control_stays_available_for_evidence(self):
        r=SimpleNamespace(revoke_all=lambda:None,settled=lambda:asyncio.sleep(0,result=True))
        c=ControlServer(r,'10.203.0.2',[18081,18082])
        self.assertTrue((await c.dispatch({'op':'revoke_all'}))['durable'])
        self.assertFalse(c.dead,'terminal telemetry must survive listener revocation')
    async def test_unconfirmed_settlement_cannot_ack_durable_revoke(self):
        for confirmed in (False,None):
            r=SimpleNamespace(revoke_all=lambda:None,settled=lambda:asyncio.sleep(0,result=confirmed))
            with self.assertRaisesRegex(Exception,'BROWSER_REVOKE_UNCONFIRMED'):
                await ControlServer(r,'unused',[]).dispatch({'op':'revoke_all'})
class ConnectTests(unittest.TestCase):
    def test_chromium_connect_metadata_does_not_allow_credentials_or_framing(self):
        from transport_runtime import validate_connect_headers
        validate_connect_headers([(b'Host',b'fixture.example:443'),(b'Proxy-Connection',b'keep-alive'),(b'User-Agent',b'Chromium')],'fixture.example:443')
        for key in [b'Authorization',b'Proxy-Authorization',b'Cookie',b'Content-Length',b'Transfer-Encoding']:
            with self.assertRaises(Exception):validate_connect_headers([(b'Host',b'fixture.example:443'),(key,b'x')],'fixture.example:443')
        with self.assertRaises(Exception):validate_connect_headers([(b'Host',b'wrong.example:443')],'fixture.example:443')

class CrashTests(unittest.TestCase):
    def test_peer_fault_changes_real_dial_without_short_circuiting(self):
        from transport_runtime import TransportRuntime
        r=TransportRuntime.__new__(TransportRuntime);r.fault={'point':'before_dial','action':'dial_other_peer'};r.observe=lambda *a,**k:None
        h=SimpleNamespace(context=SimpleNamespace(server=SimpleNamespace(address=('8.8.8.8',443))))
        r.fault_point('before_dial',h)
        self.assertEqual(h.context.server.address,('8.8.4.4',443))
    def test_crash_fault_is_abrupt_exit_70_without_oom_signal(self):
        from transport_runtime import TransportRuntime
        from unittest.mock import patch
        r=TransportRuntime.__new__(TransportRuntime);r.fault={'point':'before_request_decision','action':'exit'};r.observe=lambda *a,**k:None
        with patch('os._exit',side_effect=SystemExit(70)) as end:
            with self.assertRaises(SystemExit):r.fault_point('before_request_decision',None)
            end.assert_called_once_with(70)

class LeaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_abrupt_policy_loss_closes_active_sockets_without_callback(self):
        from transport_control import supervise_policy
        calls=[]
        class Runtime:
            dead=False
            def observe(self,*a):calls.append('loss')
            def revoke_all(self):calls.append('socket-close');self.dead=True
            async def settled(self):calls.append('settled')
        class Policy:
            def call(self,*a):raise ConnectionResetError()
        await supervise_policy(Runtime(),Policy(),interval=.001,timeout=.01)
        self.assertEqual(calls,['loss','socket-close','settled'])
    async def test_stalled_policy_lease_is_bounded(self):
        from transport_control import supervise_policy
        from unittest.mock import patch
        r=SimpleNamespace(dead=False,observe=lambda *a:None,revoke_all=lambda:None,settled=lambda:asyncio.sleep(0))
        async def stuck(*a):await asyncio.Future()
        with patch('asyncio.to_thread',stuck):await asyncio.wait_for(supervise_policy(r,None,timeout=.01),.1)

class DispatchLifetimeTests(unittest.IsolatedAsyncioTestCase):
    def lifetime(self):
        import os,subprocess
        from transport_control import LifetimePolicy
        # A separate process, not a daemon/server. pidfd remains readable after
        # reaping, proving that PID reuse and a zombie cannot revive authority.
        child=subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.buffer.read()'],stdin=subprocess.PIPE)
        self.addCleanup(child.stdin.close)
        self.addCleanup(lambda: child.poll() is None and (child.kill(),child.wait()))
        policy=LifetimePolicy('/unused');policy.pidfd=os.pidfd_open(child.pid);policy.pid=child.pid
        self.addCleanup(policy.close)
        return policy,child
    async def test_post_tls_dispatch_loss_cannot_release_buffered_post(self):
        from transport_runtime import TransportRuntime
        from unittest.mock import Mock
        policy,child=self.lifetime();r=TransportRuntime.__new__(TransportRuntime)
        h=SimpleNamespace(flow=SimpleNamespace(id='f'),request_digest='a'*64,decision={'decisionId':'d'},decision_deadline=100)
        r.handler=lambda f:h;r.remaining=lambda f:1;r.clock=lambda:1;r.policy=policy;r.fault=None
        r.event_metadata=Mock();r.apply_verified=Mock();r.observe=Mock()
        child.kill();child.wait()
        with self.assertRaisesRegex(Exception,'BROWSER_CONTROLLER_LOST'):await r.dispatch_request(h)
        r.event_metadata.assert_not_called();r.observe.assert_not_called()
    async def test_active_upload_checks_pidfd_between_tls_records(self):
        from transport_runtime import AsyncSocket
        from transport_tls import TLSChannel
        from mitmproxy.proxy import commands
        from unittest.mock import Mock
        policy,child=self.lifetime();sock=Mock();sent=[]
        def send(data):
            sent.append(bytes(data));child.kill();child.wait();return len(data)
        sock.send.side_effect=send
        io=AsyncSocket(sock,lambda:1);io.write_guard=policy.check_alive
        channel=TLSChannel.__new__(TLSChannel);channel.io=io;channel.plaintext_written=0;channel.layer=Mock()
        def record(data):yield commands.SendData(None,bytes(data))
        channel.layer.send_data.side_effect=record
        with self.assertRaisesRegex(Exception,'BROWSER_CONTROLLER_LOST'):await channel.write(b'x'*32768)
        self.assertEqual(len(sent),1);self.assertEqual(len(sent[0]),16384)
    async def test_pidfd_watcher_cancels_without_periodic_lease(self):
        from transport_control import watch_controller_death
        from unittest.mock import Mock
        policy,child=self.lifetime();r=SimpleNamespace(observe=Mock(),revoke_all=Mock())
        watch=asyncio.create_task(watch_controller_death(r,policy));await asyncio.sleep(0)
        child.kill();child.wait();await asyncio.wait_for(watch,.2)
        r.revoke_all.assert_called_once();r.observe.assert_called_once_with('controller_lost')

class SupervisorTests(unittest.TestCase):
    def test_eof_kills_browser_group_and_waits_independently(self):
        import importlib.util
        from pathlib import Path
        from unittest.mock import patch,Mock
        spec=importlib.util.spec_from_file_location('fixture_io',Path(__file__).parent/'fixtures/fixture-io.py');io=importlib.util.module_from_spec(spec);spec.loader.exec_module(io)
        child=Mock(pid=123,returncode=-9);child.poll.return_value=None
        with patch('subprocess.Popen',return_value=child),patch('select.select',return_value=([io.sys.stdin.buffer],[],[])),patch('os.read',return_value=b''),patch('os.killpg') as kill,patch('builtins.print'):
            self.assertEqual(io.supervise_browser(['1000','1000','fake-browser']),-9)
            kill.assert_called_once_with(123,io.signal.SIGKILL);child.wait.assert_called_once_with(timeout=2)
    def test_response_metadata_measures_body_not_headers(self):
        import importlib.util,hashlib
        from pathlib import Path
        from unittest.mock import patch,Mock
        spec=importlib.util.spec_from_file_location('fixture_io',Path(__file__).parent/'fixtures/fixture-io.py');io=importlib.util.module_from_spec(spec);spec.loader.exec_module(io)
        for body in [b'test',b'te']:
            sock=Mock();sock.recv.side_effect=[bytes([b]) for b in b'HTTP/1.1 200 Connection Established\r\n\r\n']+[b'HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n'+body,b'']
            ctx=Mock();ctx.wrap_socket.return_value=sock
            with patch.object(io.socket,'socket',return_value=sock),patch.object(io.ssl,'create_default_context',return_value=ctx):result=io.request(dict(host='fixture.example',path='/',ca='unused'))
            self.assertEqual(result['bodyBytes'],len(body));self.assertEqual(result['bodySha256'],hashlib.sha256(body).hexdigest());self.assertEqual(result['complete'],len(body)==4)

if __name__=='__main__':unittest.main()
