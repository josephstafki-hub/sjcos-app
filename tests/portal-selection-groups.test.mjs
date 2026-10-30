import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSelectionGroups } from '../lib/portal-selection-groups.ts';
test('pending decisions stay separate from approved and declined history, including nested rooms', () => {
 const groups = [{id:1, selections:[{id:1,status:'pending'},{id:2,status:'approved'}],children:[{id:2,selections:[{id:3,status:'declined'}],children:[]}]}];
 const {pending, history} = splitSelectionGroups(groups);
 assert.deepEqual(pending[0].selections.map(s=>s.id),[1]);
 assert.equal(pending[0].children.length,0);
 assert.deepEqual(history[0].selections.map(s=>s.id),[2]);
 assert.equal(history[0].children[0].selections[0].id,3);
 assert.equal(groups[0].selections.length,2);
 assert.deepEqual(splitSelectionGroups([]),{pending:[],history:[]});
});
