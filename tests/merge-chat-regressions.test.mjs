// Exercise the merged action with every external boundary stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);

function actionFor(agent) {
  const calls = { runs: [], messages: [], context: [] };
  const forbidden = () => { throw new Error('Unexpected external dependency'); };
  const unused = new Proxy({}, { get: () => forbidden });
  const stubs = {
    '@/lib/dal': { requireAccess: async () => ({ role: 'staff', name: 'Staff' }) },
    '@/lib/db': { queryOne: async () => ({ agent }) },
    '@/lib/panel-context': { loadPanelContext: async refs => { calls.context.push(refs); return 'Explicit job context'; } },
    '@/lib/attachments': { sanitizeAttachments: () => [] },
    '@/lib/orchestrator/proposals': { setEscalateHook() {} },
    '@/lib/orchestrator/thread': { lastAnsweringAgent: async () => null },
    '@/lib/orchestrator/router': { routeMessage: async () => ({ agent: 'hermes', via: 'router' }) },
    '@/lib/thread-folders': { touchThreadActivity: async () => {}, folderContextLine: async () => 'Filed job context' },
    '@/lib/ai-chat': { insertMessage: async (...args) => { calls.messages.push(args); return { id: 'message' }; }, autoTitleIfNeeded: async () => {} },
    '@/lib/dev-agents': { startClaudeRun: async (...args) => { calls.runs.push(args); return 'run'; } },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/actions/ai-chat.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, require(specifier) {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    if (specifier.startsWith('node:')) return require(specifier);
    if (specifier.startsWith('@/')) return unused;
    throw new Error(`Unexpected import: ${specifier}`);
  }});
  return { send: exports.sendMessageAction, calls };
}

test('staff pinned to Hermes or Qwen is refused before any turn or run is written', async () => {
  for (const agent of ['hermes', 'qwen']) {
    const { send, calls } = actionFor(agent);
    const result = await send('conversation', 'Review this job', 'Page context', undefined, undefined, undefined, false, [{ kind: 'project', id: 'job' }]);
    assert.equal(result.ok, false);
    assert.match(result.error, /acts as Joe/);
    assert.equal(calls.runs.length, 0);
    assert.equal(calls.messages.length, 0);
    assert.equal(calls.context[0][0].id, 'job');
  }
});

test('staff Auto routes through Claude while keeping explicit context and one-message send permission', async () => {
  const { send, calls } = actionFor('auto');
  const refs = [{ kind: 'project', id: 'job' }];
  const result = await send('conversation', 'Review this job', 'Page context', undefined, undefined, undefined, true, refs);
  assert.equal(result.ok, true);
  assert.equal(result.runId, 'run');
  assert.equal(calls.runs.length, 1);
  assert.equal(calls.runs[0][0], 'Review this job');
  assert.equal(calls.runs[0][1], 'Filed job context\n\nPage context\n\nExplicit job context');
  assert.equal(calls.runs[0][5].allowSends, true);
  assert.equal(calls.messages[0][3].pageContext, calls.runs[0][1]);
  assert.equal(calls.context[0], refs);
});
