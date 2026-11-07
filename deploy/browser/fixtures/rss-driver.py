#!/opt/sjcos-browser/py/bin/python
"""RSS acceptance entrypoint, refuses missing integrated parser transport.

The isolated gate transport must measure real receive/drain/parser operations.
Offline AllocationOwner tests cannot serve as acceptance evidence.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--kind',choices=['rss'],required=True)
    p.add_argument('--run-id',type=lambda x:str(uuid.UUID(x)),required=True)
    p.add_argument('--no-network-outside-fixture',action='store_true',required=True)
    p.add_argument('--helper-cgroup',required=True)
    args = p.parse_args()
    if os.geteuid()!=0 or not args.helper_cgroup.startswith('/sys/fs/cgroup/'):
        raise RuntimeError('BROWSER_DISPOSABLE_CGROUP_REQUIRED')
    driver = Path('/opt/sjcos-browser/fixtures/parser-transport-driver')
    # This executable is intentionally not supplied by a counter-only test.
    for path in (driver,*driver.parents):
        st=path.lstat()
        if path.is_symlink() or st.st_uid!=0 or st.st_mode & 0o022:
            raise RuntimeError('BROWSER_FIXTURE_UNTRUSTED')
    child=None
    try:
        child=subprocess.Popen([str(driver),*sys.argv[1:]],stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL,start_new_session=True)
        import select,time
        deadline=time.monotonic()+180
        data=bytearray()
        while time.monotonic()<deadline:
            if not select.select([child.stdout],[],[],min(1,deadline-time.monotonic()))[0]: continue
            chunk=os.read(child.stdout.fileno(),65536)
            if not chunk: break
            if len(data)+len(chunk)>1024*1024: raise RuntimeError('BROWSER_EVIDENCE_LIMIT')
            data.extend(chunk)
        else: raise RuntimeError('BROWSER_FIXTURE_TIMEOUT')
        if child.wait(timeout=3)!=0: raise RuntimeError('BROWSER_FIXTURE_FAILED')
        e=json.loads(data)
        if e.get('runId')!=args.run_id or e.get('kind')!='rss' or e.get('realRuntime') is not True or e.get('simulated') is not False:
            raise RuntimeError('BROWSER_FIXTURE_EVIDENCE_INVALID')
        if any(not c.get('measurement') for c in e.get('cases',[])):
            raise RuntimeError('BROWSER_MEASUREMENT_MISSING')
        print(json.dumps(e,separators=(',',':')))
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid,signal.SIGTERM)
            try: child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)


if __name__=='__main__':
    try: main()
    except Exception:
        print('BROWSER_RSS_FIXTURE_FAILED',file=sys.stderr)
        sys.exit(1)
