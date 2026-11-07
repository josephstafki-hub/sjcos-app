"""Dedicated mitmproxy 12.3.1 transport. Never attach to stock DumpMaster IO.

One accepted connection / one request / one drained response per flow. Explicit
close avoids keepalive/pipelining authority reuse. The root launcher supplies a
verified deployment predicate, root-peer UnixPolicy and client leaf CA factory.
No StreamReader, StreamWriter, HttpStream, flow store, protocol guessing or log.
"""
import os
import asyncio
import hashlib
import importlib.metadata
import json
import math
import socket
import struct
import fcntl
import time
from dataclasses import dataclass
from mitmproxy import connection, http, options
from mitmproxy.proxy import commands, events, server_hooks
from mitmproxy.proxy.context import Context
from mitmproxy.proxy.server import ConnectionHandler
from mitmproxy.proxy.layers.http import _hooks
from h11 import Data, EndOfMessage
from h11._receivebuffer import ReceiveBuffer
from parser_adapter import AllocationOwner, BoundedParser, RuntimeAdapter, Refused, HEADER, QUEUE, PAYLOAD
from transport_dns import FreshResolver, hostname, public_address
from transport_tls import TLSChannel

SO_COOKIE=57 # Linux uapi; missing kernel support fails closed.
# At most two terminal RPCs per flow, with both flows finalizing concurrently.
# Leave headroom under the launcher's 2s revoke bound, including control IPC.
TERMINAL_RPC_TIMEOUT=.4

def current_task():
    try:return asyncio.current_task()
    except RuntimeError:return None


def canonical_digest(method,url,headers,body_sha256):
    raw=json.dumps(dict(method=method,url=url,headers=headers,bodySha256=body_sha256),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()

def cookie(sock):
    return str(struct.unpack('=Q',sock.getsockopt(socket.SOL_SOCKET,SO_COOKIE,8))[0])

@dataclass
class Listener:
    sock: socket.socket
    binding: dict
    cookie: str
    address: tuple
    context: int
    active: bool=True

def validate_connect_headers(fields,authority):
    names=[k.lower() for k,v in fields]
    allowed={b'host',b'proxy-connection',b'user-agent'}
    if len(fields)>128 or len(set(names))!=len(names) or any(n not in allowed for n in names):raise Refused('BROWSER_CONNECT')
    values=dict((k.lower(),v) for k,v in fields)
    if values.get(b'host')!=authority.encode('ascii'):raise Refused('BROWSER_CONNECT')
    if b'proxy-connection' in values and values[b'proxy-connection'].lower() not in (b'keep-alive',b'close'):raise Refused('BROWSER_CONNECT')

class AsyncSocket:
    """Single scratch allocation, no concurrent receive/read-ahead/send queue.
    send() only hands bytes to the kernel. drain() waits for TCP acknowledgment.
    """
    def __init__(self,sock,remaining):
        self.sock=sock;sock.setblocking(False);self.remaining=remaining
        for option in (socket.SO_RCVBUF,socket.SO_SNDBUF):sock.setsockopt(socket.SOL_SOCKET,option,QUEUE//2)
        self.scratch=bytearray(QUEUE);self.max_queue=0
        self.bytes_read=0;self.bytes_written=0;self.pending_write=0
    async def read(self,maximum=QUEUE):
        if type(maximum)!=int or not 0<maximum<=QUEUE:raise Refused('BROWSER_QUEUE_LIMIT')
        left=self.remaining()
        n=await asyncio.wait_for(asyncio.get_running_loop().sock_recv_into(self.sock,memoryview(self.scratch)[:maximum]),left)
        if not n: return b''
        self.bytes_read+=n;self.max_queue=max(self.max_queue,n)
        return bytes(memoryview(self.scratch)[:n])
    async def exact(self,n):
        if not 0<n<=QUEUE:raise Refused('BROWSER_QUEUE_LIMIT')
        b=bytearray(n);used=0
        while used<n:
            part=await self.read(n-used)
            if not part:raise Refused('BROWSER_DISCONNECTED')
            b[used:used+len(part)]=part;used+=len(part)
        return bytes(b)
    async def write(self,data):
        if len(data)>QUEUE or self.pending_write:raise Refused('BROWSER_QUEUE_LIMIT')
        self.pending_write=len(data);self.max_queue=max(self.max_queue,len(data))
        view=memoryview(data);loop=asyncio.get_running_loop()
        try:
            while view:
                self.remaining()
                try:n=self.sock.send(view)
                except (BlockingIOError,InterruptedError):
                    ready=loop.create_future();fd=self.sock.fileno()
                    def writable():
                        if not ready.done():ready.set_result(None)
                    loop.add_writer(fd,writable)
                    try:await asyncio.wait_for(ready,self.remaining())
                    finally:loop.remove_writer(fd)
                    continue
                if n<=0:raise Refused('BROWSER_DISCONNECTED')
                self.bytes_written+=n;self.pending_write-=n;view=view[n:]
        finally:self.pending_write=0
    async def drain(self):
        handler=getattr(self,'handler',None)
        # Linux SIOCOUTQ includes unsent AND unacknowledged TCP bytes. A final
        # send() can succeed while a slow peer's receive window is still full.
        # Keep the response reservation through this bounded terminal wait.
        # TCP ACK proves network delivery, not the peer application's recv().
        while True:
            self.remaining()
            pending=struct.unpack('=i',fcntl.ioctl(self.sock,0x5411,struct.pack('=i',0)))[0]
            if handler is not None:
                handler.tail_pending=pending
                if pending and not getattr(handler,'tail_recorded',False):
                    handler.tail_recorded=True;handler.runtime.observe('outstanding_tcp_tail',handler,bytes=pending,bodyBytes=len(handler.flow.response.raw_content) if handler.flow.response else 0,reserved=handler.flow.id in handler.runtime.owner.flows)
            if pending==0:return
            await asyncio.sleep(min(.01,self.remaining()))
    def close(self):
        try:self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:pass
        self.sock.close();self.handler=None;self.scratch[:]=b'\0'*QUEUE

class TransportRuntime:
    owns_terminal_cleanup=True
    def __init__(self,policy,tls_config,verify_deployment,key,clock=time.monotonic,resolver=None):
        if not isinstance(key,bytes) or len(key)!=32:raise Refused()
        self.policy,self.tls_config,self.verify_deployment,self.clock=policy,tls_config,verify_deployment,clock
        self.owner=AllocationOwner(clock);self.resolver=resolver or FreshResolver(clock=clock)
        self.listeners={};self.generations={};self.handlers={};self.dead=False
        self.guards={};self.fetches={};self.accept_tasks={}
        self.event_sequence=0;self.event_log=[];self.dropped_events=0;self.case=None;self.fault=None
        self.adapter=RuntimeAdapter(self.owner,policy,self,verify_deployment,key)
        self.max_queue=0;self.max_handlers=0;self.terminal_error=False
    def attested(self):
        return (not self.dead and importlib.metadata.version('mitmproxy')=='12.3.1'
                and self.verify_deployment() is True and isinstance(self.owner,AllocationOwner)
                and all(type(h) is TransportHandler for h in self.handlers.values()))
    def bind_listener(self,sock,binding):
        if not self.attested() or sock.type!=socket.SOCK_STREAM or not sock.getsockopt(socket.SOL_SOCKET,socket.SO_ACCEPTCONN):raise Refused('BROWSER_LISTENER')
        required={'generation','guardId','contextId','taskId','bootId','targetId'}
        import re
        if set(binding)!=required or type(binding['generation'])!=int or binding['generation']<1 or any(not isinstance(binding[k],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}',binding[k]) for k in required-{'generation'}):raise Refused('BROWSER_BINDING')
        active=[x for x in self.listeners.values() if x.active]
        prior=self.generations.get(binding['contextId'],0)
        if binding['contextId'] not in self.generations and len(self.generations)>=64:raise Refused('BROWSER_GENERATION_LIMIT')
        if any(h.binding['contextId']==binding['contextId'] for h in self.handlers.values()) or len(active)>=2 or any(x.binding['contextId']==binding['contextId'] for x in active) or binding['generation']<=prior:raise Refused('BROWSER_GENERATION')
        c=cookie(sock)
        if c in self.listeners:raise Refused('BROWSER_LISTENER')
        context=next(n for n in (0,1) if all(x.context!=n for x in active))
        address=sock.getsockname()
        if any(h.listener.address==address for h in self.handlers.values()):raise Refused('BROWSER_CLOSE_PENDING')
        sock.setblocking(False)
        self.listeners[c]=Listener(sock,dict(binding),c,address,context)
        self.generations[binding['contextId']]=binding['generation']
        return c
    def observe(self,event,h=None,**fields):
        self.event_sequence+=1
        item=dict(seq=self.event_sequence,event=event,at=self.clock(),**fields)
        if h:item.update(id=h.flow.id,listenerCookie=h.listener.cookie,generation=h.listener.binding['generation'],targetId=h.binding['targetId'],requestDigest=getattr(h,'request_digest',None))
        if len(self.event_log)==512:self.event_log.pop(0);self.dropped_events+=1
        self.event_log.append(item)

    def fault_point(self,point,h):
        if self.fault is None or self.fault['point']!=point:return
        f=self.fault;self.fault=None;self.observe('fault',h,point=point,action=f['action'])
        if f['action']=='revoke_all':self.revoke_all()
        elif f['action']=='close_client':h.client_io.close()
        elif f['action']=='close_upstream' and h.upstream_io:h.upstream_io.close()
        if f['action']=='exit':os._exit(70) # explicit root-only abrupt-death fixture
        if f['action']=='dial_other_peer':
            h.context.server.address=('8.8.4.4',443)
            return # allow the real socket connect and getpeername comparison
        if f['action']=='raise':raise RuntimeError('BROWSER_INJECTED_FAILURE')
        raise Refused('BROWSER_INJECTED_FAILURE')

    def register_guard(self,c,guard_id,target_id):
        import re
        l=self.listeners.get(c)
        if l is None or not l.active or any(not isinstance(v,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}',v) for v in (guard_id,target_id)):raise Refused('BROWSER_GUARD')
        guards=self.guards.setdefault(c,{})
        if len(guards)>=16 and target_id not in guards:raise Refused('BROWSER_GUARD_LIMIT')
        if target_id in guards and guards[target_id]!=guard_id:raise Refused('BROWSER_GUARD')
        guards[target_id]=guard_id

    def register_fetch(self,c,digest,guard_id=None,target_id=None):
        import re
        l=self.listeners.get(c)
        if l is None or not l.active or c not in self.guards or c in self.fetches or not isinstance(digest,str) or not re.fullmatch('[a-f0-9]{64}',digest):raise Refused('BROWSER_FETCH')
        guard_id=guard_id or l.binding['guardId'];target_id=target_id or l.binding['targetId']
        if self.guards[c].get(target_id)!=guard_id:raise Refused('BROWSER_GUARD')
        self.fetches[c]=dict(requestDigest=digest,guardId=guard_id,targetId=target_id)

    def adopt(self,sock,listener_cookie):
        l=self.listeners.get(listener_cookie)
        if not self.attested() or l is None or not l.active or len(self.handlers)>=2 or any(h.listener is l for h in self.handlers.values()):raise Refused('BROWSER_BUFFER_BUSY')
        # getsockname + SO_COOKIE of the still-open listening FD ties this
        # accepted socket to a live generation; caller is only serve_listener.
        if sock.getsockname()!=l.address or cookie(l.sock)!=l.cookie or sock.family not in (socket.AF_INET,socket.AF_INET6):raise Refused('BROWSER_LISTENER')
        h=TransportHandler(self,sock,l);self.handlers[h.flow.id]=h
        self.max_handlers=max(self.max_handlers,len(self.handlers));self.observe('flow_open',h);return h
    async def serve_listener(self,listener_cookie):
        l=self.listeners[listener_cookie]
        tasks=set();self.accept_tasks[listener_cookie]=current_task()
        try:
            while l.active and not self.dead:
                sock,_=await asyncio.get_running_loop().sock_accept(l.sock)
                try:h=self.adopt(sock,listener_cookie)
                except BaseException:
                    self.observe('admission_refused',listenerCookie=listener_cookie)
                    sock.close();continue
                task=asyncio.create_task(h.run());tasks.add(task);task.add_done_callback(tasks.discard)
        finally:
            try:
                self.revoke_listener(listener_cookie)
                if tasks:await asyncio.gather(*tasks,return_exceptions=True)
            finally:self.accept_tasks.pop(listener_cookie,None)
    def handler(self,flow):
        h=self.handlers.get(flow.id if hasattr(flow,'id') else flow)
        if h is None or not h.listener.active or self.dead or cookie(h.listener.sock)!=h.listener.cookie:raise Refused('BROWSER_REVOKED')
        return h
    def remaining(self,flow):
        h=self.handler(flow);left=h.deadline-self.clock()
        if not math.isfinite(left) or left<=0:raise Refused('BROWSER_DEADLINE')
        return left
    def event_metadata(self,event,flow):
        h=self.handler(flow);l=h.listener
        meta=dict(v=1,event=event,id=flow.id,listener=l.address[1],listenerCookie=l.cookie,**h.binding,remainingMs=max(1,int(self.remaining(flow)*1000)))
        if h.hostname:meta['authority']=h.hostname+':443'
        if event in ('http_connect','requestheaders','request'):meta['guardCandidates']=[dict(targetId=t,guardId=g) for t,g in self.guards.get(l.cookie,{}).items()]
        h.policy_started=self.clock()
        if event in ('requestheaders','request'):
            r=flow.request
            h.validate_host(r.headers.get('host',''))
            meta.update(method=r.method,url=h.url,headers=h.request_headers,hostAuthority=r.headers['host'],sni=h.client.sni,dns=h.dns)
            if event=='request':meta.update(bodyBytes=len(r.raw_content),bodySha256=h.body_sha,requestDigest=h.request_digest)
        elif event=='responseheaders':meta.update(status=flow.response.status_code,headers=[[k.decode('ascii'),v.decode('latin1')] for k,v in flow.response.headers.fields])
        elif event=='response':meta.update(bodyBytes=len(flow.response.raw_content),bodySha256=hashlib.sha256(flow.response.raw_content).hexdigest())
        return meta
    def apply_verified(self,event,flow,result):
        h=self.handler(flow);self.remaining(flow)
        if not isinstance(result,dict) or result.get('ok') is not True or any(result.get(k)!=v for k,v in dict(event=event,id=flow.id,generation=h.listener.binding['generation'],listenerCookie=h.listener.cookie).items()):raise Refused('BROWSER_POLICY_BINDING')
        if event=='http_connect' and not self.guards.get(h.listener.cookie):raise Refused('BROWSER_GUARD')
        if event=='request':
            correlation=self.fetches.get(h.listener.cookie)
            if correlation is None or correlation['requestDigest']!=h.request_digest or result.get('guardId')!=correlation['guardId']:raise Refused('BROWSER_FETCH')
            h.binding.update(guardId=correlation['guardId'],targetId=correlation['targetId'])
        if result.get('guardId')!=h.binding['guardId']:raise Refused('BROWSER_POLICY_BINDING')
        if event=='request':
            if h.decision is not None or result.get('allow') is not True or result.get('requestDigest')!=h.request_digest or result.get('kind') not in ('read','write'):raise Refused('BROWSER_DECISION')
            duration=result.get('expiresInMs');pin=result.get('pin',{})
            if type(duration) not in (int,float) or not math.isfinite(duration) or not 0<duration<=2000 or not isinstance(result.get('decisionId'),str) or not 1<=len(result['decisionId'])<=120:raise Refused('BROWSER_DECISION')
            if pin.get('hostname')!=h.hostname or pin.get('address') not in h.dns['addresses'] or not public_address(pin.get('address','')):raise Refused('BROWSER_ADDRESS_BLOCKED')
            decision_deadline=min(h.deadline,h.policy_started+duration/1000,h.dns_deadline)
            if self.clock()>=decision_deadline:raise Refused('BROWSER_DECISION_EXPIRED')
            if result['kind']=='write':
                token=result.get('unknownToken')
                if result.get('consumed') is not True or not isinstance(token,str) or not 1<=len(token)<=1024:raise Refused('BROWSER_CONSUME')
                h.unknown_token=token;self.owner.consume(flow.id)
            self.fetches.pop(h.listener.cookie,None)
            h.decision=dict(result);h.decision_deadline=decision_deadline
        return True
    async def server_connect(self,data,policy):
        h=next((h for h in self.handlers.values() if h.client is data.client and h.context.server is data.server),None)
        if h is None:raise Refused('BROWSER_REVOKED')
        self.handler(h.flow);self.remaining(h.flow)
        if h.decision is None or self.clock()>=h.decision_deadline:raise Refused('BROWSER_DECISION_EXPIRED')
        # Use a worker only for bounded blocking TCP DNS; reservation retained.
        h.dns=await asyncio.to_thread(self.resolver.resolve,h.hostname,min(h.deadline,h.decision_deadline))
        self.handler(h.flow)
        h.dns_deadline=self.clock()+h.dns['ttlMs']/1000
        h.decision_deadline=min(h.decision_deadline,h.dns_deadline)
        address=h.decision['pin']['address']
        if address not in h.dns['addresses'] or not public_address(address) or self.clock()>=h.decision_deadline:raise Refused('BROWSER_DNS_REBIND')
        meta=self.event_metadata('server_connect',h.flow);meta.update(dns=h.dns,hostname=h.hostname,address=address)
        result=await asyncio.to_thread(policy.call,meta,min(self.remaining(h.flow),h.decision_deadline-self.clock()))
        self.apply_verified('server_connect',h.flow,result)
        data.server.address=(address,443);data.server.sni=h.hostname
        self.observe('connect_pin',h,address=address)
        return True
    async def server_connected(self,data,policy):
        h=next((h for h in self.handlers.values() if h.context.server is data.server and h.client is data.client),None)
        if h is None:raise Refused('BROWSER_REVOKED')
        self.handler(h.flow);self.remaining(h.flow)
        expected=h.decision['pin']['address']
        if not data.server.peername or data.server.peername[:2]!=(expected,443) or data.server.sni!=h.hostname or self.clock()>=h.decision_deadline:
            self.observe('peer_refused',h,expected=expected,actual=data.server.peername[0] if data.server.peername else None)
            raise Refused('BROWSER_PEER')
        meta=self.event_metadata('server_connected',h.flow);meta.update(dns=h.dns,hostname=h.hostname,peerAddress=expected)
        result=await asyncio.to_thread(policy.call,meta,min(self.remaining(h.flow),h.decision_deadline-self.clock()))
        answer=self.apply_verified('server_connected',h.flow,result)
        self.observe('peer_verified',h,address=expected)
        return answer
    def terminal_ack(self,h,event,result):
        return isinstance(result,dict) and result.get('ok') is True and all(result.get(k)==v for k,v in dict(event=event,id=h.flow.id,generation=h.binding['generation'],listenerCookie=h.listener.cookie,guardId=h.binding['guardId']).items())
    def terminal_call(self,h,event,meta):
        if h.terminal_results is None:return self.policy.call(meta,2)
        result=h.terminal_results[event]
        if isinstance(result,BaseException):raise result
        return result
    async def finish_async(self,h,success=False):
        # IO/TLS frames have unwound before we enter here. Cut first, then do
        # bounded terminal RPC off the control loop. No response/body drain is
        # allowed to delay revocation. Keep charges until local drop completes.
        h.close_sockets();h.terminal_results={}
        f=self.owner.flows.get(h.flow.id)
        events=['persist_unknown'] if not success and f and f.consumed and not f.unknown_attempted else []
        events.append('close_flow')
        for event in events:
            meta=h.terminal_metadata(event,**(dict(unknownToken=h.unknown_token) if event=='persist_unknown' else dict(success=success)))
            try:
                result=await asyncio.wait_for(asyncio.to_thread(self.policy.call,meta,TERMINAL_RPC_TIMEOUT),TERMINAL_RPC_TIMEOUT)
            except BaseException as error:result=error
            h.terminal_results[event]=result
        try:self.finish(h,success)
        except BaseException:
            self.terminal_error=True
            raise
    def persist_unknown(self,key):
        h=self.handlers.get(key)
        if h is None:raise Refused('BROWSER_UNKNOWN_LOST')
        # Works even AFTER generation revoke; never authorize a fresh action.
        meta=h.terminal_metadata('persist_unknown');meta['unknownToken']=h.unknown_token
        try:
            r=self.terminal_call(h,'persist_unknown',meta)
            if not self.terminal_ack(h,'persist_unknown',r) or r.get('durable') is not True:raise Refused('BROWSER_UNKNOWN_LOST')
        except BaseException:
            self.dead=True
            for l in self.listeners.values():l.active=False;l.sock.close()
            for other in self.handlers.values():other.close_sockets()
            raise
    def close_flow(self,key,success):
        h=self.handlers.get(key)
        if h is None:return not success
        if success and (not h.drained or h.client_io.pending_write):return False
        h.close_sockets()
        r=self.terminal_call(h,'close_flow',h.terminal_metadata('close_flow',success=success))
        if not self.terminal_ack(h,'close_flow',r):raise Refused('BROWSER_CLOSE_ACK')
        return True
    def finish(self,h,success=False):
        if self.handlers.get(h.flow.id) is not h:return
        try:
            if success:self.adapter.release(h.flow,True)
            else:self.adapter.release(h.flow,False)
        finally:
            try:h.drop()
            finally:
                self.observe('flow_closed',h,success=success,upstreamPlaintextBytes=h.upstream_plaintext_bytes,downstreamPlaintextBytes=h.downstream_plaintext_bytes,upstreamSocketBytes=h.upstream_io.bytes_written if h.upstream_io else 0,downstreamSocketBytes=h.client_io.bytes_written)
                self.owner.release_transport(h.flow.id)
                self.handlers.pop(h.flow.id,None)
    def revoke_listener(self,c):
        l=self.listeners.get(c)
        if l is None:return
        l.active=False;l.sock.close() # synchronous close ACK BEFORE any reuse
        self.observe('listener_closed',listenerCookie=c,generation=l.binding['generation'])
        error=None
        for h in tuple(self.handlers.values()):
            if h.listener is l:
                h.close_sockets()
                if h.task is not None and h.task is not current_task() and not h.task.done():
                    continue # keep BOTH body representations charged until unwind
                try:self.finish(h)
                except BaseException as exc:error=error or exc
        accept=self.accept_tasks.get(c)
        if accept and accept is not current_task():accept.cancel()
        self.listeners.pop(c,None);self.guards.pop(c,None);self.fetches.pop(c,None)
        if error:raise error
    def revoke_all(self):
        self.dead=True;error=None
        # Close ALL listeners before persistence (including slow/failed RPC).
        for l in self.listeners.values():l.active=False;l.sock.close()
        for h in tuple(self.handlers.values()):h.close_sockets()
        for c in tuple(self.listeners):
            try:self.revoke_listener(c)
            except BaseException as exc:error=error or exc
        if not self.handlers:
            try:self.owner.revoke_all()
            except BaseException as exc:error=error or exc
        if error:raise error
        return not self.handlers
    async def settled(self,listener_cookie=None):
        matching=[h for h in self.handlers.values() if listener_cookie is None or h.listener.cookie==listener_cookie]
        tasks={h.task for h in matching if h.task and h.task is not current_task()}
        tasks.update(t for c,t in self.accept_tasks.items() if (listener_cookie is None or c==listener_cookie) and t is not current_task())
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)
        if self.terminal_error:raise Refused('BROWSER_TERMINAL_UNCONFIRMED')
        if listener_cookie is not None:return not any(h.listener.cookie==listener_cookie for h in self.handlers.values())
        return not self.handlers and not self.owner.flows and not self.owner.transport_reservations

class TransportHandler(ConnectionHandler):
    def __init__(self,runtime,sock,listener):
        self.runtime,self.listener=runtime,listener
        self.binding=dict(listener.binding);self.upstream_plaintext_bytes=0;self.downstream_plaintext_bytes=0
        self.deadline=runtime.clock()+60;self.read_deadline=self.deadline
        client=connection.Client(peername=sock.getpeername(),sockname=sock.getsockname())
        client.state=connection.ConnectionState.OPEN
        self.context=Context(client,options.Options(http2=False,http3=False))
        super().__init__(self.context)
        self.flow=http.HTTPFlow(client,self.context.server,live=True)
        self.flow.request=None;self.flow.response=None
        runtime.owner.reserve_transport(self.flow.id)
        self.client_io=AsyncSocket(sock,self.io_remaining);self.client_io.handler=self;self.upstream_io=None
        self.client_tls=None;self.server_tls=None;self.drained=False;self.closed=False;self.task=None
        self.hostname=None;self.decision=None;self.decision_deadline=0;self.unknown_token=None
        self.terminal_results=None
        self.tail_pending=0;self.request_headers=None;self.url=None;self.dns=None;self.dns_deadline=self.deadline
    def io_remaining(self):
        left=min(self.deadline,self.read_deadline)-self.runtime.clock()
        if left<=0 or self.closed:raise Refused('BROWSER_DEADLINE')
        return left
    def terminal_metadata(self,event,**extra):
        return dict(v=1,event=event,id=self.flow.id,listener=self.listener.address[1],listenerCookie=self.listener.cookie,**self.binding,remainingMs=2000,**extra)
    async def handle_hook(self,hook):
        # These are actual mitmproxy hook objects. No addon exception swallowing,
        # asynchronous hook read-ahead, or flow mutation after authorization.
        self.runtime.observe('hook',self,name=hook.name)
        try:
            if isinstance(hook,(_hooks.HttpConnectHook,_hooks.HttpRequestHeadersHook,_hooks.HttpRequestHook,_hooks.HttpResponseHeadersHook,_hooks.HttpResponseHook)):
                # Bound the owning task as well as UnixPolicy's socket timeout;
                # a parked decision never gets the 60s body/response lifetime.
                remaining=min(2,self.runtime.remaining(self.flow))
                if await asyncio.wait_for(self.runtime.adapter.event(hook.name,self.flow),remaining) is not True:raise Refused('BROWSER_POLICY_DENIED')
            elif isinstance(hook,server_hooks.ServerConnectHook):
                await self.runtime.adapter.server_connect(hook.data)
            elif isinstance(hook,server_hooks.ServerConnectedHook):
                await self.runtime.adapter.server_connected(hook.data)
            else:raise Refused('BROWSER_HOOK')
        except asyncio.CancelledError:
            # Client abort / listener revoke is terminal for this connection.
            # Do not recursively cancel every other flow (or its cleanup).
            raise
        except BaseException:
            self.runtime.revoke_all()
            raise
    def validate_host(self,host):
        if host not in (self.hostname,self.hostname+':443') or self.client.sni!=self.hostname:raise Refused('BROWSER_HOST')
    async def read_head(self,io):
        b=bytearray(HEADER);used=0
        while True:
            data=await io.read(HEADER-used)
            if not data:raise Refused('BROWSER_DISCONNECTED')
            b[used:used+len(data)]=data;used+=len(data)
            end=b.find(b'\r\n\r\n',0,used)
            if end>=0:return bytes(memoryview(b)[:end+4]),bytes(memoryview(b)[end+4:used])
            if used==HEADER:raise Refused('BROWSER_HEADER_LIMIT')
    async def read_message(self,io,response):
        parser=BoundedParser(self.runtime.owner,self.flow.id,self.listener.context,response,self.flow.request if response else None)
        try:
            raw,prefix=await self.read_head(io)
            if not response:
                target=raw.split(b'\r\n',1)[0].split(b' ')[1]
                if not target.startswith(b'/') or target.startswith(b'//'):raise Refused('BROWSER_HOST')
            parser.begin(raw)
            f=self.runtime.owner.live(self.flow.id)
            f.deadline=min(f.deadline,self.deadline);f.body_deadline=min(f.body_deadline,self.deadline)
            if response:
                self.flow.response=parser.message
                await self.handle_hook(_hooks.HttpResponseHeadersHook(self.flow))
            else:
                self.flow.request=parser.message
                if self.hostname:
                    self.validate_host(parser.message.headers.get('host',''))
                    # HTTPS origin-form only; no absolute URL/tunnel ambiguity.
                    path=parser.message.path
                    if not path.startswith('/') or path.startswith('//') or '#' in path:raise Refused('BROWSER_HOST')
                    self.url='https://'+self.hostname+path
                    self.request_headers=[[k.decode('ascii').lower(),v.decode('latin1')] for k,v in parser.message.headers.fields if k.lower()!=b'accept-encoding']
                    self.request_headers.append(['accept-encoding','identity'])
                    self.dns=await asyncio.to_thread(self.runtime.resolver.resolve,self.hostname,min(self.deadline,f.body_deadline))
                    self.dns_deadline=self.runtime.clock()+self.dns['ttlMs']/1000
                    await self.handle_hook(_hooks.HttpRequestHeadersHook(self.flow))
            capacity=parser.size if parser.size is not None and parser.size>=0 else PAYLOAD
            parser.body=self.runtime.owner.allocate(self.flow.id,capacity,response)
            buf=ReceiveBuffer();data=prefix
            self.read_deadline=f.deadline if response else min(f.deadline,f.body_deadline)
            while True:
                self.runtime.owner.live(self.flow.id,body=not response)
                if len(data)+len(buf)>QUEUE:raise Refused('BROWSER_QUEUE_LIMIT')
                buf+=data
                while True:
                    event=parser.reader(buf)
                    if event is None:break
                    if isinstance(event,Data):
                        n=len(event.data)
                        if parser.received+n>capacity:raise Refused('BROWSER_BODY_LIMIT')
                        parser.body[parser.received:parser.received+n]=event.data;parser.received+=n
                    elif isinstance(event,EndOfMessage):
                        if event.headers or buf:raise Refused('BROWSER_PIPELINE')
                        parser._complete()
                        frozen=self.runtime.owner.freeze(self.flow.id,parser.body,response,parser.received)
                        parser.message.raw_content=frozen
                        self.read_deadline=self.deadline
                        return parser
                data=await io.read(QUEUE-len(buf))
                if not data:
                    eof=parser.reader.read_eof()
                    if not isinstance(eof,EndOfMessage) or buf:raise Refused('BROWSER_SHORT_BODY')
                    parser._complete();parser.message.raw_content=self.runtime.owner.freeze(self.flow.id,parser.body,response,parser.received)
                    self.read_deadline=self.deadline;return parser
        except BaseException:
            self.runtime.owner.release(self.flow.id);parser._drop();raise
    async def connect_request(self):
        raw,prefix=await self.read_head(self.client_io)
        if prefix:raise Refused('BROWSER_CONNECT')
        lines=raw[:-4].split(b'\r\n')
        try:
            r=http.Request.from_state(__import__('mitmproxy.net.http.http1',fromlist=['read_request_head']).read_request_head(lines).get_state())
            authority=r.authority
            if r.method!='CONNECT' or r.http_version!='HTTP/1.1' or not authority.endswith(':443'):raise Refused('BROWSER_CONNECT')
            self.hostname=hostname(authority[:-4])
            fields=r.headers.fields
            validate_connect_headers(fields,authority)
        except (ValueError,UnicodeError):raise Refused('BROWSER_CONNECT') from None
        self.flow.request=r
        await self.handle_hook(_hooks.HttpConnectHook(self.flow))
        if self.runtime.fault==dict(point='before_connect_reply',action='proxy407'):
            self.runtime.fault=None;self.runtime.observe('proxy_407',self)
            await self.client_io.write(b'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            raise Refused('BROWSER_PROXY_AUTH_REQUIRED')
        await self.client_io.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
        self.client_tls=TLSChannel(self.client_io,self.context,True,self.runtime.tls_config,self.hostname,self.deadline)
        await self.client_tls.handshake()
    async def open_connection(self,command):
        data=server_hooks.ServerConnectionHookData(client=self.client,server=self.context.server)
        await self.handle_hook(server_hooks.ServerConnectHook(data))
        self.read_deadline=min(self.deadline,self.decision_deadline)
        self.runtime.fault_point('before_dial',self) # root-only acceptance socket fault
        family=socket.AF_INET6 if ':' in self.context.server.address[0] else socket.AF_INET
        sock=socket.socket(family,socket.SOCK_STREAM)
        self.upstream_io=AsyncSocket(sock,self.io_remaining)
        await asyncio.wait_for(asyncio.get_running_loop().sock_connect(sock,self.context.server.address),min(self.io_remaining(),self.decision_deadline-self.runtime.clock()))
        self.context.server.peername=sock.getpeername();self.context.server.sockname=sock.getsockname();self.context.server.state=connection.ConnectionState.OPEN
        await self.handle_hook(server_hooks.ServerConnectedHook(data))
        self.server_tls=TLSChannel(self.upstream_io,self.context,False,self.runtime.tls_config,self.hostname,self.deadline)
        await self.server_tls.handshake()
        if self.runtime.clock()>=self.decision_deadline:raise Refused('BROWSER_DECISION_EXPIRED')
        self.read_deadline=self.deadline
    async def run(self):
        if self.runtime.handlers.get(self.flow.id) is not self:return
        self.task=current_task()
        success=False;monitor=None
        try:
            await self.connect_request()
            await self.read_message(self.client_tls,False)
            async def watch_client():
                try:await self.client_io.read(1)
                except asyncio.CancelledError:return
                except asyncio.TimeoutError:
                    # This observer shares the original deadline with parser
                    # IO. Let the owning operation report its timeout; racing
                    # it with cancellation hides BROWSER_DEADLINE/TimeoutError.
                    return
                except Exception:
                    if self.closed:return
                self.close_sockets()
            monitor=asyncio.create_task(watch_client())
            self.body_sha=hashlib.sha256(self.flow.request.raw_content).hexdigest()
            self.request_digest=canonical_digest(self.flow.request.method,self.url,self.request_headers,self.body_sha)
            self.runtime.fault_point('before_request_decision',self)
            await self.handle_hook(_hooks.HttpRequestHook(self.flow))
            self.runtime.fault_point('after_consume',self)
            self.runtime.fault_point('before_connect',self)
            await self.open_connection(commands.OpenConnection(self.context.server))
            self.runtime.fault_point('after_connect',self)
            self.runtime.handler(self.flow)
            self.read_deadline=min(self.deadline,self.decision_deadline)
            # Build only a bounded header; body is the attested frozen copy.
            request=self.flow.request
            head=(request.method+' '+request.path+' HTTP/1.1\r\n').encode('ascii')+b''.join(k.encode('ascii')+b': '+v.encode('latin1')+b'\r\n' for k,v in self.request_headers)+b'\r\n'
            if len(head)>HEADER:raise Refused('BROWSER_HEADER_LIMIT')
            await self.server_tls.write(head)
            self.upstream_plaintext_bytes+=len(head)
            await self.server_tls.write(request.raw_content)
            self.upstream_plaintext_bytes+=len(request.raw_content)
            self.read_deadline=self.deadline
            # No fresh writes can happen after this; only the admitted response.
            await self.read_message(self.server_tls,True)
            await self.handle_hook(_hooks.HttpResponseHook(self.flow))
            response=self.flow.response
            # Normalize framing AFTER complete bounded chunk/EOF collection.
            fields=[(k,v) for k,v in response.headers.fields if k.lower() not in (b'transfer-encoding',b'content-length',b'connection')]
            fields.extend([(b'content-length',str(len(response.raw_content)).encode()),(b'connection',b'close')])
            head=b'HTTP/1.1 '+str(response.status_code).encode()+b' '+response.data.reason+b'\r\n'+b''.join(k+b': '+v+b'\r\n' for k,v in fields)+b'\r\n'
            if len(head)>HEADER:raise Refused('BROWSER_HEADER_LIMIT')
            self.runtime.fault_point('before_drain',self)
            self.runtime.owner.response_complete(self.flow.id)
            self.runtime.observe('response_buffered',self,bodyBytes=len(response.raw_content))
            await self.client_tls.write(head)
            await self.client_tls.write(response.raw_content)
            await self.client_io.drain()
            self.downstream_plaintext_bytes=len(head)+len(response.raw_content)
            self.runtime.observe('drained',self,bytes=self.downstream_plaintext_bytes)
            self.drained=True;success=True
        except Refused as error:
            import re
            reason=str(error)
            self.runtime.observe('refused',self,reason=reason if re.fullmatch('BROWSER_[A-Z_]{1,80}',reason) else 'BROWSER_REFUSED')
        except (OSError,asyncio.TimeoutError,asyncio.CancelledError) as error:
            self.runtime.observe('socket_closed',self,reason=type(error).__name__)
        except BaseException:
            self.runtime.revoke_all() # unexpected dispatcher/parser failure is boot fatal
        finally:
            try:
                if monitor:
                    monitor.cancel();await asyncio.gather(monitor,return_exceptions=True)
            finally:
                # A second cancellation can interrupt the monitor join. Join
                # shielded terminal work before the owner task can settle.
                if self.flow.id in self.runtime.handlers:
                    finalizer=asyncio.create_task(self.runtime.finish_async(self,success))
                    # Repeated cancellation must not detach terminal cleanup or
                    # let settled() ACK while body representations remain live.
                    while not finalizer.done():
                        try:await asyncio.shield(finalizer)
                        except asyncio.CancelledError:continue
                        except BaseException:break
                    try:finalizer.result()
                    except BaseException:self.runtime.revoke_all()
    def close_sockets(self):
        was_closed=self.closed
        self.closed=True
        if not was_closed and self.task is not None and self.task is not current_task() and not self.task.done():self.task.cancel()
        self.client_io.close()
        if self.upstream_io:self.upstream_io.close()
    def drop(self):
        self.close_sockets()
        if self.server_tls:self.upstream_plaintext_bytes=self.server_tls.plaintext_written
        if self.client_tls:self.downstream_plaintext_bytes=self.client_tls.plaintext_written
        self.runtime.max_queue=max(self.runtime.max_queue,self.client_io.max_queue,self.upstream_io.max_queue if self.upstream_io else 0)
        for tls in (self.client_tls,self.server_tls):
            if tls:tls.close()
        if self.flow.request:self.flow.request.raw_content=None
        if self.flow.response:self.flow.response.raw_content=None
        self.flow.request=None;self.flow.response=None
        self.flow.live=False
        self.context.layers.clear();self.request_headers=None;self.decision=None;self.dns=None;self.unknown_token=None
        self.layer=None;self.transports.clear();self.task=None;self.terminal_results=None

def create_runtime(policy,tls_config,verify_deployment,key,*,denied_addresses=()):
    runtime=TransportRuntime(policy,tls_config,verify_deployment,key,resolver=FreshResolver(denied_addresses))
    if not runtime.adapter.attested():raise Refused('BROWSER_RUNTIME_UNATTESTED')
    return runtime

if __name__=='__main__':
    from transport_control import main
    main()
