"""Dedicated root/service launcher rendezvous. NOT installed or started here.
Trusted launcher records <run UUID>.json before releasing CLI stdin, including
pid/startTime, uid, exact cgroup, nodeDigest, executables{kind:sha256}, taskId,
principalId, bootId and credentialFiles{kind:absolute root-only narrow DSN file}.
Claims are durable exclusive files: broker restart cannot reissue a used slot.
"""
import json
import os
import secrets
import socket
import stat
from peercred import peer_proof

KINDS = ("browser", "sjcos", "interact")

def protected_json(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        if s.st_uid != 0 or s.st_mode & 0o077 or not stat.S_ISREG(s.st_mode) or s.st_size > 16384:
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

def register(request, peer, registry_dir, boot_id):
    from uuid import UUID
    run = str(UUID(request["runId"]))
    if run != request["runId"] or request.get("kind") not in KINDS:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    record = protected_json(os.path.join(registry_dir, run + ".json"))
    if record["bootId"] != boot_id or not validate_peer(record, request, peer):
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    # Secret is read only after authenticating kernel peer. Never from CLI env.
    file = record["credentialFiles"][request["kind"]]
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        if s.st_uid != 0 or s.st_mode & 0o077 or s.st_size > 8192 or not stat.S_ISREG(s.st_mode):
            raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
        dsn = os.read(fd, 8193).decode().strip()
    finally:
        os.close(fd)
    claim = os.path.join(registry_dir, run + "." + request["kind"] + ".claimed")
    fd = os.open(claim, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, boot_id.encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(registry_dir, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return {"runId": run, "taskId": record["taskId"], "principalId": record["principalId"],
            "profile": "browser", "capability": secrets.token_urlsafe(32), "dsn": dsn}

def serve(path, registry_dir, boot_id, web_gid):
    # Root-only, private root-created directories; never unlink/reuse an old
    # socket or remove durable claims. Coordinator reconciles old boots first.
    if os.geteuid() != 0:
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
                conn.settimeout(1)
                try:
                    peer = peer_proof(conn)
                    data = bytearray()
                    while not data.endswith(b"\n"):
                        chunk = conn.recv(min(1024, 2049 - len(data)))
                        if not chunk or len(data) + len(chunk) > 2048:
                            raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
                        data.extend(chunk)
                    response = register(json.loads(data), peer, registry_dir, boot_id)
                    conn.sendall(json.dumps(response).encode() + b"\n")
                except Exception:
                    conn.sendall(b'{"error":"BROWSER_RENDEZVOUS_REFUSED"}\n')
    finally:
        listener.close()
        os.unlink(path)
