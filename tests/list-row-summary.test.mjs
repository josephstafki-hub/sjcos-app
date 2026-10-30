import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredRowSummary } from '../lib/list-row-summary.ts';
test('open task title and known due day take precedence over last contact', () => {
  assert.equal(structuredRowSummary({ title: 'Confirm tile delivery', due: 'Nov 2' }, 'Oct 28'), 'Confirm tile delivery · Due Nov 2');
});
test('no invented due date or contact channel', () => {
  assert.equal(structuredRowSummary({ title: 'Call supplier', due: null }, null), 'Call supplier');
  assert.equal(structuredRowSummary(null, 'Oct 28'), 'Last contact Oct 28');
  assert.equal(structuredRowSummary(null, null), 'No open to-do recorded');
});

test('row disclosure keeps structured facts and full source narrative separately', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { default: ts } = await import('typescript');
  const source = readFileSync(new URL('../components/projects/NextStep.tsx', import.meta.url), 'utf8');
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: createRequire(import.meta.url) });
  const summary = 'Confirm tile delivery · Due Nov 2';
  const text = 'The client changed tile. Confirm the new order before scheduling delivery.';
  const tree = exports.NextStep({ summary, text });
  assert.equal(tree.type, 'details');
  assert.equal(tree.props.children[1].props.children, text);
  assert.ok(JSON.stringify(tree.props.children[0]).includes(summary));
  assert.equal(exports.NextStep({ summary, text: '' }).type, 'p');
});
