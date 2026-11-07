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
        r=SimpleNamespace(revoke_all=lambda:None,settled=lambda:asyncio.sleep(0))
        c=ControlServer(r,'10.203.0.2',[18081,18082])
        self.assertTrue((await c.dispatch({'op':'revoke_all'}))['durable'])
        self.assertFalse(c.dead,'terminal telemetry must survive listener revocation')
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

if __name__=='__main__':unittest.main()
