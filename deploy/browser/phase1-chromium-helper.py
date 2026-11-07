#!/usr/bin/python3
"""Minimal fixed root helper. Only start/stop; peer controller uid, pidfd pinned.
No SQL/CDP forwarding, argv/path/environment/uid supplied by caller. Chromium is
NEVER root; independent EOF/pidfd death kills its sole process group.
"""
import hashlib,json,os,pathlib,pwd,select,signal,socket,struct,subprocess,sys,tempfile,time,shutil
sys.path.insert(0,str(pathlib.Path(__file__).parent))
def protected(name,maximum=1024*1024):
    p=pathlib.Path(name)
    for q in (p,*p.parents):
        s=q.lstat()
        if q.is_symlink() or s.st_uid!=0 or s.st_mode&0o022:raise ValueError()
    with p.open('rb') as f:data=f.read(maximum+1)
    if len(data)>maximum:raise ValueError()
    return data
BASE=pathlib.Path('/run/sjcos-browser-chromium')
SOCKET='/run/sjcos-browser-helper/launch.sock'
RUNTIME='/opt/sjcos-browser'
def main():
    if os.geteuid()!=0 or len(sys.argv)!=1:raise ValueError()
    if os.readlink('/proc/self/ns/net')==os.readlink('/proc/1/ns/net') or os.stat('/proc/self/ns/net').st_ino!=os.stat('/run/netns/sjcos-browser').st_ino:raise ValueError()
    browser=pwd.getpwnam('sjcos-browser');controller=pwd.getpwnam('sjcos-browser-controller')
    if browser.pw_uid!=998 or controller.pw_uid in (0,998):raise ValueError()
    spec=json.loads(protected('/etc/sjcos-browser/production-launch.json'))
    binary=RUNTIME+'/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'
    inventory=json.loads(protected(RUNTIME+'/installed-hashes.json',1024*1024))
    def verify():
        for name in ('browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell','node/node_modules/playwright-core/lib/coreBundle.js','node/node_modules/playwright-core/lib/sjc-patch.json'):
            p=pathlib.Path(RUNTIME+'/'+name)
            for q in (p,*p.parents):
                st=q.lstat()
                if q.is_symlink() or st.st_uid!=0 or st.st_mode&0o022:raise ValueError()
            h=hashlib.sha256()
            with p.open('rb') as f:
                for chunk in iter(lambda:f.read(65536),b''):h.update(chunk)
            if h.hexdigest()!=inventory['files'][name]:raise ValueError()
    child=None;directory=None;pidfd=None;peer_pid=None;port=None
    def stop():
        nonlocal child,directory,port
        if child is not None:
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                child.wait(timeout=2)
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child=None
        if port is not None:
            subprocess.run(['/usr/sbin/nft','delete','element','inet','sjc_browser','cdp_ports','{ '+str(port)+' }'],check=True,stdout=subprocess.DEVNULL,timeout=2);port=None
        if directory:shutil.rmtree(directory);directory=None
    def start():
        nonlocal child,directory,port
        if child is not None:raise ValueError()
        verify();directory=pathlib.Path(tempfile.mkdtemp(prefix='p-',dir=BASE))
        home=directory/'home';profile=directory/'profile'
        for p in (directory,home,profile):p.mkdir(exist_ok=True,mode=0o700);os.chown(p,998,browser.pw_gid)
        nss=home/'.pki/nssdb';nss.mkdir(parents=True,mode=0o700)
        for p in (home/'.pki',nss):os.chown(p,998,browser.pw_gid)
        env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':str(home),'XDG_CONFIG_HOME':str(home),'XDG_CACHE_HOME':str(home),'TMPDIR':str(directory)}
        tool=RUNTIME+'/nss/usr/bin/certutil';nssenv={**env,'LD_LIBRARY_PATH':RUNTIME+'/nss/usr/lib/x86_64-linux-gnu'}
        for args in (['-N','--empty-password','-d','sql:'+str(nss)],['-A','-d','sql:'+str(nss),'-n','SJC browser public CA','-t','C,,','-i','/etc/sjcos-browser/ca-public.pem']):
            subprocess.run([tool,*args],user=998,group=browser.pw_gid,extra_groups=[],env=nssenv,check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
        args=[v.replace('@PROFILE@',str(profile)) for v in spec['args']]
        if spec['executable']!=binary or '--no-sandbox' in args or '--site-per-process' not in args:raise ValueError()
        child=subprocess.Popen([binary,*args],user=998,group=browser.pw_gid,extra_groups=[],cwd=directory,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)
        end=time.monotonic()+10
        while time.monotonic()<end and child.poll() is None:
            try:
                rows=(profile/'DevToolsActivePort').read_text().splitlines()
                if len(rows)!=2 or not rows[0].isdigit() or not 1024<=int(rows[0])<=65535 or not rows[1].startswith('/devtools/browser/'):raise ValueError()
                port=int(rows[0]);subprocess.run(['/usr/sbin/nft','add','element','inet','sjc_browser','cdp_ports','{ '+str(port)+' }'],check=True,stdout=subprocess.DEVNULL,timeout=2)
                return {'ok':True,'endpoint':'ws://127.0.0.1:'+rows[0]+rows[1]}
            except FileNotFoundError:time.sleep(.025)
        raise ValueError()
    sock=socket.socket(socket.AF_UNIX);sock.bind(SOCKET);os.chmod(SOCKET,0o660);os.chown(SOCKET,0,controller.pw_gid);sock.listen(2)
    def terminal(*_):raise SystemExit()
    signal.signal(signal.SIGTERM,terminal);signal.signal(signal.SIGINT,terminal)
    try:
        while True:
            ready,_,_=select.select([sock]+([pidfd] if pidfd is not None else []),[],[],1)
            if pidfd in ready:stop();raise SystemExit()
            if child is not None and child.poll() is not None:stop();raise SystemExit(1)
            if sock not in ready:continue
            with sock.accept()[0] as s:
                s.settimeout(2)
                try:
                    pid,uid,_=struct.unpack('3i',s.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                    if uid!=controller.pw_uid or peer_pid not in (None,pid):raise ValueError()
                    if pidfd is None:pidfd=os.pidfd_open(pid);peer_pid=pid
                    def exact(n):
                        raw=b''
                        while len(raw)<n:
                            b=s.recv(n-len(raw))
                            if not b:raise ValueError()
                            raw+=b
                        return raw
                    n,=struct.unpack('!I',exact(4))
                    if not 0<n<=128:raise ValueError()
                    x=json.loads(exact(n))
                    if set(x)!={'v','op'} or x['v']!=1 or x['op'] not in ('start','stop'):raise ValueError()
                    result=start() if x['op']=='start' else (stop() or {'ok':True})
                    raw=json.dumps(result).encode();s.sendall(struct.pack('!I',len(raw))+raw)
                except Exception:
                    stop()
                    try:s.sendall(struct.pack('!I',12)+b'{"ok":false}')
                    except OSError:pass
    finally:
        stop();sock.close();os.unlink(SOCKET)
        if pidfd is not None:os.close(pidfd)
if __name__=='__main__':
    try:main()
    except Exception:raise SystemExit('BROWSER_HELPER_REFUSED') from None
