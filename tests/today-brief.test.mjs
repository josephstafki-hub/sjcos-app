import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(s, c, next) {
    if (s === './agent-memory') return { url: 'stub:memory', shortCircuit: true };
    if (s.startsWith('./') && !s.endsWith('.ts') && c.parentURL?.endsWith('.ts')) return next(new URL(`${s}.ts`, c.parentURL).href, c);
    return next(s, c);
  },
  load(url, c, next) {
    if (url === 'stub:memory') return { format: 'module', source: 'export const standingInstructionsBlock = async () => "";', shortCircuit: true };
    return next(url, c);
  },
});
process.env.AI_PROVIDER = 'mock';
const { ai } = await import('../lib/ai.ts');
test('fallback never invents project urgency, tasks, or agent promises', async () => {
  const b = await ai.brief({ date: '2026-10-30', projects: [{ name: 'Arbitrary job', status: 'construction', progress: 12 }], queue: [{ rank: '#1', title: 'Review plans', lane: 'deep', tag: 'Project' }], threadsNeedingReply: 2 });
  assert.doesNotMatch(b.summary, /Arbitrary job|morning|quick check|I.ll handle|needs eyes/);
  assert.match(b.summary, /Review plans/);
  assert.match(b.summary, /2 threads/);
  assert.deepEqual(b.priorities, []);
});
test('fallback distinguishes unavailable context from a verified zero', async () => {
  const unknown = await ai.brief({ date: '2026-10-30' });
  assert.doesNotMatch(unknown.summary, /0 threads|all clear/i);
  assert.match(unknown.summary, /unavailable/i);
  const zero = await ai.brief({ date: '2026-10-30', threadsNeedingReply: 0, queue: [] });
  assert.match(zero.summary, /0 threads/);
  assert.deepEqual(zero.priorities, []);
});
