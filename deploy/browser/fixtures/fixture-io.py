#!/opt/sjcos-browser/py/bin/python
"""Bounded disposable TLS origin, raw TLS client and cgroup exec trampoline.
No import starts IO. Origin logs only request digests, framing and secret flags.
"""
import hashlib,json,os,socket,ssl,struct,sys,threading,time,signal,re
from pathlib import Path

def emit(file,value):
    line=json.dumps(value,separators=(',',':'))+'\n'
    with open(file,'a') as f:
        if f.tell()>1048576: raise RuntimeError('ORIGIN_LOG_LIMIT')
        f.write(line);f.flush()

def origin(config):
    ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(config['cert'],config['key'])
    listener=socket.socket();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(('0.0.0.0',443));listener.listen(8)
    slots=threading.BoundedSemaphore(8)
    def serve(raw):
        try:
            raw.settimeout(65)
            with ctx.wrap_socket(raw,server_side=True) as s:
                head=bytearray()
                while b'\r\n\r\n' not in head:
                    chunk=s.recv(1)
                    if not chunk:return
                    head.extend(chunk)
                    if len(head)>32768:raise RuntimeError('HEAD_LIMIT')
                lines=bytes(head).split(b'\r\n');method,path,_=lines[0].decode('ascii').split(' ')
                headers={k.lower():v.strip() for k,v in (r.split(b':',1) for r in lines[1:] if b':' in r)}
                size=int(headers.get(b'content-length',b'0'));digest=hashlib.sha256()
                if size>25*1048576:raise RuntimeError('BODY_LIMIT')
                while size:
                    chunk=s.recv(min(65536,size))
                    if not chunk:return
                    size-=len(chunk);digest.update(chunk)
                projection={'method':method,'url':'https://'+headers[b'host'].decode('ascii').removesuffix(':443')+path,'headers':[[k.decode('ascii').lower(),v.strip().decode('latin1')] for k,v in (r.split(b':',1) for r in lines[1:] if b':' in r)],'bodySha256':digest.hexdigest()}
                request_digest=hashlib.sha256(json.dumps(projection,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
                emit(config['log'],dict(method=method,path=path,requestDigest=request_digest,headSha256=hashlib.sha256(head).hexdigest(),bodySha256=digest.hexdigest(),secret=any(k in headers for k in [b'authorization',b'proxy-authorization',b'cookie']),bytes=len(head)+int(headers.get(b'content-length',b'0'))))
                mode=path.split('/')[-1]
                status=401 if mode=='origin-401-no-secret' else 407 if mode=='proxy-407' else 200
                extra=b'WWW-Authenticate: Basic realm="fixture"\r\n' if status==401 else b'Proxy-Authenticate: Basic realm="fixture"\r\n' if status==407 else b''
                if mode in ('two-25MiB-slow-readers','two-contexts-eight-candidates','fair-contention-completion','preallocation-backpressure','disconnect-finally','declared-length'):length=25*1048576
                elif mode=='oversize-body':length=25*1048576+1
                else:length=256
                if mode=='compressed-bomb-no-decode':
                    import gzip
                    payload=gzip.compress(b'x'*1048576);length=len(payload);extra+=b'Content-Encoding: gzip\r\n'
                else:payload=None
                if mode=='chunked-response':extra+=b'Transfer-Encoding: chunked\r\n'
                elif mode!='unknown-length':extra+=b'Content-Length: '+str(length).encode()+b'\r\n'
                s.sendall(b'HTTP/1.1 '+str(status).encode()+b' Fixture\r\n'+extra+b'Content-Type: text/html\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n')
                if mode=='slow-body-deadline':time.sleep(61);return
                if mode=='short-body':s.sendall(b'short');return
                if mode=='chunked-response':s.sendall(b'4\r\ntest\r\n0\r\n\r\n');return
                if payload:s.sendall(payload);return
                block=b'<!doctype html><title>fixture</title><link rel="icon" href="data:,">'.ljust(65536,b' ')
                while length:
                    n=min(65536,length);s.sendall(block[:n]);length-=n
                # An EOF-delimited body must end with a TLS close_notify; a bare TCP close is truncation-ambiguous
                # and the gate correctly refuses it. Python's SSLSocket.close() never sends close_notify, so unwrap().
                if mode=='unknown-length':
                    try:s.unwrap()
                    except (OSError,ssl.SSLError):pass
        except (OSError,ValueError):pass
        finally:raw.close();slots.release()
    Path(config['ready']).write_text('ready')
    while True:
        s,_=listener.accept()
        if not slots.acquire(False):s.close();continue
        threading.Thread(target=serve,args=(s,),daemon=True).start()

def request(c):
    result={'connected':False,'tls':False,'received':0,'responseSha256':None,'bodyBytes':0,'bodySha256':None,'complete':False};s=None
    try:
        s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,8192);s.settimeout(c.get('timeout',65));s.connect(('10.203.0.2',c.get('port',18081)));result['connected']=True
        h=c.get('connectHost',c['host']);s.sendall(('CONNECT '+h+':443 HTTP/1.1\r\nHost: '+h+':443\r\n\r\n').encode());head=bytearray()
        while b'\r\n\r\n' not in head:
            b=s.recv(1)
            if not b:raise OSError('connect closed')
            head.extend(b)
            if len(head)>32768:raise OSError('head limit')
        context=ssl.create_default_context(cafile=c['ca']);s=context.wrap_socket(s,server_hostname=c.get('sni',c['host']));result['tls']=True
        body=b'fixture-write' if c.get('method')=='POST' else b'';body_size=c.get('bodyBytes',len(body))
        headers='Host: '+c.get('headerHost',c['host'])+'\r\nAccept-Encoding: identity\r\n'+('Content-Length: '+str(body_size)+'\r\n' if body else '')
        s.sendall((c.get('method','GET')+' '+c['path']+' HTTP/1.1\r\n'+headers+'\r\n').encode())
        if c.get('bodyBytes'):
            block=b'x'*65536;left=body_size
            while left:
                n=min(left,len(block));s.sendall(block[:n]);left-=n
        elif body:s.sendall(body)
        if c.get('sentReady'):Path(c['sentReady']).write_text('sent')
        if c.get('readRelease'):
            end=time.monotonic()+55
            while not Path(c['readRelease']).exists():
                if time.monotonic()>end:raise OSError('read release timeout')
                time.sleep(.02)
        if c.get('hold'):time.sleep(c['hold'])
        if c.get('abort'):return result
        digest=hashlib.sha256();body_digest=hashlib.sha256();head=bytearray();declared=None
        while True:
            b=s.recv(65536)
            if not b:break
            result['received']+=len(b);digest.update(b)
            if declared is None:
                head.extend(b)
                at=head.find(b'\r\n\r\n')
                if at<0:
                    if len(head)>32768:raise RuntimeError('RESPONSE_HEAD_LIMIT')
                    continue
                fields=bytes(head[:at]).split(b'\r\n');status=fields[0].split(b' ')
                if len(status)<2 or status[1]!=b'200':raise OSError('response status')
                lengths=[v.strip() for k,v in (r.split(b':',1) for r in fields[1:]) if k.lower()==b'content-length']
                if len(lengths)!=1 or not lengths[0].isdigit():raise OSError('response framing')
                declared=int(lengths[0]);result['declaredBodyBytes']=declared
                b=bytes(head[at+4:]);head.clear()
            result['bodyBytes']+=len(b);body_digest.update(b)
            if result['received']>26*1048576:raise RuntimeError('RESPONSE_LIMIT')
            if c.get('second'):
                s.sendall(b'GET /unauthorized HTTP/1.1\r\nHost: fixture.example\r\n\r\n');c['second']=False
        result['responseSha256']=digest.hexdigest();result['bodySha256']=body_digest.hexdigest();result['complete']=declared is not None and result['bodyBytes']==declared
    except (OSError,ssl.SSLError) as e:result['closed']=type(e).__name__
    finally:
        if s:s.close()
    return result

def probe(c):
    s=socket.socket(socket.AF_INET6 if c.get('family')==6 else socket.AF_INET,socket.SOCK_DGRAM if c.get('udp') else socket.SOCK_STREAM);s.settimeout(.4);result={'connected':False,'sent':0}
    try:
        if c.get('udp'):result['sent']=s.sendto(b'SJC_UNAUTHORIZED_PACKET',(c['host'],c['port']))
        else:s.connect((c['host'],c['port']));result['connected']=True;result['sent']=s.send(b'GET /SJC_UNAUTHORIZED_PACKET HTTP/1.1\r\nHost: forbidden.example\r\n\r\n')
    except OSError:pass
    finally:s.close()
    return result

def supervise_browser(argv):
    # Independent parent, private lifetime pipe. EOF/SIGKILL of the JS controller
    # cannot bypass cleanup. Chromium remains nonroot and in its own process group.
    import subprocess,select
    uid,gid=int(argv[0]),int(argv[1])
    def identity():
        os.setsid();os.setgroups([]);os.setgid(gid);os.setuid(uid)
    child=subprocess.Popen(argv[2:],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=None,preexec_fn=identity)
    print(json.dumps({'browserPid':child.pid}),flush=True)
    try:
        while child.poll() is None:
            readable,_,_=select.select([sys.stdin.buffer],[],[],.1)
            if readable:
                if not os.read(sys.stdin.fileno(),1):break
                raise RuntimeError('INVALID_LIFETIME_PIPE')
    finally:
        try:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        child.wait(timeout=2)
    return child.returncode

def main():
    mode=sys.argv[1]
    if mode=='supervise-browser':
        supervise_browser(sys.argv[2:]);return
    if mode=='kill-netns':
        namespace,pid=sys.argv[2:];pid=int(pid)
        if os.geteuid()!=0 or not re.fullmatch('b0b-[a-f0-9]{8}-[bgf]',namespace):raise RuntimeError('OWNED_NAMESPACE_REQUIRED')
        try:
            fd=os.pidfd_open(pid)
        except ProcessLookupError:return
        try:
            if os.stat('/proc/'+str(pid)+'/ns/net').st_ino!=os.stat('/run/netns/'+namespace).st_ino:raise RuntimeError('PID_LEFT_OWNED_NAMESPACE')
            signal.pidfd_send_signal(fd,signal.SIGKILL)
        except (ProcessLookupError,FileNotFoundError):pass
        finally:os.close(fd)
        return
    if mode=='exec':
        group=sys.argv[2]
        if os.geteuid()!=0 or not group.startswith('/sys/fs/cgroup/') or '..' in group:raise RuntimeError('CGROUP_REQUIRED')
        Path(group+'/cgroup.procs').write_text(str(os.getpid()));os.execv(sys.argv[3],sys.argv[3:])
    c=json.loads(Path(sys.argv[2]).read_text())
    if mode=='origin':origin(c)
    elif mode=='request':print(json.dumps(request(c)))
    elif mode=='probe':print(json.dumps(probe(c)))
    else:raise RuntimeError('MODE')
if __name__=='__main__':main()
