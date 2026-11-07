#!/opt/sjcos-browser/py/bin/python
import argparse,os,sys

def main():
    p=argparse.ArgumentParser();p.add_argument('--kind',choices=['rss'],required=True);p.add_argument('--run-id',required=True)
    for name in ['browser-ns','gate-ns','fixture-ns','helper-cgroup','gate-cgroup','dns-cgroup','log-dir']:p.add_argument('--'+name,required=True)
    p.add_argument('--supervisor-pids',required=True);p.add_argument('--case');p.parse_args()
    if os.geteuid()!=0:raise RuntimeError('BROWSER_ROOT_REQUIRED')
    os.execve('/usr/bin/node',['/usr/bin/node','--max-old-space-size=256','/opt/sjcos-browser/node/source/deploy/browser/fixtures/root-fixture.mjs',*sys.argv[1:]],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})
if __name__=='__main__':main()
