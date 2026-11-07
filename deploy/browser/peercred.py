"""Linux-only kernel peer proof collector. Called on an ACCEPTED Unix socket by
root/trusted launcher, never with pid/uid fields from the client. Registry and
one-shot capability delivery belong to LaunchRegistry; no TCP/HTTP fallback.
"""
import hashlib
import os
import socket
import struct

def proc_record(pid):
    text = open(f"/proc/{pid}/stat", encoding="ascii").read()
    # comm may contain spaces or parentheses; fields after LAST ')' start at 3.
    fields = text[text.rindex(")") + 2:].split()
    return {"pid": pid, "ppid": int(fields[1]), "startTime": fields[19]}

def digest(file):
    with open(file, "rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

def peer_proof(accepted_socket):
    pid, uid, _ = struct.unpack("3i", accepted_socket.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    first = proc_record(pid)
    ancestors = []
    cursor = first
    for _ in range(64):
        ancestors.append({"pid": cursor["pid"], "startTime": cursor["startTime"]})
        if cursor["ppid"] <= 1:
            break
        cursor = proc_record(cursor["ppid"])
    executable = os.readlink(f"/proc/{pid}/exe")
    argv = open(f"/proc/{pid}/cmdline", "rb").read(65536).split(b"\0")
    if len(argv) < 2 or not argv[1].startswith(b"/"):
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    proof = {"pid": pid, "uid": uid, "startTime": first["startTime"],
             "ancestors": ancestors, "cgroup": open(f"/proc/{pid}/cgroup", encoding="ascii").read(),
             "executableDigest": digest(executable), "scriptDigest": digest(os.fsdecode(argv[1]))}
    if proc_record(pid) != first:
        raise ValueError("BROWSER_RENDEZVOUS_REFUSED")
    return proof
