"""Fresh, bounded DNS-over-TCP to the namespace's pinned Unbound. No libc DNS.
Every socket authorization repeats CNAME/A/AAAA; no cache or hostname fallback.
"""
import ipaddress
import secrets
import socket
import struct
import time
from mitmproxy import dns
from mitmproxy.net.dns import domain_names
from parser_adapter import Refused

PINNED_UNBOUND = ('10.204.0.2', 53)
DENY = tuple(map(ipaddress.ip_network, ('168.63.129.16/32','64:ff9b::/96','64:ff9b:1::/48','2002::/16','2001::/23','::ffff:0:0/96')))

def public_address(value):
    try:
        a=ipaddress.ip_address(value)
        return a.is_global and not a.is_multicast and not a.is_reserved and not any(a.version==n.version and a in n for n in DENY)
    except ValueError:
        return False

def hostname(value):
    if not isinstance(value,str) or value!=value.lower() or len(value)>253 or value.endswith('.'):
        raise Refused('BROWSER_HOST')
    import re
    if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?',value):
        raise Refused('BROWSER_HOST')
    return value

class FreshResolver:
    def __init__(self, denied_addresses=(), clock=time.monotonic):
        self.clock=clock
        self.denied=frozenset(str(ipaddress.ip_address(a)) for a in denied_addresses)

    def query(self, name, qtype, deadline):
        # Manually bounded wire header: one question, no EDNS/unbounded records.
        ident=secrets.randbelow(65536)
        wire=struct.pack('!6H',ident,0x100,1,0,0,0)+domain_names.pack(name)+struct.pack('!HH',qtype,1)
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
            def timeout():
                left=min(2,deadline-self.clock())
                if left<=0:raise Refused('BROWSER_DEADLINE')
                sock.settimeout(left)
            timeout();sock.connect(PINNED_UNBOUND);timeout();sock.sendall(struct.pack('!H',len(wire))+wire)
            def exact(n):
                b=bytearray(n);used=0
                while used<n:
                    timeout();got=sock.recv_into(memoryview(b)[used:],n-used)
                    if not got:raise Refused('BROWSER_DNS')
                    used+=got
                return b
            n,=struct.unpack('!H',exact(2))
            if not 12<=n<=4096:raise Refused('BROWSER_DNS_LIMIT')
            raw=bytes(exact(n))
        rid,flags,qd,an,ns,ar=struct.unpack('!6H',raw[:12])
        if rid!=ident or flags & 0xFA0F != 0x8000 or qd!=1 or an+ns+ar>64:
            raise Refused('BROWSER_DNS')
        try:m=dns.DNSMessage.unpack(raw)
        except (ValueError,struct.error,RecursionError):raise Refused('BROWSER_DNS') from None
        if len(m.questions)!=1 or (m.question.name.lower().rstrip('.'),m.question.type,m.question.class_)!=(name,qtype,1):
            raise Refused('BROWSER_DNS')
        for rr in (*m.answers,*m.authorities,*m.additionals):
            if rr.type in (1,28):
                try:address=str(ipaddress.ip_address(rr.data))
                except ValueError:raise Refused('BROWSER_DNS') from None
                if not public_address(address) or address in self.denied:raise Refused('BROWSER_ADDRESS_BLOCKED')
        return m.answers

    def resolve(self, name, deadline):
        original=hostname(name);chain=[];addresses=[];ttl=60
        # All answer addresses, even unrelated additional aliases in the answer,
        # must be public. Ignore no private record to salvage a mixed answer.
        for _ in range(8):
            if name in chain:raise Refused('BROWSER_DNS_CHAIN')
            chain.append(name);aliases=set();current=[]
            for qtype in (5,1,28):
                for rr in self.query(name,qtype,deadline):
                    if rr.class_!=1:raise Refused('BROWSER_DNS')
                    ttl=min(ttl,rr.ttl)
                    if rr.type in (1,28):
                        try:a=str(ipaddress.ip_address(rr.data))
                        except ValueError:raise Refused('BROWSER_DNS') from None
                        if not public_address(a) or a in self.denied:raise Refused('BROWSER_ADDRESS_BLOCKED')
                        if rr.name.lower().rstrip('.')==name:current.append(a)
                    elif rr.type==5 and rr.name.lower().rstrip('.')==name:
                        aliases.add(hostname(rr.domain_name.lower().rstrip('.')))
            if len(aliases)>1 or aliases and current:raise Refused('BROWSER_DNS_CHAIN')
            if aliases:name=aliases.pop();continue
            addresses=sorted(set(current));break
        else:raise Refused('BROWSER_DNS_CHAIN')
        if not addresses or len(addresses)>32 or ttl<=0:raise Refused('BROWSER_DNS')
        return dict(hostname=original,chain=chain,addresses=addresses,ttlMs=ttl*1000)
