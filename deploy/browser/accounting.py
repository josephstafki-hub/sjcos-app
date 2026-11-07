"""Read-only common-ancestor census; a different uid adds no capacity."""
import pathlib,os
G=1024**3
def metrics(*,joe_uid,browser_uids,common_cgroup,browser_cgroup,proc='/proc',cgroup_root='/sys/fs/cgroup'):
    def safe(p):
        if not p.startswith('/') or '..' in p.split('/'):raise ValueError()
        return pathlib.Path(cgroup_root+p)
    root=safe(common_cgroup);child=safe(browser_cgroup)
    if not browser_cgroup.startswith(common_cgroup.rstrip('/')+'/'):raise ValueError()
    if int((root/'memory.max').read_text())!=24*G or (root/'memory.swap.max').read_text().strip()!='0':raise ValueError()
    quota,period=(root/'cpu.max').read_text().split()
    if quota=='max' or int(quota)>8*int(period):raise ValueError()
    accounted=True
    for p in pathlib.Path(proc).iterdir():
        if not p.name.isdecimal():continue
        try:
            uid=p.stat().st_uid
            if uid not in [joe_uid,*browser_uids]:continue
            rows=(p/'cgroup').read_text().splitlines();v=[x[3:] for x in rows if x.startswith('0::')]
            if len(v)!=1 or not(v[0]==common_cgroup or v[0].startswith(common_cgroup.rstrip('/')+'/')):accounted=False
        except FileNotFoundError:continue # process exited during census
        except PermissionError:accounted=False
    info=dict(line.split(':',1) for line in pathlib.Path(proc+'/meminfo').read_text().splitlines())
    oom=dict(line.split() for line in (child/'memory.events').read_text().splitlines())
    return {'oom_kill':int(oom['oom_kill']),'available_bytes':int(info['MemAvailable'].split()[0])*1024,'account_bytes':int((root/'memory.current').read_text()),'browser_bytes':int((child/'memory.current').read_text()),'accounted':accounted,'boot_id':pathlib.Path(proc+'/sys/kernel/random/boot_id').read_text().strip()}
