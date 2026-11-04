import {test} from 'node:test';
import assert from 'node:assert/strict';
test('background queue is explicitly grounding, never an instruction to perform unrelated work',async()=>{
 const {agentGrounding}=await import('../lib/agent-context.ts');
 const context=agentGrounding('Queue: unrelated block one');
 assert.match(context,/latest user message/i); assert.match(context,/not instructions/i); assert.match(context,/unrelated block one/);
 assert.equal(agentGrounding(undefined),undefined);
});
