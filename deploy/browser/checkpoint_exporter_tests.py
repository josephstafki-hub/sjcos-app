import os,sys,importlib.util,json,datetime,base64,urllib.error,io
spec=importlib.util.spec_from_file_location('exporter',os.path.join(os.path.dirname(__file__),'checkpoint-exporter.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# RFC8032 vector1, plus Node interoperability checked in the JS file.
seed=bytes.fromhex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');pub=m.public(seed)
assert pub.hex()=='d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
assert m.sign(seed,b'').hex()=='e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
t=m.now();install='11111111-1111-4111-8111-111111111111';c={'controller_uid':777,'install_id':install,'endpoint':'https://s3.us-west-004.backblazeb2.com','pinned_ips':['8.8.8.8'],'bucket':'sjcos-audit','region':'us-west-004','retention_days':731}
case=sys.argv[1];objects={};calls=[]
lost=False
class Response:
 def __init__(self,headers,data=b''):self.headers=headers;self.data=data;self.status=200
 def read(self,_):return self.data
 def __enter__(self):return self
 def __exit__(self,*_):pass
def transport(req,timeout):
 global lost
 assert req.host=='s3.us-west-004.backblazeb2.com';assert req.full_url.startswith(c['endpoint']+'/sjcos-audit/');calls.append(req)
 key=req.full_url.split('/sjcos-audit/')[1];headers={k.lower():v for k,v in req.headers.items()};method=req.method
 assert 'AWS4-HMAC-SHA256' in headers['authorization']
 if case=='redirect':raise ValueError('REDIRECT')
 if method=='PUT':
  old=objects.get(key)
  if headers.get('if-none-match')=='*':assert old is None
  if 'if-match' in headers:assert old[0]['etag']==headers['if-match']
  hh={'x-amz-version-id':str(len(calls)),'x-amz-object-lock-mode':headers['x-amz-object-lock-mode'],'x-amz-object-lock-retain-until-date':headers['x-amz-object-lock-retain-until-date'],'etag':'"'+str(len(calls))+'"'}
  if case=='missing-lock':hh.pop('x-amz-object-lock-mode')
  if case=='missing-version':hh.pop('x-amz-version-id')
  objects[key]=(hh,req.data)
  if case=='replay-lost-sink-ack' and key.endswith('/10.json') and not lost:lost=True;raise ValueError('SINK')
  if case=='unchanged-lost-highest-ack' and key.endswith('/highest.json') and not lost:lost=True;raise ValueError('SINK')
  return Response(hh)
 if key not in objects:raise urllib.error.HTTPError(req.full_url,404,'missing',{},io.BytesIO())
 hh,data=objects[key];return Response(hh,data if method=='GET' else b'')
def record(seq=10,digest='a'*64,when=t):
 r={'v':1,'seq':seq,'digest':digest,'time':m.iso(when),'install_id':install,'boot_id':install};r['sig']=base64.b64encode(m.sign(seed,m.jcs(r))).decode();return m.jcs(r)+b'\n'
def denied(fn):
 try:fn()
 except (ValueError,KeyError):return
 raise AssertionError('accepted forbidden export')
def replay(original,when=t,**changes):
 r={**json.loads(original),'replay_at':m.iso(when),**changes};r['replay_sig']=base64.b64encode(m.sign(seed,m.jcs(r))).decode();return m.jcs(r)+b'\n'
if case=='wrong-host':denied(lambda:m.S3({**c,'endpoint':'https://evil.example/path'},{}));denied(lambda:m.PinnedHTTPS('s3.us-west-004.backblazeb2.com',['8.8.8.8']).https_open(m.urllib.request.Request('https://evil.example/')));assert not calls
else:
 sink=m.S3(c,{'access_key':'test','secret_key':'test'},transport=transport,clock=lambda:t);e=m.Exporter(c,pub,seed,sink,clock=lambda:t)
 if case=='wire':
  payload=json.load(sys.stdin);t=m.utc(payload['now']);e=m.Exporter(c,base64.b64decode(payload['public']),seed,sink,clock=lambda:t)
  # Carry the fake S3 state across JS-driven exporter process restarts.
  objects.update({k:(v[0],base64.b64decode(v[1])) for k,v in payload.get('objects',{}).items()})
  ack=e.accept(m.jcs(payload['wire'])+b'\n',777);print(json.dumps({'ack':ack,'stored':json.loads(objects[ack['object_key']][1]),'puts':sum(req.method=='PUT' for req in calls),'objects':{k:[v[0],base64.b64encode(v[1]).decode()] for k,v in objects.items()}}))
 elif case.startswith('replay-'):
  original=record(seq=1 if case=='replay-head-jump' else 10,when=t-datetime.timedelta(seconds=181));wire=replay(original)
  if case=='replay-stale':denied(lambda:e.accept(replay(original,t-datetime.timedelta(seconds=121)),777));assert not calls
  elif case=='replay-forged':denied(lambda:e.accept(wire.replace(b'"replay_at":"',b'"replay_at":"1'),777));assert not calls
  elif case=='replay-original-forged':denied(lambda:e.accept(replay(original,digest='b'*64),777));assert not calls
  elif case=='replay-future-original':denied(lambda:e.accept(replay(record(when=t+datetime.timedelta(seconds=1))),777));assert not calls
  elif case=='replay-extra-field':denied(lambda:e.accept(replay(original,extra=True),777));assert not calls
  else:
   if case=='replay-lost-sink-ack':denied(lambda:e.accept(wire,777))
   ack=e.accept(wire,777);key=ack['object_key'];stored=objects[key][1];assert json.loads(stored)==json.loads(original)
   # Restart all exporter state; SQL ACK loss must reconcile immutable object.
   e=m.Exporter(c,pub,seed,sink,clock=lambda:t)
   if case=='replay-head-jump':
    advanced=e.accept(replay(record(seq=100,when=t-datetime.timedelta(seconds=181))),777);assert advanced['seq']==100
    assert json.loads(objects['checkpoints/'+install+'/highest.json'][1])=={'seq':100,'digest':'a'*64}
    denied(lambda:e.accept(wire,777))
   elif case=='replay-conflict':denied(lambda:e.accept(replay(record(digest='b'*64,when=t-datetime.timedelta(seconds=181))),777))
   else:
    assert e.accept(replay(original,t+datetime.timedelta(seconds=1)),777)==ack;assert objects[key][1]==stored
    assert sum(req.method=='PUT' and req.full_url.endswith('/10.json') for req in calls)==1
 elif case.startswith('unchanged-'):
  original=record();wire=replay(original)
  if case=='unchanged-lost-highest-ack':denied(lambda:e.accept(wire,777))
  ack=e.accept(wire,777);snapshot=dict(objects);puts=sum(req.method=='PUT' for req in calls)
  for elapsed in (61,122,3600):
   t+=datetime.timedelta(seconds=elapsed)
   if case=='unchanged-restart':e=m.Exporter(c,pub,seed,sink,clock=lambda:t)
   repeated=e.accept(replay(original,t),777)
   assert repeated==ack and objects==snapshot
   assert sum(req.method=='PUT' for req in calls)==puts
   assert m.verify(pub,m.jcs({k:v for k,v in repeated.items() if k!='ack_sig'}),base64.b64decode(repeated['ack_sig']))
  assert json.loads(objects[ack['object_key']][1])==json.loads(original)
 elif case.startswith('same-seq-'):
  original=record();e.accept(original,777);snapshot=dict(objects);puts=sum(req.method=='PUT' for req in calls)
  changed=json.loads(record(digest='b'*64) if case=='same-seq-digest' else record(when=t+datetime.timedelta(seconds=1)))
  if case=='same-seq-boot':
   changed=json.loads(original);changed['boot_id']='22222222-2222-4222-8222-222222222222';changed.pop('sig');changed['sig']=base64.b64encode(m.sign(seed,m.jcs(changed))).decode()
  e=m.Exporter(c,pub,seed,sink,clock=lambda:t)
  try:e.accept(m.jcs(changed)+b'\n',777)
  except ValueError as error:assert str(error)=='CONFLICT',str(error)
  else:raise AssertionError('same-sequence evidence substitution accepted')
  assert objects==snapshot and sum(req.method=='PUT' for req in calls)==puts
 elif case=='valid':
  ack=e.accept(record(),777);sig=base64.b64decode(ack.pop('ack_sig'));assert m.verify(pub,m.jcs(ack),sig);assert len(objects)==2;print(json.dumps({'ack':ack,'sig':base64.b64encode(sig).decode(),'public':base64.b64encode(pub).decode()}))
 elif case=='forged-signature':denied(lambda:e.accept(record().replace(b'"digest":"a',b'"digest":"b'),777));assert not calls
 elif case=='stale-signature':denied(lambda:e.accept(record(when=t-datetime.timedelta(seconds=121)),777));assert not calls
 elif case=='wrong-peer':denied(lambda:e.accept(record(),778));assert not calls
 elif case=='oversize':denied(lambda:e.accept(b'x'*1025,777));assert not calls
 elif case in ('rollback','restart-highest','conflict'):
  e.accept(record(),777);e=m.Exporter(c,pub,seed,sink,clock=lambda:t)
  if case=='conflict':denied(lambda:e.accept(record(digest='b'*64),777))
  else:denied(lambda:e.accept(record(seq=9),777))
 elif case in ('missing-lock','missing-version','redirect'):denied(lambda:e.accept(record(),777))
 else:raise AssertionError(case)
