#!/usr/bin/python3
"""Bounded independent anchor exporter. Python stdlib only, fixed JSON protocol.
Ed25519 follows RFC8032 extended Edwards coordinates; seed/public raw32 or PEM.
No DB/browser/vault imports. Fixed pinned TLS destination; redirects/proxies off.
"""
import os,sys,json,base64,hashlib,hmac,re,datetime,socket,struct,ssl,http.client,urllib.request,urllib.parse,urllib.error,ipaddress
P=2**255-19;L=2**252+27742317777372353535851937790883648493
D=-121665*pow(121666,P-2,P)%P;I=pow(2,(P-1)//4,P);IDENTITY=(0,1,1,0)
def point(raw):
 if len(raw)!=32:raise ValueError('SIGNATURE')
 n=int.from_bytes(raw,'little');y=n&((1<<255)-1)
 if y>=P:raise ValueError('SIGNATURE')
 xx=(y*y-1)*pow(D*y*y+1,P-2,P)%P;x=pow(xx,(P+3)//8,P)
 if (x*x-xx)%P:x=x*I%P
 if (x*x-xx)%P:raise ValueError('SIGNATURE')
 if (x&1)!=(n>>255):x=P-x
 if x==P:raise ValueError('SIGNATURE')
 return x,y,1,x*y%P
def add(a,b):
 x,y,z,t=a;u,v,w,s=b;aa=(y-x)*(v-u)%P;bb=(y+x)*(v+u)%P;cc=2*D*t*s%P;dd=2*z*w%P;e=bb-aa;f=dd-cc;g=dd+cc;hh=bb+aa
 return e*f%P,g*hh%P,f*g%P,e*hh%P
def mul(a,n):
 r=IDENTITY
 while n:
  if n&1:r=add(r,a)
  a=add(a,a);n>>=1
 return r
def enc(a):
 x,y,z,_=a;iz=pow(z,P-2,P);return ((y*iz%P)|((x*iz%P&1)<<255)).to_bytes(32,'little')
B=point(bytes.fromhex('58'+'66'*31))
def scalar(seed):
 h=hashlib.sha512(seed).digest();return (int.from_bytes(h[:32],'little')&((1<<254)-8))|(1<<254),h[32:]
def public(seed):return enc(mul(B,scalar(seed)[0]))
def sign(seed,msg):
 a,prefix=scalar(seed);pub=public(seed);r=int.from_bytes(hashlib.sha512(prefix+msg).digest(),'little')%L;rr=enc(mul(B,r));k=int.from_bytes(hashlib.sha512(rr+pub+msg).digest(),'little')%L
 return rr+((r+k*a)%L).to_bytes(32,'little')
def verify(pub,msg,sig):
 try:
  if len(sig)!=64 or int.from_bytes(sig[32:],'little')>=L:return False
  a=point(pub);r=point(sig[:32]);identity=enc(IDENTITY)
  if enc(mul(a,8))==identity or enc(mul(r,8))==identity or enc(mul(a,L))!=identity or enc(mul(r,L))!=identity:return False
  k=int.from_bytes(hashlib.sha512(sig[:32]+pub+msg).digest(),'little')%L
  return hmac.compare_digest(enc(mul(B,int.from_bytes(sig[32:],'little'))),enc(add(r,mul(a,k))))
 except (ValueError,OverflowError):return False
def key_bytes(data,private=False):
 if len(data)==32:return data
 prefix=bytes.fromhex('302e020100300506032b657004220420' if private else '302a300506032b6570032100')
 der=base64.b64decode(b''.join(data.splitlines()[1:-1]),validate=True)
 if len(der)!=len(prefix)+32 or not der.startswith(prefix):raise ValueError('KEY')
 return der[-32:]
def jcs(record):
 # Protocol accepts only bounded ASCII keys/values + safe integer seq, so sorted
 # compact JSON is JCS. Reject other types before canonicalization.
 return json.dumps(record,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def now():return datetime.datetime.now(datetime.timezone.utc)
def iso(t):return t.isoformat(timespec='seconds').replace('+00:00','Z')
def utc(s):
 if not isinstance(s,str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z',s):raise ValueError('TIME')
 return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*_):raise ValueError('REDIRECT')
class PinnedHTTPS(urllib.request.HTTPSHandler):
 def __init__(self,host,ips):super().__init__();self.host=host;self.ips=ips
 def https_open(self,req):
  if req.host!=self.host:raise ValueError('EGRESS')
  ips=self.ips
  class Connection(http.client.HTTPSConnection):
   def connect(self):
    # Never resolve at request time; root-reviewed public IPs and TLS host/SNI.
    raw=socket.create_connection((ips[0],443),timeout=5)
    try:self.sock=ssl.create_default_context().wrap_socket(raw,server_hostname=self.host)
    except BaseException:raw.close();raise
  return self.do_open(Connection,req)
class S3:
 def __init__(self,config,writer,transport=None,clock=now):
  self.c=config;self.w=writer;self.clock=clock;u=urllib.parse.urlsplit(config['endpoint'])
  if u.scheme!='https' or not u.hostname or u.netloc!=u.hostname or u.path not in ('','/') or u.query or u.fragment or not re.fullmatch(r'[a-z0-9.-]+',u.hostname) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',config['bucket']):raise ValueError('EGRESS')
  for ip in config['pinned_ips']:
   if not ipaddress.ip_address(ip).is_global:raise ValueError('EGRESS')
  if not config['pinned_ips']:raise ValueError('EGRESS')
  self.host=u.hostname;self.transport=transport or urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),PinnedHTTPS(self.host,config['pinned_ips'])).open
 def request(self,method,key,body=b'',headers=None):
  if not re.fullmatch(r'[a-zA-Z0-9/_.-]{1,240}',key):raise ValueError('OBJECT_KEY')
  stamp=self.clock().strftime('%Y%m%dT%H%M%SZ');date=stamp[:8];payload=hashlib.sha256(body).hexdigest();uri='/'+self.c['bucket']+'/'+key
  hh={'host':self.host,'x-amz-date':stamp,'x-amz-content-sha256':payload,**(headers or {})};hh={k.lower():str(v).strip() for k,v in hh.items()};names=';'.join(sorted(hh));canonical='\n'.join([method,uri,'',''.join(k+':'+hh[k]+'\n' for k in sorted(hh)),names,payload]);scope=date+'/'+self.c['region']+'/s3/aws4_request';tosign='AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hashlib.sha256(canonical.encode()).hexdigest()
  secret=('AWS4'+self.w['secret_key']).encode()
  for v in (date,self.c['region'],'s3','aws4_request'):secret=hmac.new(secret,v.encode(),hashlib.sha256).digest()
  hh['authorization']='AWS4-HMAC-SHA256 Credential='+self.w['access_key']+'/'+scope+', SignedHeaders='+names+', Signature='+hmac.new(secret,tosign.encode(),hashlib.sha256).hexdigest()
  req=urllib.request.Request('https://'+self.host+uri,data=body if method=='PUT' else None,headers=hh,method=method)
  try:
   with self.transport(req,timeout=5) as r:
    if r.status not in (200,201,204):raise ValueError('SINK')
    data=r.read(2049)
    if len(data)>2048:raise ValueError('SINK')
    return {k.lower():v for k,v in r.headers.items()},data
  except urllib.error.HTTPError as e:
   if e.code==404:return None,None
   raise ValueError('SINK') from None
 def locked(self,headers,until):
  if not headers or not re.fullmatch(r'[!-~]{1,512}',headers.get('x-amz-version-id','')) or headers.get('x-amz-object-lock-mode')!='COMPLIANCE' or not headers.get('x-amz-version-id') or utc(headers.get('x-amz-object-lock-retain-until-date'))<until:raise ValueError('OBJECT_LOCK')
 def put_locked(self,key,body,until,condition):
  hh={'x-amz-object-lock-mode':'COMPLIANCE','x-amz-object-lock-retain-until-date':iso(until),'content-md5':base64.b64encode(hashlib.md5(body).digest()).decode(),**condition}
  put,_=self.request('PUT',key,body,hh)
  if not put or not put.get('x-amz-version-id'):raise ValueError('OBJECT_LOCK')
  head,_=self.request('HEAD',key);self.locked(head,until)
  if head['x-amz-version-id']!=put['x-amz-version-id']:raise ValueError('SINK_RACE')
  return head
class Exporter:
 def __init__(self,config,service_public,seed,s3,clock=now):
  self.c=config;self.pub=service_public;self.seed=seed;self.s3=s3;self.clock=clock
 def accept(self,data,uid):
  if uid!=self.c['controller_uid']:raise ValueError('PEER')
  if len(data)>1024 or not data.endswith(b'\n') or data.count(b'\n')!=1:raise ValueError('RECORD')
  def unique(pairs):
   r={}
   for k,v in pairs:
    if k in r:raise ValueError('RECORD')
    r[k]=v
   return r
  r=json.loads(data,object_pairs_hook=unique)
  fields={'v','seq','digest','time','install_id','boot_id','sig'}
  if not isinstance(r,dict) or set(r) not in (fields,fields|{'replay_at','replay_sig'}) or type(r['v'])!=int or r['v']!=1 or type(r['seq'])!=int or not 0<r['seq']<=9007199254740991 or not isinstance(r['digest'],str) or not re.fullmatch('[0-9a-f]{64}',r['digest']) or not all(isinstance(r[k],str) and UUID.fullmatch(r[k]) for k in ('install_id','boot_id')) or r['install_id']!=self.c['install_id']:raise ValueError('RECORD')
  def signature(value):
   if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9+/]{86}==',value):raise ValueError('SIGNATURE')
   raw=base64.b64decode(value,validate=True)
   if base64.b64encode(raw).decode()!=value:raise ValueError('SIGNATURE')
   return raw
  # The original signature/evidence is immutable. Refresh authenticates the
  # entire original record, including sig; it never replaces its signed time.
  if 'replay_at' in r:
   replay_sig=signature(r.pop('replay_sig'))
   if not verify(self.pub,jcs(r),replay_sig):raise ValueError('SIGNATURE')
   replay_at=utc(r.pop('replay_at'))
   if utc(r['time'])>replay_at or abs((self.clock()-replay_at).total_seconds())>120:raise ValueError('STALE')
  elif abs((self.clock()-utc(r['time'])).total_seconds())>120:raise ValueError('STALE')
  original=dict(r);sig=signature(r.pop('sig'))
  if not verify(self.pub,jcs(r),sig):raise ValueError('SIGNATURE')
  prefix='checkpoints/'+r['install_id']+'/';highest=prefix+'highest.json';hh,hb=self.s3.request('GET',highest)
  prior=json.loads(hb) if hh else None
  if hh:self.s3.locked(hh,self.clock())
  if prior and (type(prior.get('seq'))!=int or prior['seq']>r['seq']):raise ValueError('ROLLBACK')
  if prior and prior['seq']==r['seq'] and prior.get('digest')!=r['digest']:raise ValueError('CONFLICT')
  # seq is the audit head, not a consecutive checkpoint counter. Exported heads
  # may jump after 100 events/a minute; stored outbox records are drained in
  # order by the controller. Never permit rollback or a conflicting same head.
  until=utc(iso(self.clock()+datetime.timedelta(days=self.c['retention_days'])));key=prefix+str(r['seq'])+'.json'
  eh,eb=self.s3.request('GET',key)
  if eh:
   existing=json.loads(eb)
   # A quiet audit head/retried SQL ACK replays its original signed evidence.
   # Acknowledge the existing immutable version without a second PUT; equal
   # seq/digest alone never permits replacing its time, boot or signature.
   if existing!=original:raise ValueError('CONFLICT')
   self.s3.locked(eh,self.clock());head=eh
  elif prior and prior['seq']==r['seq']:raise ValueError('SINK_DIVERGED')
  else:head=self.s3.put_locked(key,jcs({**r,'sig':base64.b64encode(sig).decode()}),until,{'if-none-match':'*'})
  # Highest is also versioned COMPLIANCE retained; CAS prevents two exporters
  # racing or a stale restart replacing the sink's expected head.
  if not prior or prior['seq']<r['seq']:
   if hh and not hh.get('etag'):raise ValueError('SINK')
   self.s3.put_locked(highest,jcs({'seq':r['seq'],'digest':r['digest']}),until,{'if-match':hh['etag']} if hh else {'if-none-match':'*'})
  ack={'v':1,'seq':r['seq'],'digest':r['digest'],'sink':'s3-object-lock','object_key':key,'version_id':head['x-amz-version-id'],'retain_until':head['x-amz-object-lock-retain-until-date']}
  ack['ack_sig']=base64.b64encode(sign(self.seed,jcs(ack))).decode();return ack

def main():
 sys.path.insert(0,os.path.dirname(os.path.realpath(__file__)))
 from launch_broker import protected_json
 if os.geteuid()!=0:raise ValueError('PEER')
 c=protected_json('/etc/sjcos-browser/exporter.json')
 c.setdefault('endpoint','https://s3.us-west-004.backblazeb2.com');c.setdefault('region','us-west-004');c.setdefault('retention_days',731)
 if type(c['retention_days'])!=int or not 731<=c['retention_days']<=3650:raise ValueError('CONFIG')
 creds='/run/credentials/sjcos-browser-checkpoint-exporter.service/'
 seed=key_bytes(open(creds+'exporter-key','rb').read(),True);pub=key_bytes(open(creds+'checkpoint-public','rb').read());s3=S3(c,json.load(open(creds+'sink-writer')));exporter=Exporter(c,pub,seed,s3)
 import pwd
 account=pwd.getpwnam('sjcos-browser-exporter')
 if account.pw_uid in (0,c['controller_uid'],998):raise ValueError('CONFIG')
 path='/run/sjcos-browser-exporter/checkpoint.sock';s=socket.socket(socket.AF_UNIX);s.bind(path);os.chown(path,0,c['controller_gid']);os.chmod(path,0o660);s.listen(2)
 os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid)
 try:
  while True:
   conn,_=s.accept()
   with conn:
    try:
     conn.settimeout(2);_,uid,_=struct.unpack('3i',conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));data=b''
     if uid!=c['controller_uid']:raise ValueError('PEER')
     while not data.endswith(b'\n'):
      b=conn.recv(1025-len(data))
      if not b or len(data)+len(b)>1024:raise ValueError('RECORD')
      data+=b
     result=exporter.accept(data,uid)
    except Exception as e:result={'v':1,'error':str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z_]{1,24}',str(e)) else 'EXPORT_FAILED'}
    try:conn.sendall(jcs(result)+b'\n')
    except OSError:pass
 finally:s.close() # root-owned RuntimeDirectory/socket removed by systemd
if __name__=='__main__':main()
