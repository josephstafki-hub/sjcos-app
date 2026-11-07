#!/usr/bin/python3
"""Production-only adapter over EXACT pinned transport_*.py; no DumpMaster.
Policy is the nonroot controller's D phase:1 read authority. No fault RPCs.
Two body slots are stricter than the 128/32/8 admission ceilings.
"""
import asyncio, hashlib, importlib.metadata, json, os, pathlib, pwd, signal, socket, stat, struct, sys
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from transport_control import ControlServer, LifetimePolicy, watch_controller_death, supervise_policy, protected, SOURCES
from transport_runtime import create_runtime, AsyncSocket, TransportHandler
from transport_tls import TLSConfiguration
from parser_adapter import Refused, HEADER, UnixPolicy
from OpenSSL import SSL, crypto

LIMITS=dict(connections=128,task_connections=32,task_upstreams=8,connect_seconds=10,headers_seconds=30,flow_seconds=60)
def install_deadlines():
    # Keep the EXACT attested TransportHandler class; wrap only ingress header
    # waits, never parser/IO/allocation/dispatch. Deadlines derive from original
    # accept time; no refreshed budget after a partial read or TLS handshake.
    connect=TransportHandler.connect_request
    read_head=TransportHandler.read_head
    async def connect_request(self):
        self.accepted_at=self.deadline-60
        self.read_deadline=min(self.deadline,self.accepted_at+10)
        await asyncio.wait_for(connect(self),max(.001,self.accepted_at+10-self.runtime.clock()))
        self.read_deadline=min(self.deadline,self.accepted_at+30)
    async def head(self,io):
        prior=self.read_deadline
        self.read_deadline=min(prior,self.deadline-60+30)
        try:return await read_head(self,io)
        finally:self.read_deadline=prior
    TransportHandler.connect_request=connect_request
    TransportHandler.read_head=head

class ProductionControl(ControlServer):
    async def dispatch(self,x):
        if not isinstance(x,dict) or x.get('op') not in ('bind','guard','fetch','revoke','revoke_all','stats'):raise Refused('BROWSER_CONTROL')
        return await super().dispatch(x)
    async def serve(self,path):
        sock=socket.socket(socket.AF_UNIX);sock.bind(path);os.chmod(path,0o660);sock.listen(8);sock.setblocking(False)
        try:
            while not self.dead and not self.runtime.dead:
                peer,_=await asyncio.get_running_loop().sock_accept(sock)
                io=AsyncSocket(peer,lambda:2)
                try:
                    UnixPolicy(path,peer_uid=pwd.getpwnam('sjcos-browser-controller').pw_uid).verify_peer(peer)
                    n,=struct.unpack('!I',await io.exact(4))
                    if not 0<n<=HEADER:raise Refused('BROWSER_CONTROL')
                    result=await self.dispatch(json.loads(await io.exact(n)))
                    raw=json.dumps(result,separators=(',',':')).encode()
                    if len(raw)>HEADER:raise Refused('BROWSER_CONTROL')
                    await io.write(struct.pack('!I',len(raw))+raw)
                except asyncio.CancelledError:raise
                except Exception:
                    self.runtime.revoke_all()
                    try:await io.write(struct.pack('!I',12)+b'{"ok":false}')
                    except Exception:pass
                finally:io.close()
        finally:sock.close();self.runtime.revoke_all();os.unlink(path)

def leaf_factory(ca_pem,key_pem):
    ca=crypto.load_certificate(crypto.FILETYPE_PEM,ca_pem);key=crypto.load_privatekey(crypto.FILETYPE_PEM,key_pem)
    cache={}
    def leaf(host):
        from transport_dns import hostname
        hostname(host)
        if host in cache:return cache[host]
        # bounded cache, never persist leaf keys/certificates
        if len(cache)>=8:cache.pop(next(iter(cache)))
        k=crypto.PKey();k.generate_key(crypto.TYPE_RSA,2048)
        cert=crypto.X509();cert.set_version(2);cert.set_serial_number(int.from_bytes(os.urandom(16),'big'))
        cert.get_subject().CN=host;cert.set_issuer(ca.get_subject());cert.set_pubkey(k)
        cert.gmtime_adj_notBefore(-60);cert.gmtime_adj_notAfter(3600)
        cert.add_extensions([crypto.X509Extension(b'subjectAltName',False,('DNS:'+host).encode())]);cert.sign(key,'sha256')
        ctx=SSL.Context(SSL.TLS_SERVER_METHOD);ctx.set_min_proto_version(SSL.TLS1_2_VERSION);ctx.use_certificate(cert);ctx.use_privatekey(k);ctx.check_privatekey();ctx.set_alpn_select_callback(lambda conn,offers:b'http/1.1');cache[host]=ctx;return ctx
    return leaf

async def main():
    if os.geteuid()!=pwd.getpwnam('sjcos-browser-gate').pw_uid or os.geteuid()==0 or importlib.metadata.version('mitmproxy')!='12.3.1':raise Refused('BROWSER_GATE_IDENTITY')
    if os.readlink('/proc/self/ns/net')==os.readlink('/proc/1/ns/net') or os.stat('/proc/self/ns/net').st_ino!=os.stat('/run/netns/sjcos-browser-gate').st_ino:raise Refused('BROWSER_GATE_NAMESPACE')
    raw=protected('/etc/sjcos-browser/phase1-gate.json');c=json.loads(raw)
    if set(c)!= {'sourceHashes','deniedAddresses'} or set(c['sourceHashes'])!=set(SOURCES) or not c['deniedAddresses']:raise Refused('BROWSER_GATE_CONFIG')
    base=pathlib.Path(__file__).parent
    def verify():
        return protected('/etc/sjcos-browser/phase1-gate.json')==raw and all(hashlib.sha256(protected(str(base/n),1024*1024)).hexdigest()==h for n,h in c['sourceHashes'].items())
    if not verify():raise Refused('BROWSER_SOURCE_PIN')
    controller=pwd.getpwnam('sjcos-browser-controller').pw_uid
    if controller in (0,998):raise Refused('BROWSER_GATE_IDENTITY')
    policy=LifetimePolicy('/run/sjcos-browser-runtime/gate-policy.sock',peer_uid=controller)
    # Gate starts before controller; a bounded startup wait, no listener yet.
    for attempt in range(100):
        try:await asyncio.to_thread(policy.call,dict(event='liveness'),.4);break
        except (OSError,Refused):
            if attempt==99:raise
            await asyncio.sleep(.1)
    credential=pathlib.Path(os.environ['CREDENTIALS_DIRECTORY'])/'ca-key'
    st=credential.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077:raise Refused('BROWSER_GATE_CREDENTIAL')
    leaf=leaf_factory(protected('/etc/sjcos-browser/ca-public.pem'),credential.read_bytes())
    install_deadlines()
    runtime=create_runtime(policy,TLSConfiguration(leaf,None),verify,os.urandom(32),denied_addresses=c['deniedAddresses'])
    # Pinned transport has at most TWO admitted flows (one per task), one upstream
    # per flow. Thus 2<=128, 1<=32 and 1<=8; no unbounded waiting connections.
    control=ProductionControl(runtime,'10.203.0.2',[18081,18082])
    tasks=[asyncio.create_task(supervise_policy(runtime,policy)),asyncio.create_task(watch_controller_death(runtime,policy))]
    current=asyncio.current_task()
    for sig in (signal.SIGTERM,signal.SIGINT):asyncio.get_running_loop().add_signal_handler(sig,current.cancel)
    try:await control.serve('/run/sjcos-browser-gate/control.sock')
    finally:
        runtime.revoke_all()
        for t in tasks:t.cancel()
        for t in control.tasks.values():t.cancel()
        await asyncio.gather(*tasks,*control.tasks.values(),return_exceptions=True)
        try:await runtime.settled()
        finally:policy.close()
if __name__=='__main__':
    try:asyncio.run(main())
    except BaseException:raise SystemExit('BROWSER_PRODUCTION_GATE_STOPPED') from None
