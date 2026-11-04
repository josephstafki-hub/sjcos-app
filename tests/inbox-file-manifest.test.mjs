import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileManifestKey,readFileManifest,saveFileManifest,missingFiles} from '../lib/inbox-file-manifest.ts';
test('Back/Forward recovery remembers names, never pretends to persist file bytes, and isolates drafts',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const key=fileManifestKey('Builder@example.test','owner','awning:review');
 const files=[new File(['survey'],'awning-survey.pdf',{type:'application/pdf',lastModified:77})];
 assert.equal(saveFileManifest(store,key,files),true);
 assert.deepEqual(readFileManifest(store,key),[{name:'awning-survey.pdf',size:6,type:'application/pdf',lastModified:77}]);
 assert.deepEqual(Object.keys(JSON.parse(map.get(key))[0]),['name','size','type','lastModified']);
 assert.deepEqual(readFileManifest(store,fileManifestKey('staff@example.test','staff','awning:review')),[]);
 assert.deepEqual(missingFiles(readFileManifest(store,key),files),[]);
 assert.equal(missingFiles(readFileManifest(store,key),[new File(['different'],'awning-survey.pdf')]).length,1);
 saveFileManifest(store,key,[]);assert.deepEqual(readFileManifest(store,key),[]);
});
test('corrupt or unavailable local storage is an explicit failure and never a recovered attachment',()=>{
 assert.deepEqual(readFileManifest({getItem:()=>'{broken'},'key'),[]);
 assert.deepEqual(readFileManifest({getItem:()=>'[{"name":123}]'},'key'),[]);
 assert.equal(saveFileManifest({setItem(){throw Error('quota')}},'key',[{name:'photo.png',size:5,type:'image/png',lastModified:9}]),false);
});
