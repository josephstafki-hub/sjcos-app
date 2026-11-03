import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openPendingStore,clearAllPending,storeName} from '../lib/checklist-coverage/offline-store.ts';

// Minimal in-memory IndexedDB: enough of open/upgrade/transactions/deleteDatabase
// for the adapter, with switches to simulate a denied or full store.
function fakeIDB({denyOpen=false,quota=false}={}){
 const dbs=new Map(); // name -> {version, stores: Map<name, Map>}
 const later=(fn)=>setTimeout(fn,0);
 const live=new Set();
 function makeDb(name,rec){
  const db={name,get version(){return rec.version;},closed:false,onversionchange:null,
   objectStoreNames:{contains:(n)=>rec.stores.has(n)},
   createObjectStore(n){rec.stores.set(n,new Map());},
   close(){db.closed=true;live.delete(db);},
   transaction(n,mode){
    if(db.closed) throw new Error('InvalidStateError');
    if(!rec.stores.has(n)) throw new Error('NotFoundError');
    const t={oncomplete:null,onerror:null,onabort:null,error:null};
    const data=rec.stores.get(n);
    const req=(fn)=>{const r={onsuccess:null,onerror:null,result:undefined,error:null};later(()=>{
      try{r.result=fn();r.onsuccess?.();later(()=>t.oncomplete?.());}
      catch(e){r.error=e;t.error=e;r.onerror?.();t.onerror?.();}});return r;};
    t.objectStore=()=>({
     get:(k)=>req(()=>data.has(k)?structuredClone(data.get(k)):undefined),
     put:(v,k)=>req(()=>{if(mode!=='readwrite')throw new Error('ReadOnlyError');if(quota){const e=new Error('QuotaExceededError');e.name='QuotaExceededError';throw e;}data.set(k,structuredClone(v));return k;}),
     delete:(k)=>req(()=>{data.delete(k);}),
    });
    return t;
   }};
  live.add(db);return db;
 }
 return {
  dbs,live,
  open(name,version){
   const r={onsuccess:null,onerror:null,onupgradeneeded:null,onblocked:null,result:null,error:null};
   later(()=>{
    if(denyOpen){r.error=new Error('SecurityError');r.onerror?.();return;}
    let rec=dbs.get(name);
    if(!rec){rec={version:0,stores:new Map()};dbs.set(name,rec);}
    const target=version??(rec.version||1);
    if(target<rec.version){r.error=new Error('VersionError');r.onerror?.();return;}
    if(target>rec.version){
     for(const other of live) if(other.name===name) other.onversionchange?.();
     rec.version=target;r.result=makeDb(name,rec);r.onupgradeneeded?.();
    } else r.result=makeDb(name,rec);
    r.onsuccess?.();
   });
   return r;
  },
  deleteDatabase(name){const r={onsuccess:null,onerror:null,onblocked:null};later(()=>{dbs.delete(name);r.onsuccess?.();});return r;},
 };
}

const S1='11111111-1111-4111-8111-111111111111';
const entry=(user,created_at=Date.now())=>({user_id:user,created_at,operations:[{kind:'set_item',op:{operation_id:crypto.randomUUID(),expected_revision:3,state:'covered'},sent:false}]});

test('one database sjcos-calls, store pending:<user>, keyed by session; survives reopen (reload)',async()=>{
 const idb=fakeIDB();
 const a=await openPendingStore(idb,'alice');
 await a.save(S1,entry('alice'));
 a.close();
 assert.ok(idb.dbs.get('sjcos-calls').stores.has(storeName('alice')));
 const again=await openPendingStore(idb,'alice');
 const got=await again.load(S1);
 assert.equal(got.operations.length,1);assert.equal(got.operations[0].op.expected_revision,3);
 await again.remove(S1);assert.equal(await again.load(S1),null);
});

test('another signed-in user never sees the first user’s queue; wrong-user writes refused',async()=>{
 const idb=fakeIDB();
 const a=await openPendingStore(idb,'alice');await a.save(S1,entry('alice'));
 const b=await openPendingStore(idb,'bob'); // adds bob's store with a version upgrade while alice is open
 assert.equal(await b.load(S1),null);
 await assert.rejects(()=>b.save(S1,entry('alice')),/IDB_WRONG_USER/);
 // even an entry planted in bob's store with alice's id reads as nothing
 idb.dbs.get('sjcos-calls').stores.get('pending:bob').set(S1,entry('alice'));
 assert.equal(await b.load(S1),null);
});

test('entries expire after 24 h and are removed on read',async()=>{
 const idb=fakeIDB();
 const a=await openPendingStore(idb,'alice');
 await a.save(S1,entry('alice',Date.now()-86400000-1));
 assert.equal(await a.load(S1),null);
 assert.equal(idb.dbs.get('sjcos-calls').stores.get('pending:alice').has(S1),false);
});

test('logout clears every partition',async()=>{
 const idb=fakeIDB();
 const a=await openPendingStore(idb,'alice');await a.save(S1,entry('alice'));a.close();
 await clearAllPending(idb);
 assert.equal(idb.dbs.has('sjcos-calls'),false);
 await clearAllPending(undefined);
});

test('denied or full storage rejects so the page can warn and keep edits in memory',async()=>{
 await assert.rejects(()=>openPendingStore(undefined,'alice'),/IDB_UNAVAILABLE/);
 await assert.rejects(()=>openPendingStore(fakeIDB({denyOpen:true}),'alice'));
 const full=await openPendingStore(fakeIDB({quota:true}),'alice');
 await assert.rejects(()=>full.save(S1,entry('alice')),/Quota/);
});
