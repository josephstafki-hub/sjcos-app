import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverPending,OFFLINE_QUEUE} from '../lib/checklist-coverage/manual.ts';
test('recovery partitions by signed-in user and expires at 24h; storage is not an offline shell',()=>{
 const queue={user_id:'alice',created_at:1000,operations:[{operation_id:crypto.randomUUID()}]};
 assert.deepEqual(recoverPending(queue,'alice',2000),queue.operations);
 assert.deepEqual(recoverPending(queue,'bob',2000),[]);
 assert.deepEqual(recoverPending(queue,'alice',1000+86400000),[]);
 assert.deepEqual(recoverPending(queue,'alice',0),[]);
 assert.equal(OFFLINE_QUEUE.offlineShell,false);
});
