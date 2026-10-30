import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
let role = 'owner';
let captured;
globalThis.__workbenchTest = {
  requireAccess: async () => ({ role }),
  query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; },
};
registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('@/') || s === 'lucide-react' || s === 'next/link') return { url: `stub:${s}`, shortCircuit: true };
    return next(s, c);
  },
  load(url, c, next) {
    if (url === 'stub:@/lib/db') return { format: 'module', source: 'export const query = globalThis.__workbenchTest.query;', shortCircuit: true };
    if (url === 'stub:@/lib/dal') return { format: 'module', source: 'export const requireAccess = globalThis.__workbenchTest.requireAccess;', shortCircuit: true };
    if (url === 'stub:@/lib/engine-constants') return { format: 'module', source: 'export const STATUS_LABEL = {};', shortCircuit: true };
    if (url.startsWith('stub:')) return { format: 'module', source: 'export default "a"; export const Shell="main", WorkbenchLive="article", Button="button", EmptyState="aside", PageHeader="header", ScanSearch="i";', shortCircuit: true };
    if (url.endsWith('/workbench/page.tsx')) {
      const result = ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: 'page.tsx', reportDiagnostics: true });
      assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
      return { format: 'module', source: result.outputText, shortCircuit: true };
    }
    return next(url, c);
  },
});
const { default: Workbench } = await import('../app/(os)/workbench/page.tsx');
test('search covers every open to-do with literal wildcard text and paged results', async () => {
  await Workbench({ searchParams: Promise.resolve({ q: '50%_off', page: '2' }) });
  assert.match(captured.sql, /status NOT IN \('done','cancelled'\)/);
  assert.match(captured.sql, /LIMIT 31 OFFSET \$3/);
  assert.deepEqual(captured.params, ['50%_off', '%50\\%\\_off%', 30]);
});
test('staff and selected subjects never query the company-wide picker', async () => {
  captured = undefined;
  role = 'staff';
  await Workbench({ searchParams: Promise.resolve({}) });
  assert.equal(captured, undefined);
  role = 'owner';
  await Workbench({ searchParams: Promise.resolve({ s: 'selected-item' }) });
  assert.equal(captured, undefined);
});
