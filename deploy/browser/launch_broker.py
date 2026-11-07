"""Dedicated root/service launcher rendezvous. NOT installed or started here.
Trusted launcher records <run UUID>.json before releasing CLI stdin, including
pid/startTime, uid, exact cgroup, nodeDigest, executables{kind:sha256}, taskId,
principalId, bootId and credentialFiles{kind:absolute root-only narrow DSN file}.
Claims are durable exclusive files: broker restart cannot reissue a used slot.
"""
import json
import hashlib
import os
import secrets
import socket
import stat
import sys
# -I ignores ambient PYTHONPATH; import only our root-installed sibling.
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from peercred import peer_proof, proc_record, digest

KINDS = ("browser", "sjcos", "interact")

def protected_json(file, owner_uid=0):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        if s.st_uid != owner_uid or s.st_mode & 0o077 or not stat.S_ISREG(s.st_mode) or s.st_size > 16384:
            raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
        return json.loads(os.read(fd, 16385))
    finally:
        os.close(fd)

def validate_peer(record, request, peer):
    if set(request) != {"runId", "kind"} or request["kind"] not in KINDS:
        return False
    return (record["runId"] == request["runId"] and peer["uid"] == record["uid"]
            and peer["cgroup"] == record["cgroup"] and peer["startTime"]
            and any(a["pid"] == record["pid"] and a["startTime"] == record["startTime"] for a in peer["ancestors"])
            and peer["executableDigest"] == record["nodeDigest"]
            and peer["scriptDigest"] == record["executables"][request["kind"]])

def register(request, peer, registry_dir, boot_id, owner_uid=0):
    from uuid import UUID
    run = str(UUID(request["runId"]))
    if run != request["runId"] or request.get("kind") not in KINDS:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    record = protected_json(os.path.join(registry_dir, run + ".json"), owner_uid)
    if record["bootId"] != boot_id or not validate_peer(record, request, peer):
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    # Re-read the registered CLI, not only an ancestry snapshot from an old PID.
    live = proc_record(record["pid"])
    if live["startTime"] != record["startTime"] or open(f'/proc/{record["pid"]}/cgroup').read() != record["cgroup"]:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    # Secret is read only after authenticating kernel peer. Never from CLI env.
    file = record["credentialFiles"][request["kind"]]
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        if s.st_uid != owner_uid or s.st_mode & 0o077 or s.st_size > 8192 or not stat.S_ISREG(s.st_mode):
            raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
        dsn = os.read(fd, 8193).decode().strip()
    finally:
        os.close(fd)
    capability = secrets.token_urlsafe(32)
    claim = os.path.join(registry_dir, run + "." + request["kind"] + ".claimed")
    fd = os.open(claim, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, json.dumps({"bootId": boot_id, "runId": run, "kind": request["kind"],
                                 "pid": peer["pid"], "startTime": peer["startTime"],
                                 "capabilitySha256": hashlib.sha256(capability.encode()).hexdigest()}).encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(registry_dir, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return {"runId": run, "taskId": record["taskId"], "principalId": record["principalId"],
            "profile": "browser", "capability": capability, "dsn": dsn}

def register_launch(request, peer, registry_dir, boot_id, policy, owner_uid=0):
    from uuid import UUID
    if (set(request) != {"op", "runId", "taskId", "principalId", "pid"}
            or request["op"] != "register" or peer["uid"] != policy["launcherUid"]
            or peer["scriptDigest"] not in policy["launcherDigests"]
            or peer["executableDigest"] != policy["launcherNodeDigest"]):
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    for key in ("runId", "taskId", "principalId"):
        if str(UUID(request[key])) != request[key]:
            raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    pid = request["pid"]
    if type(pid) != int or pid <= 1:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    child = proc_record(pid)
    if child["ppid"] != peer["pid"] or digest(f"/proc/{pid}/exe") != policy["cliDigest"]:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    record = {k: request[k] for k in ("runId", "taskId", "principalId")}
    record.update(pid=pid, startTime=child["startTime"], uid=os.stat(f"/proc/{pid}").st_uid,
                  cgroup=open(f"/proc/{pid}/cgroup").read(), bootId=boot_id,
                  nodeDigest=policy["nodeDigest"], executables=policy["executables"],
                  credentialFiles=policy["credentialFiles"])
    if proc_record(pid) != child:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    file = os.path.join(registry_dir, request["runId"] + ".json")
    fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, json.dumps(record).encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(registry_dir, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return {"registered": True, "runId": request["runId"]}

def exchange(conn, registry_dir, boot_id, policy, owner_uid=0):
    conn.settimeout(2)
    try:
        peer = peer_proof(conn)
        data = bytearray()
        while not data.endswith(b"\n"):
            chunk = conn.recv(min(1024, 2049 - len(data)))
            if not chunk or len(data) + len(chunk) > 2048:
                raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
            data.extend(chunk)
        request = json.loads(data)
        if request.get("op") == "register":
            response = register_launch(request, peer, registry_dir, boot_id, policy, owner_uid)
        else:
            response = register(request, peer, registry_dir, boot_id, owner_uid)
        conn.sendall(json.dumps(response).encode() + b"\n")
    except Exception:
        conn.sendall(b'{"error":"BROWSER_RENDEZVOUS_REFUSED"}\n')

def serve(path, registry_dir, boot_id, web_gid, policy):
    # Production never exposes the test-only owner_uid override. The sole launch
    # authority is a pinned root process; MCP descendants use their narrow UID.
    if os.geteuid() != 0 or policy["launcherUid"] != 0 or path != "/run/sjcos-browser/launch.sock":
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    for directory in (os.path.dirname(path), registry_dir):
        s = os.lstat(directory)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    os.chown(path, 0, web_gid)
    os.chmod(path, 0o660)
    listener.listen(8)
    try:
        while True:
            conn, _ = listener.accept()
            with conn:
                exchange(conn, registry_dir, boot_id, policy)
    finally:
        listener.close()
        os.unlink(path)

if __name__ == "__main__":
    # Fixed protected bootstrap, no environment credential fallback.
    config = protected_json("/etc/sjcos-browser/launch-broker.json")
    boot_id = open("/proc/sys/kernel/random/boot_id").read().strip()
    serve("/run/sjcos-browser/launch.sock", "/run/sjcos-browser/registry", boot_id, config["webGid"], config)
