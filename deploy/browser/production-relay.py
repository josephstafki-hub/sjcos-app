#!/usr/bin/python3
"""Minimal fixed peer relay: no SQL, launch, CDP, crypto keys or module loader.
Root owns public sockets; the two endpoints are always separate nonroot controller uid. Bounded
8 connections, 320KiB per direction, 2s control/65s frames. Controller verifies
all purpose HMACs, proof associations and current authority at the other end.
"""
import os,socket,struct,selectors,time,pathlib
PUBLIC={'/run/sjcos-browser/control.sock':('/run/sjcos-browser-runtime/web.sock',2),'/run/sjcos-browser/frames.sock':('/run/sjcos-browser-runtime/frames.sock',65)}
def serve(web_uid,controller_uid,web_gid):
 if os.geteuid()!=0 or controller_uid in (0,998) or web_uid<=0:raise ValueError()
 selector=selectors.DefaultSelector();pairs={};listeners=[]
 def close(p):
  if p.get('closed'):return
  p['closed']=True
  for s in p['sockets']:
   pairs.pop(s,None)
   try:selector.unregister(s)
   except KeyError:pass
   s.close()
 def events(s,p):
  mask=(selectors.EVENT_READ if s not in p['eof'] and len(p['pending'][p['other'][s]])<320*1024 else 0)|(selectors.EVENT_WRITE if p['pending'][s] else 0)
  try:selector.unregister(s)
  except KeyError:pass
  if mask:selector.register(s,mask,p)
 try:
  for public,(target,timeout) in PUBLIC.items():
   parent=pathlib.Path(public).parent.stat()
   if parent.st_uid!=0 or parent.st_mode&0o022:raise ValueError()
   listener=socket.socket(socket.AF_UNIX);listener.bind(public);os.chmod(public,0o660);os.chown(public,0,web_gid);listener.listen(8);listener.setblocking(False);listeners.append(listener);selector.register(listener,selectors.EVENT_READ,(target,timeout))
  while True:
   for key,mask in selector.select(1):
    s=key.fileobj;p=key.data
    if isinstance(p,tuple):
     client,_=s.accept();upstream=None
     try:
      pid,uid,gid=struct.unpack('3i',client.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
      if uid not in (0,web_uid) or len(pairs)>=16:raise ValueError()
      target,timeout=p;t=pathlib.Path(target).lstat()
      if t.st_uid!=controller_uid or pathlib.Path(target).is_symlink() or t.st_mode&0o007:raise ValueError()
      upstream=socket.socket(socket.AF_UNIX);upstream.settimeout(2);upstream.connect(target)
      if struct.unpack('3i',upstream.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]!=controller_uid:raise ValueError()
      client.setblocking(False);upstream.setblocking(False)
      pair={'sockets':(client,upstream),'other':{client:upstream,upstream:client},'pending':{client:bytearray(),upstream:bytearray()},'deadline':time.monotonic()+timeout,'closed':False,'eof':set()}
      for sock in pair['sockets']:pairs[sock]=pair;events(sock,pair)
     except (ValueError,OSError):
      client.close()
      if upstream is not None:upstream.close()
     continue
    try:
     if mask&selectors.EVENT_READ:
      room=320*1024-len(p['pending'][p['other'][s]])
      data=s.recv(min(8192,room))
      if not data:
       if s is p['sockets'][0]:close(p);continue
       p['eof'].add(s)
      else:p['pending'][p['other'][s]].extend(data)
     if mask&selectors.EVENT_WRITE and p['pending'][s]:
      n=s.send(p['pending'][s]);del p['pending'][s][:n]
     if p['sockets'][1] in p['eof'] and not p['pending'][p['sockets'][0]]:close(p)
     else:
      for sock in p['sockets']:events(sock,p)
    except BlockingIOError:pass
    except OSError:close(p)
   for p in list(pairs.values()):
    if time.monotonic()>=p['deadline']:close(p)
 finally:
  for p in list(pairs.values()):close(p)
  for s in listeners:s.close()
  selector.close()
if __name__=='__main__':
 try:
  import pwd
  web=pwd.getpwnam('joe');controller=pwd.getpwnam('sjcos-browser-controller')
  serve(web.pw_uid,controller.pw_uid,web.pw_gid)
 except Exception:raise SystemExit('BROWSER_RELAY_REFUSED')
