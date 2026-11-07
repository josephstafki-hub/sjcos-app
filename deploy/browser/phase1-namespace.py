#!/usr/bin/python3
"""Fixed root oneshot topology. No RPC, generic command or SQL interface.
Only invocation-owned names are removed; refuses preexisting namespaces/tables.
IPv4 forwarding must already be approved/configured by the coordinator.
"""
import ipaddress,json,os,pathlib,pwd,subprocess,sys
STATE=pathlib.Path('/run/sjcos-browser-setup/topology.json')
NAMES=('sjcos-browser','sjcos-browser-gate')
def run(*args,input=None):
 return subprocess.run(list(args),input=input,text=True,check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10).stdout
def ip(*a):return run('/usr/sbin/ip',*a)
def nft(ns,text):return run('/usr/sbin/ip','netns','exec',ns,'/usr/sbin/nft','-f','-',input=text)
def save(s):
 tmp=STATE.with_suffix('.tmp');tmp.write_text(json.dumps(s));os.chmod(tmp,0o600)
 with tmp.open() as f:os.fsync(f.fileno())
 os.replace(tmp,STATE)
def main():
 if os.geteuid()!=0 or sys.argv[1:] not in (['up'],['down']):raise ValueError()
 if sys.argv[1]=='down':
  if not STATE.exists():return
  state=json.loads(STATE.read_text())
  if state.get('v')!=1:raise ValueError()
  # Names were proven absent and intent persisted before each creation.
  for name in reversed(state['names']):
   if pathlib.Path('/run/netns/'+name).exists():ip('netns','delete',name)
  if state.get('host_table'):
   run('/usr/sbin/nft','delete','table','inet','sjc_browser_forward')
  if state.get('nat_table'):run('/usr/sbin/nft','delete','table','ip','sjc_browser_nat')
  if pathlib.Path('/sys/class/net/sjcb-h').exists():ip('link','delete','sjcb-h')
  STATE.unlink();return
 if STATE.exists() or any(pathlib.Path('/run/netns/'+n).exists() for n in NAMES):raise ValueError()
 if pathlib.Path('/proc/sys/net/ipv4/ip_forward').read_text().strip()!='1':raise ValueError()
 for family,name in [('inet','sjc_browser_forward'),('ip','sjc_browser_nat')]:
  r=subprocess.run(['/usr/sbin/nft','list','table',family,name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if r.returncode==0:raise ValueError()
 config=json.loads(pathlib.Path('/etc/sjcos-browser/namespace.json').read_text());denied=config['deniedAddresses']
 if not denied:raise ValueError()
 for a in denied:ipaddress.ip_address(a)
 controller=pwd.getpwnam('sjcos-browser-controller').pw_uid;gate=pwd.getpwnam('sjcos-browser-gate').pw_uid;dns=pwd.getpwnam('sjcos-browser-dns').pw_uid
 state={'v':1,'names':[],'host_table':False,'nat_table':False};save(state)
 for name in NAMES:
  state['names'].append(name);save(state);ip('netns','add',name);ip('-n',name,'link','set','lo','up')
 ip('link','add','sjcb-b','type','veth','peer','name','sjcb-g')
 ip('link','set','sjcb-b','netns',NAMES[0]);ip('link','set','sjcb-g','netns',NAMES[1])
 for ns,dev,addr in [(NAMES[0],'sjcb-b','10.203.0.1/30'),(NAMES[1],'sjcb-g','10.203.0.2/30')]:
  ip('-n',ns,'addr','add',addr,'dev',dev);ip('-n',ns,'link','set',dev,'up')
 ip('link','add','sjcb-h','type','veth','peer','name','sjcb-e');ip('link','set','sjcb-e','netns',NAMES[1])
 ip('addr','add','10.204.0.1/30','dev','sjcb-h');ip('link','set','sjcb-h','up')
 ip('-n',NAMES[1],'addr','add','10.204.0.2/30','dev','sjcb-e');ip('-n',NAMES[1],'link','set','sjcb-e','up');ip('-n',NAMES[1],'route','add','default','via','10.204.0.1')
 nft(NAMES[0],f'''table inet sjc_browser {{
 set cdp_ports {{ type inet_service; }}
 chain input {{ type filter hook input priority 0; policy drop; ct state established,related accept; iifname "lo" tcp dport @cdp_ports accept; }}
 chain output {{ type filter hook output priority 0; policy drop; ct state established,related accept; meta skuid {controller} oifname "lo" tcp dport @cdp_ports accept; ip daddr 10.203.0.2 tcp dport {{18081,18082}} accept; }}
 chain forward {{ type filter hook forward priority 0; policy drop; }}
}}''')
 # Nonglobal, metadata, mapped/transition and host/service/tunnel aliases denied
 # before any established exception. IPv6 has no accept rule and no route.
 ranges=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4','168.63.129.16/32']+[a+'/32' for a in denied if ipaddress.ip_address(a).version==4]
 deny=', '.join(ranges)
 nft(NAMES[1],f'''table inet sjc_gate {{
 set denied {{ type ipv4_addr; flags interval; auto-merge; elements = {{ {deny} }}; }}
 chain input {{ type filter hook input priority 0; policy drop; ct state established,related accept; ip saddr 10.203.0.1 tcp dport {{18081,18082}} accept; iifname "lo" ip daddr 10.204.0.2 tcp dport 53 accept; }}
 chain output {{ type filter hook output priority 0; policy drop; ct state established,related accept; meta skuid {gate} ip daddr 10.204.0.2 tcp dport 53 accept; ip daddr @denied drop; meta skuid {gate} tcp dport 443 accept; meta skuid {dns} ip daddr {{9.9.9.9,149.112.112.112}} meta l4proto {{tcp,udp}} th dport 53 accept; }}
 chain forward {{ type filter hook forward priority 0; policy drop; }}
}}''')
 state['host_table']=True;save(state)
 run('/usr/sbin/nft','-f','-',input=f'''table inet sjc_browser_forward {{
 chain input {{ type filter hook input priority -10; iifname "sjcb-h" drop; }}
 chain forward {{ type filter hook forward priority -10; iifname "sjcb-h" ip daddr {{ {deny} }} drop; iifname "sjcb-h" tcp dport {{443,53}} accept; iifname "sjcb-h" ip daddr {{9.9.9.9,149.112.112.112}} udp dport 53 accept; oifname "sjcb-h" ct state established,related accept; iifname "sjcb-h" drop; oifname "sjcb-h" drop; }}
}}''')
 state['nat_table']=True;save(state)
 run('/usr/sbin/nft','-f','-',input='table ip sjc_browser_nat { chain postrouting { type nat hook postrouting priority srcnat; ip saddr 10.204.0.2 oifname != "sjcb-h" masquerade; } }')
if __name__=='__main__':
 try:main()
 except Exception:raise SystemExit('BROWSER_NAMESPACE_SETUP_REFUSED') from None
