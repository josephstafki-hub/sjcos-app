/** Root-only disposable network recipe. No host firewall/routing mutations,
 * forwarding/NAT, physical interfaces, service installation or namespace reuse. */
export const deny4='{ 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, 168.63.129.16 }';
export function browserRules(){return `table inet sjc_test {
 set cdp_ports { type inet_service; }
 chain input { type filter hook input priority 0; policy drop; iifname "lo" tcp dport @cdp_ports accept; ct state established,related accept; counter drop; }
 chain forward { type filter hook forward priority 0; policy drop; }
 chain output { type filter hook output priority 0; policy drop; oifname "lo" tcp dport @cdp_ports accept; oifname "lo" ct state established,related meta l4proto tcp accept; ip daddr 10.203.0.2 tcp dport {18081,18082} accept; counter drop; }
}`;}
export function gateRules(){return `table inet sjc_test {
 chain input { type filter hook input priority 0; policy drop; ct state established,related accept; ip saddr 10.203.0.1 tcp dport {18081,18082} accept; counter drop; }
 chain forward { type filter hook forward priority 0; policy drop; }
 chain output { type filter hook output priority 0; policy drop;
 ct state established,related accept;
 ip daddr 10.204.0.2 meta l4proto {tcp,udp} th dport 53 accept;
 ip daddr ${deny4} counter drop;
 ip6 daddr != 2000::/3 counter drop;
 ip6 daddr {2001::/23,2001:db8::/32,2002::/16,3fff::/20} counter drop;
 tcp dport 443 accept; counter drop; }
}`;}
export function namespacePlan(tag){
  if(!/^[a-f0-9]{8}$/.test(tag))throw Error('BROWSER_BAD_INPUT');
  const b='b0b-'+tag+'-b',g='b0b-'+tag+'-g',f='b0b-'+tag+'-f';
  return {names:{browser:b,gate:g,fixture:f},commands:[
    ...[b,g,f].map(n=>['ip',['netns','add',n]]),
    ['ip',['link','add','bg'+tag,'type','veth','peer','name','gb'+tag]],
    ['ip',['link','set','bg'+tag,'netns',b]],['ip',['link','set','gb'+tag,'netns',g]],
    ['ip',['link','add','gf'+tag,'type','veth','peer','name','fg'+tag]],
    ['ip',['link','set','gf'+tag,'netns',g]],['ip',['link','set','fg'+tag,'netns',f]],
    ...[[b,'bg'+tag,'10.203.0.1/30'],[g,'gb'+tag,'10.203.0.2/30'],[g,'gf'+tag,'10.204.0.1/30'],[f,'fg'+tag,'10.204.0.2/30']].flatMap(([n,dev,addr])=>[['ip',['-n',n,'addr','add',addr,'dev',dev]],['ip',['-n',n,'link','set',dev,'up']]]),
    ...[b,g,f].map(n=>['ip',['-n',n,'link','set','lo','up']]),
    ['ip',['-n',f,'addr','add','8.8.8.8/32','dev','lo']],
    ['ip',['-n',g,'route','add','8.8.8.8/32','via','10.204.0.2']],
    ['ip',['-n',b,'route','add','default','via','10.203.0.2']],
    ['ip',['netns','exec',b,'nft','-f','-'],browserRules()],['ip',['netns','exec',g,'nft','-f','-'],gateRules()],
  ]};
}
