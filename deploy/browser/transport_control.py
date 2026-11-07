"""Root-authorized candidate transport process; no release/acceptance shortcut.
Raw bounded Unix control IO, uid-0 peer required. No HTTP/Unix authority from
untrusted browser traffic. All config/source/CA inputs are root protected.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import struct
import time
from OpenSSL import SSL
from parser_adapter import Refused, UnixPolicy, HEADER
from transport_tls import TLSConfiguration

SOURCES=('parser_adapter.py','transport_runtime.py','transport_tls.py','transport_dns.py','transport_control.py','egress_gate.py','closed_dispatcher.py')

def protected(path,maximum=HEADER):
    p=Path(path)
    if not p.is_absolute() or p.is_symlink():raise Refused('BROWSER_CONFIG_PATH')
    for parent in (p,*p.parents):
        st=parent.lstat()
        if st.st_uid!=0 or st.st_mode & 0o022 or stat.S_ISLNK(st.st_mode):raise Refused('BROWSER_CONFIG_OWNER')
    with p.open('rb') as f:
        b=f.read(maximum+1)
    if len(b)>maximum:raise Refused('BROWSER_CONFIG_LIMIT')
    return b

def load_config(path):
    raw=protected(path);c=json.loads(raw)
    required={'controlSocket','policySocket','listenHost','listenPorts','clientCert','clientKey','upstreamCa','sourceHashes','deniedAddresses'}
    if not isinstance(c,dict) or set(c)!=required or c['listenPorts']!=[18081,18082] or c['listenHost']!='10.203.0.2':raise Refused('BROWSER_CONFIG')
    for k in ('controlSocket','policySocket'):
        p=Path(c[k])
        if not str(p).startswith('/run/sjcos-browser/') or len(str(p))>100:raise Refused('BROWSER_CONFIG_PATH')
        # Root config must allocate a private run directory. The dedicated gate
        # may own it, but it must not be writable by any group/other user.
        st=p.parent.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid not in (0,os.getuid()) or st.st_mode & 0o022 or p.parent.is_symlink():raise Refused('BROWSER_CONFIG_OWNER')
    if set(c['sourceHashes'])!=set(SOURCES):raise Refused('BROWSER_SOURCE_PIN')
    base=Path(__file__).resolve().parent
    def verify():
        try:
            if protected(path)!=raw:return False
            return all(hashlib.sha256(protected(str(base/name),1024*1024)).hexdigest()==c['sourceHashes'][name] for name in SOURCES)
        except (OSError,Refused):return False
    if not verify():raise Refused('BROWSER_SOURCE_PIN')
    for k in ('clientCert','clientKey','upstreamCa'):
        if c[k] is not None:protected(c[k],32768 if k=='clientCert' else 65536)
    if not c['clientCert'] or not c['clientKey']:raise Refused('BROWSER_TLS_CONFIG')
    return c,verify

class ControlServer:
    def __init__(self,runtime,host,ports):
        self.runtime,self.host,self.ports=runtime,host,ports;self.tasks={};self.dead=False
    async def dispatch(self,x):
        if not isinstance(x,dict):raise Refused('BROWSER_CONTROL')
        op=x.get('op')
        if op=='bind':
            if set(x)!={'op','port','binding'} or type(x['port'])!=int or x['port'] not in self.ports:raise Refused('BROWSER_CONTROL')
            sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
            try:
                # A fresh per-case gate rebinds the same port while the previous boot's closed
                # connections sit in TIME_WAIT. SO_REUSEADDR only skips TIME_WAIT on Linux; it never
                # lets two live listeners share the port.
                sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                sock.bind((self.host,x['port']));sock.listen(2)
                cookie=self.runtime.bind_listener(sock,x['binding'])
            except BaseException:sock.close();raise
            task=asyncio.create_task(self.runtime.serve_listener(cookie));self.tasks[cookie]=task
            return dict(ok=True,listenerCookie=cookie,generation=x['binding']['generation'])
        if op in ('guard','fetch','revoke'):
            c=x.get('listenerCookie');l=self.runtime.listeners.get(c)
            if l is None or x.get('generation')!=l.binding['generation']:raise Refused('BROWSER_GENERATION')
            if op=='guard':self.runtime.register_guard(c,x.get('guardId'),x.get('targetId'))
            elif op=='fetch':self.runtime.register_fetch(c,x.get('requestDigest'),x.get('guardId'),x.get('targetId'))
            else:
                self.runtime.revoke_listener(c)
                task=self.tasks.pop(c,None)
                if task:task.cancel();await asyncio.gather(task,return_exceptions=True)
                await self.runtime.settled(c)
            return dict(ok=True,closed=op=='revoke',durable=True)
        if op=='revoke_all':
            self.runtime.revoke_all() # keep root-only terminal stats available until process shutdown
            for task in self.tasks.values():task.cancel()
            await asyncio.gather(*self.tasks.values(),return_exceptions=True);self.tasks.clear()
            await self.runtime.settled()
            return dict(ok=True,closed=True,durable=True)
        if op=='case_begin':
            import re
            if self.runtime.case is not None or self.runtime.handlers or not isinstance(x.get('name'),str) or not re.fullmatch('[a-z0-9-]{1,80}',x['name']):raise Refused('BROWSER_CASE')
            self.runtime.case=x['name'];self.runtime.event_log.clear();self.runtime.dropped_events=0
            return dict(ok=True,startSequence=self.runtime.event_sequence)
        if op=='fault_arm':
            if self.runtime.case is None or x.get('point') not in ('before_connect_reply','before_request_decision','after_consume','before_connect','before_dial','after_connect','before_drain') or x.get('action') not in ('revoke_all','close_client','close_upstream','raise','dial_other_peer','exit','proxy407'):raise Refused('BROWSER_FAULT')
            self.runtime.fault=dict(point=x['point'],action=x['action']);return dict(ok=True)
        if op in ('events','events_drain','case_end'):
            result=dict(ok=True,events=list(self.runtime.event_log),droppedEvents=self.runtime.dropped_events,lastSequence=self.runtime.event_sequence)
            if op=='events_drain':self.runtime.event_log.clear();self.runtime.dropped_events=0
            if op=='case_end':
                result['name']=self.runtime.case;self.runtime.case=None;self.runtime.fault=None
                result['stats']=await self.dispatch(dict(op='stats'))
            return result
        if op=='stats':
            r=self.runtime
            queues=[r.max_queue]+[io.max_queue for h in r.handlers.values() for io in (h.client_io,h.upstream_io) if io]
            return dict(ok=True,flows=len(r.owner.flows),handlers=len(r.handlers),reservations=len(r.owner.transport_reservations),pools=r.owner.pools,maxima=r.owner.maxima,maxResponseSlots=r.owner.max_slots,activeResponseSlots=len(r.owner.flows),maxHandlers=r.max_handlers,maxDirectionalQueueBytes=max(queues),listeners=len(r.listeners),dead=r.dead)
        raise Refused('BROWSER_CONTROL')
    async def serve(self,path):
        from transport_runtime import AsyncSocket
        # Never unlink an existing socket or another run's file.
        sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        sock.bind(path);os.chmod(path,0o600);sock.listen(2);sock.setblocking(False)
        inode=os.lstat(path).st_ino
        try:
            while not self.dead:
                peer,_=await asyncio.get_running_loop().sock_accept(sock)
                io=AsyncSocket(peer,lambda:2)
                try:
                    UnixPolicy(path).verify_peer(peer)
                    n,=struct.unpack('!I',await io.exact(4))
                    if not 0<n<=HEADER:raise Refused('BROWSER_CONTROL_LIMIT')
                    x=json.loads(await io.exact(n));result=await self.dispatch(x)
                    raw=json.dumps(result,separators=(',',':'),allow_nan=False).encode()
                    if len(raw)>HEADER:raise Refused('BROWSER_CONTROL_LIMIT')
                    await io.write(struct.pack('!I',len(raw))+raw)
                except asyncio.CancelledError:
                    self.runtime.revoke_all();raise
                except Exception as error:
                    self.runtime.revoke_all()
                    # Root-only socket: return the fixed Refused code (never exception text) for diagnostics.
                    code=error.args[0] if isinstance(error,Refused) and error.args and isinstance(error.args[0],str) and error.args[0].isupper() else None
                    raw=json.dumps(dict(ok=False,code=code[:60]) if code else dict(ok=False),separators=(',',':')).encode()
                    try:await io.write(struct.pack('!I',len(raw))+raw)
                    except Exception:pass
                finally:io.close()
        finally:
            sock.close();self.runtime.revoke_all()
            if os.path.exists(path) and os.lstat(path).st_ino==inode:os.unlink(path)

async def run(c,verify):
    from transport_runtime import create_runtime
    def leaf(host):
        ctx=SSL.Context(SSL.TLS_SERVER_METHOD);ctx.set_min_proto_version(SSL.TLS1_2_VERSION)
        ctx.use_certificate_chain_file(c['clientCert']);ctx.use_privatekey_file(c['clientKey']);ctx.check_privatekey()
        ctx.set_alpn_select_callback(lambda conn,offers:b'http/1.1')
        return ctx
    r=create_runtime(UnixPolicy(c['policySocket']),TLSConfiguration(leaf,c['upstreamCa']),verify,os.urandom(32),denied_addresses=c['deniedAddresses'])
    control=ControlServer(r,c['listenHost'],c['listenPorts'])
    task=asyncio.current_task();loop=asyncio.get_running_loop()
    for sig in (signal.SIGTERM,signal.SIGINT):loop.add_signal_handler(sig,task.cancel)
    try:await control.serve(c['controlSocket'])
    finally:
        r.revoke_all()
        for task in control.tasks.values():task.cancel()
        await asyncio.gather(*control.tasks.values(),return_exceptions=True)
        await r.settled()

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);args=p.parse_args()
    try:
        c,verify=load_config(args.config);asyncio.run(run(c,verify))
    except BaseException:
        # Stable content-free terminal error, never expose keys, headers or body.
        raise SystemExit('BROWSER_TRANSPORT_STOPPED') from None
