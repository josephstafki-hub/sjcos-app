"""Bounded subclasses of mitmproxy 12.3.1's real OpenSSL TLS layers.
The driver advances generators only after each socket send drains. Never feed
more than ONE TLS record, and never ask OpenSSL to assemble a plaintext flight.
"""
from OpenSSL import SSL
from mitmproxy import connection
from mitmproxy.proxy import commands, events, layer
from mitmproxy.proxy.layers.tls import ClientTLSLayer, ServerTLSLayer, TlsClienthelloHook, TlsStartClientHook, TlsStartServerHook, TlsFailedClientHook, TlsFailedServerHook
from parser_adapter import QUEUE, Refused
import struct

RECORD=18432
PLAIN=16384

class BoundedTLS:
    handshake_in=0
    handshake_out=0
    max_bio_flight=0
    no_plaintext_in=0
    def receive_handshake_data(self,data):
        # Check before stock ClientTLSLayer.recv_buffer.extend or BIO_write.
        if len(data)>RECORD+5 or self.handshake_in+len(data)>QUEUE:
            raise Refused('BROWSER_TLS_LIMIT')
        self.handshake_in+=len(data)
        return (yield from super().receive_handshake_data(data))

    def tls_interact(self):
        total=0
        while True:
            try:data=self.tls.bio_read(PLAIN+1024)
            except SSL.WantReadError:return
            total+=len(data)
            self.max_bio_flight=max(self.max_bio_flight,total)
            if total>QUEUE:raise Refused('BROWSER_TLS_LIMIT')
            if not self.conn.tls_established:
                self.handshake_out+=len(data)
                if self.handshake_out>QUEUE:raise Refused('BROWSER_TLS_LIMIT')
            yield commands.SendData(self.conn,data)

    def receive_data(self,data):
        if len(data)>RECORD+5 or self.no_plaintext_in+len(data)>QUEUE:raise Refused('BROWSER_TLS_LIMIT')
        self.no_plaintext_in+=len(data)
        if data:self.tls.bio_write(data)
        while True:
            try:plain=self.tls.recv(PLAIN)
            except SSL.WantReadError:break
            except SSL.ZeroReturnError:
                yield from self.event_to_child(events.ConnectionClosed(self.conn))
                return
            except SSL.Error:raise Refused('BROWSER_TLS') from None
            if not plain:break
            self.no_plaintext_in=0
            # One fragment is consumed before advancing this generator. No
            # bytearray.extend, no paused Layer event queue, no read-ahead task.
            yield from self.event_to_child(events.DataReceived(self.conn,plain))
        yield from self.tls_interact()

    def send_data(self,data):
        if len(data)>PLAIN:raise Refused('BROWSER_QUEUE_LIMIT')
        if self.tls.send(data)!=len(data):raise Refused('BROWSER_TLS')
        yield from self.tls_interact()

class BoundedClientTLS(BoundedTLS,ClientTLSLayer):
    def __init__(self,context):
        if not context.layers:Plaintext(context)
        super().__init__(context)
class BoundedServerTLS(BoundedTLS,ServerTLSLayer):pass

class Plaintext(layer.Layer):
    def __init__(self,context):
        super().__init__(context);self.pending=None;self.closed=False
    def _handle_event(self,event):
        if isinstance(event,events.DataReceived):
            if self.pending is not None or len(event.data)>PLAIN:raise Refused('BROWSER_QUEUE_LIMIT')
            self.pending=event.data
        elif isinstance(event,events.ConnectionClosed):self.closed=True
        yield from ()

class TLSChannel:
    def __init__(self,io,context,client,tls_config,hostname,deadline):
        self.io,self.context,self.config,self.hostname=io,context,tls_config,hostname
        self.deadline=deadline;self.closed=False;self.plaintext_written=0
        # ClientTLSLayer expects a preceding context layer (normally HttpProxy).
        self.sink=Plaintext(context)
        self.layer=BoundedClientTLS(context) if client else BoundedServerTLS(context)
        self.layer.child_layer=self.sink
        self.client=client;self.max_queue=0

    async def drive(self,generator):
        reply=None
        while True:
            try:command=generator.send(reply)
            except StopIteration as done:return done.value
            reply=None
            if isinstance(command,commands.SendData):
                await self.io.write(command.data)
            elif isinstance(command,TlsClienthelloHook):
                data=command.data
                if data.client_hello.sni!=self.hostname or any(a!=b'http/1.1' for a in data.client_hello.alpn_protocols):
                    raise Refused('BROWSER_HOST')
                data.establish_server_tls_first=False
                data.ignore_connection=False
            elif isinstance(command,(TlsStartClientHook,TlsStartServerHook)):
                self.config.start(command.data,self.client,self.hostname)
            elif isinstance(command,(TlsFailedClientHook,TlsFailedServerHook,commands.CloseConnection)):
                raise Refused('BROWSER_TLS')
            elif isinstance(command,commands.StartHook):
                # Only established hooks remain; no arbitrary addons.
                if command.data.conn.alpn not in (b'',b'http/1.1'):raise Refused('BROWSER_PROTOCOL')
            elif isinstance(command,commands.Log):pass  # never retain content logs
            else:raise Refused('BROWSER_TLS_COMMAND')

    async def record(self):
        head=await self.io.exact(5)
        n=struct.unpack('!H',head[3:])[0]
        if head[0] not in (20,21,22,23) or head[1]!=3 or not 0<n<=RECORD:
            raise Refused('BROWSER_TLS_RECORD')
        return head+await self.io.exact(n)

    async def handshake(self):
        if self.client:
            self.layer.start_handshake()
        else:
            await self.drive(self.layer.start_tls())
            done,error=await self.drive(self.layer.receive_handshake_data(b''))
            if error:raise Refused('BROWSER_TLS')
        while not self.layer.conn.tls_established:
            done,error=await self.drive(self.layer.receive_handshake_data(await self.record()))
            if error:raise Refused('BROWSER_TLS')
            if done:break
        if self.layer.conn.error:raise Refused('BROWSER_TLS')

    async def read(self,maximum=QUEUE):
        if not 0<maximum<=QUEUE:raise Refused('BROWSER_QUEUE_LIMIT')
        # A record contains at most 16K plaintext. While a consumer asks for a
        # smaller head/body slice, retain only that one fragment (<=16K).
        while self.sink.pending is None:
            if self.sink.closed:return b''
            await self.drive(self.layer.receive_data(await self.record()))
        data=self.sink.pending
        part=data[:maximum];self.sink.pending=data[maximum:] or None
        self.max_queue=max(self.max_queue,len(data))
        return part

    async def write(self,data):
        view=memoryview(data)
        for start in range(0,len(view),PLAIN):
            part=view[start:start+PLAIN]
            self.plaintext_written+=len(part)
            await self.drive(self.layer.send_data(part))

    def close(self):
        self.closed=True;self.sink.pending=None
        # Drop all TLS certificate/BIO/parser references on terminal paths.
        self.layer.tls=None;self.layer.recv_buffer=bytearray()
        self.layer.context.layers.clear();self.io.close()

class TLSConfiguration:
    """Only client leaf certificates are injected by the reviewed launcher.
    Upstream chain + hostname verification is mandatory, even in fixtures.
    """
    def __init__(self,client_context,ca_file=None):
        self.client_context=client_context;self.ca_file=ca_file
    def start(self,data,client,host):
        if client:
            ctx=self.client_context(host)
        else:
            ctx=SSL.Context(SSL.TLS_CLIENT_METHOD)
            ctx.set_min_proto_version(SSL.TLS1_2_VERSION)
            if self.ca_file:ctx.load_verify_locations(self.ca_file)
            else:ctx.set_default_verify_paths()
            ctx.set_verify(SSL.VERIFY_PEER,lambda conn,cert,err,depth,ok:ok)
            ctx.set_alpn_protos([b'http/1.1'])
        ctx.set_options(SSL.OP_NO_COMPRESSION|SSL.OP_NO_TICKET|SSL.OP_NO_RENEGOTIATION)
        ctx.set_session_cache_mode(SSL.SESS_CACHE_OFF)
        conn=SSL.Connection(ctx,None)
        if client:conn.set_accept_state()
        else:
            conn.set_connect_state();name=host.encode('ascii');conn.set_tlsext_host_name(name)
            param=SSL._lib.SSL_get0_param(conn._ssl)
            SSL._lib.X509_VERIFY_PARAM_set_hostflags(param,0x4|0x20) # no partial wildcard, no CN fallback
            if SSL._lib.X509_VERIFY_PARAM_set1_host(param,name,len(name))!=1:raise Refused('BROWSER_TLS_HOST')
        data.ssl_conn=conn
