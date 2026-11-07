"""Mandatory mitmproxy addon. Never run with stock parser: startup requires the
SJC preallocation/parser/Unix-policy adapter. No content logging or flow history.
The native adapter's metadata/authority calls use lib/browser/gate.mjs via bounded
Unix RPC; bodies stay in parser-owned charged buffers, not JSON/base64 IPC.
"""
import asyncio
from mitmproxy import ctx

class EgressGate:
    def __init__(self):
        self.runtime = None
        self.dead = False

    def running(self):
        self.runtime = getattr(ctx.master, "sjc_runtime_v1", None)
        if self.runtime is None or not self.runtime.attested():
            self.dead = True
            ctx.master.shutdown()
            raise RuntimeError("BROWSER_RUNTIME_UNATTESTED")
        self.runtime.assert_options(ctx.options)

    def fatal(self, flow=None):
        self.dead = True
        if flow is not None:
            flow.kill()
        try:
            if self.runtime is not None:
                self.runtime.revoke_all()  # closes keepalive/TLS/upstream, durable unknown
        finally:
            ctx.master.shutdown()

    async def guarded(self, name, flow):
        try:
            if self.dead or self.runtime is None:
                raise RuntimeError("BROWSER_REVOKED")
            # 60 s original flow deadline is enforced by parser too. No timeout
            # refresh here. Missing adapter result must never allow forwarding.
            deadline = min(self.runtime.remaining(flow), 60)
            result = await asyncio.wait_for(self.runtime.event(name, flow), deadline)
            if result is not True:
                flow.kill()
                self.runtime.release(flow, success=False)
        except BaseException:
            self.fatal(flow)
            raise  # dispatcher treats every exception as process-fatal

    async def http_connect(self, flow):
        await self.guarded("http_connect", flow)  # no passthrough; authority only

    async def requestheaders(self, flow):
        flow.request.stream = False
        await self.guarded("requestheaders", flow)  # reserve before parser read

    async def request(self, flow):
        # Complete local body; exact immutable/HMAC bytes + <=2s signed decision.
        # Only event return permits lazy upstream pipeline to continue.
        await self.guarded("request", flow)

    async def responseheaders(self, flow):
        flow.response.stream = False
        await self.guarded("responseheaders", flow)

    async def response(self, flow):
        await self.guarded("response", flow)
        # Do NOT release here: the parser must retain the slot until socket drain.

    async def error(self, flow):
        if self.runtime is not None:
            self.runtime.release(flow, success=False)

    async def server_connect(self, data):
        try:
            if self.dead or self.runtime is None:
                raise RuntimeError("BROWSER_REVOKED")
            # Resolves full DNS chain each socket, pins IP; retains SNI/cert host.
            if await self.runtime.server_connect(data) is not True:
                data.server.error = "BROWSER_ADDRESS_BLOCKED"
        except BaseException:
            data.server.error = "BROWSER_SERVICE_UNAVAILABLE"
            self.fatal()
            raise

    async def server_connected(self, data):
        try:
            if self.dead or await self.runtime.server_connected(data) is not True:
                raise RuntimeError("BROWSER_ADDRESS_BLOCKED")
        except BaseException:
            data.server.error = "BROWSER_ADDRESS_BLOCKED"
            self.fatal()
            raise

    def done(self):
        self.dead = True
        if self.runtime is not None:
            self.runtime.revoke_all()
