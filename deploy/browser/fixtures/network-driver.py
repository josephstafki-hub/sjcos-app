#!/opt/sjcos-browser/py/bin/python
"""Root-only real namespace packet probes. Never run on the host network.

The reviewed launcher supplies guarded-browser/gate scenarios. Missing launcher
or missing measurements is a hard failure, never a substitute helper counter.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import struct
import subprocess
import sys
import tempfile
import uuid

RUNTIME = Path('/opt/sjcos-browser')
DIRECT = {
    'direct-ipv4': (4, 'tcp', '8.8.8.8', 443),
    'direct-ipv6': (6, 'tcp', '2606:4700:4700::1111', 443),
    'direct-udp': (4, 'udp', '8.8.8.8', 443),
    'quic': (4, 'udp', '8.8.8.8', 443),
    'direct-dns': (4, 'udp', '10.204.0.2', 53),
    'host-app': (4, 'tcp', '10.203.0.2', 3017),
    'private-ip': (4, 'tcp', '169.254.169.254', 80),
}
PROBE = '''import socket,sys
family,kind,host,port=sys.argv[1:]
s=socket.socket(socket.AF_INET6 if family=='6' else socket.AF_INET,socket.SOCK_DGRAM if kind=='udp' else socket.SOCK_STREAM)
s.settimeout(.4)
try:
 if kind=='udp': s.sendto(b'SJC_UNAUTHORIZED_PACKET',(host,int(port)))
 else:
  s.connect((host,int(port)))
  s.sendall(b'GET /SJC_UNAUTHORIZED_PACKET HTTP/1.1\\r\\nHost: forbidden.example\\r\\n\\r\\n')
except OSError: pass
finally: s.close()
'''


def trusted(path):
    path = Path(path)
    for p in (path, *path.parents):
        st = p.lstat()
        if p.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
            raise RuntimeError('BROWSER_FIXTURE_UNTRUSTED')
    if not path.is_file():
        raise RuntimeError('BROWSER_FIXTURE_UNTRUSTED')


def pcap_metrics(path):
    # Parse records, not tcpdump text/counter summaries. Capture files are bounded
    # and removed in finally. No packet content reaches stdout/errors.
    size = path.stat().st_size
    if not 24 <= size <= 8*1024*1024:
        raise RuntimeError('BROWSER_CAPTURE_INVALID')
    digest = hashlib.sha256()
    packets = octets = 0
    with path.open('rb') as f:
        header = f.read(24); digest.update(header)
        endian = {b'\xd4\xc3\xb2\xa1':'<', b'\xa1\xb2\xc3\xd4':'>',
                  b'\x4d\x3c\xb2\xa1':'<', b'\xa1\xb2\x3c\x4d':'>'}.get(header[:4])
        if endian is None:
            raise RuntimeError('BROWSER_CAPTURE_INVALID')
        while raw := f.read(16):
            if len(raw) != 16:
                raise RuntimeError('BROWSER_CAPTURE_INVALID')
            _, _, included, original = struct.unpack(endian+'IIII', raw)
            if included > 65536 or included > original:
                raise RuntimeError('BROWSER_CAPTURE_INVALID')
            body = f.read(included)
            if len(body) != included:
                raise RuntimeError('BROWSER_CAPTURE_INVALID')
            digest.update(raw); digest.update(body)
            packets += 1; octets += original
    return {'packets':packets, 'wireBytes':octets, 'pcapSha256':digest.hexdigest()}


class Children:
    def __init__(self): self.children = []
    def start(self, argv, **kw):
        p = subprocess.Popen(argv, start_new_session=True, **kw)
        self.children.append(p)
        return p
    def stop(self, p):
        if getattr(p, '_sjc_stopped', False): return
        p._sjc_stopped = True
        try: os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        try: p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL); p.wait(timeout=3)
        # Descendants may have outlived the immediate driver process.
        try: os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
    def close(self):
        for p in reversed(self.children): self.stop(p)


def run_capture(children, ns, path, action):
    p = children.start(['/usr/sbin/ip','netns','exec',ns,'/usr/bin/tcpdump',
                        '--immediate-mode','-U','-Q','in','-i','any','-s','96',
                        '-c','1000','-w',str(path),'ip or ip6'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    # Wait for tcpdump's ready line with a real bounded select, no blind sleep.
    import select
    import time
    until = time.monotonic()+5
    ready = False
    while time.monotonic() < until:
        if select.select([p.stderr],[],[],max(0,until-time.monotonic()))[0]:
            line = p.stderr.readline(1024)
            if b'listening on' in line:
                ready = True; break
            if not line: break
    if not ready:
        raise RuntimeError('BROWSER_CAPTURE_NOT_READY')
    try:
        action()
        # Request a flush before stopping; tcpdump waits for packets in kernel.
        os.kill(p.pid, signal.SIGUSR2)
    finally:
        children.stop(p)
        p.stderr.close()
    return pcap_metrics(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['network'], required=True)
    parser.add_argument('--run-id', type=lambda x: str(uuid.UUID(x)), required=True)
    for name in ['browser','gate','fixture']:
        parser.add_argument('--'+name+'-ns', required=True)
    args = parser.parse_args()
    names = [getattr(args, name+'_ns') for name in ['browser','gate','fixture']]
    if os.geteuid() != 0 or any(not re.fullmatch(r'b0b-[a-f0-9]{8}-[bgf]', n) for n in names):
        raise RuntimeError('BROWSER_DISPOSABLE_NAMESPACE_REQUIRED')
    if len({n[4:12] for n in names}) != 1:
        raise RuntimeError('BROWSER_DISPOSABLE_NAMESPACE_REQUIRED')
    launcher = RUNTIME/'fixtures/launcher-driver'
    trusted(launcher)  # missing integration fails BEFORE launching anything
    children = Children()
    evidence = {'runId':args.run_id,'kind':'network','realRuntime':True,'simulated':False,
                'runtimeLockSha256':hashlib.sha256((RUNTIME/'runtime-lock.json').read_bytes()).hexdigest(),
                'cases':[]}
    try:
        with tempfile.TemporaryDirectory(prefix='sjc-b0b-pcap-') as temp:
            os.chmod(temp,0o700)
            def probe(ns, spec):
                p = children.start(['/usr/sbin/ip','netns','exec',ns,str(RUNTIME/'py/bin/python'),
                                    '-I','-c',PROBE,*map(str,spec)],
                                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if p.wait(timeout=3) != 0: raise RuntimeError('BROWSER_PROBE_FAILED')
            positive = run_capture(children,args.fixture_ns,Path(temp)/'control.pcap',
                                   lambda: probe(args.gate_ns, (4,'tcp','8.8.8.8',443)))
            if positive['packets'] <= 0:
                raise RuntimeError('BROWSER_CAPTURE_POSITIVE_CONTROL_FAILED')
            for name, spec in DIRECT.items():
                measurement = run_capture(children,args.fixture_ns,Path(temp)/(name+'.pcap'),
                                          lambda: probe(args.browser_ns,spec))
                evidence['cases'].append({'name':name,'passed':measurement['packets']==0,
                                          'measurement':measurement})
            p = children.start(['/usr/sbin/ip','netns','exec',args.browser_ns,str(launcher),*sys.argv[1:]],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            # Bound stdout at read, not after communicate has allocated it.
            output = bytearray()
            import select,time
            deadline = time.monotonic()+120
            while True:
                if time.monotonic()>=deadline: raise RuntimeError('BROWSER_LAUNCHER_TIMEOUT')
                if not select.select([p.stdout],[],[],min(1,deadline-time.monotonic()))[0]: continue
                chunk = os.read(p.stdout.fileno(),65536)
                if not chunk: break
                if len(output)+len(chunk)>1024*1024: raise RuntimeError('BROWSER_EVIDENCE_LIMIT')
                output.extend(chunk)
            if p.wait(timeout=3)!=0: raise RuntimeError('BROWSER_LAUNCHER_FAILED')
            result = json.loads(output)
            if result.get('runId')!=args.run_id or result.get('kind')!='network' or result.get('realRuntime') is not True or result.get('simulated') is not False:
                raise RuntimeError('BROWSER_LAUNCHER_EVIDENCE_INVALID')
            evidence['cases'].extend(result['cases'])
            # The actual gate launcher must provide parser + plaintext origin
            # capture proof; encrypted socket byte counters are insufficient.
            for key in ['unapprovedUpstreamBytes','privatePackets','captureIngressVerified','guardOrderingVerified']:
                evidence[key] = result[key]
            if any(not c.get('measurement') for c in evidence['cases']):
                raise RuntimeError('BROWSER_MEASUREMENT_MISSING')
            encoded = json.dumps(evidence,separators=(',',':'))
            if len(encoded)>1024*1024: raise RuntimeError('BROWSER_EVIDENCE_LIMIT')
            print(encoded)
    finally:
        children.close()


if __name__ == '__main__':
    try: main()
    except Exception:
        print('BROWSER_NETWORK_FIXTURE_FAILED',file=sys.stderr)
        sys.exit(1)
