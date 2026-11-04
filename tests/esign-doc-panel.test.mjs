import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = new URL('../', import.meta.url);
globalThis.__esignReact = React;
registerHooks({
  resolve(s, c, next) {
    if (s === 'next/navigation') return { url: 'stub:nav', shortCircuit: true };
    if (s === 'next/link') return { url: 'stub:link', shortCircuit: true };
    if (s === '@/components/ui') return { url: 'stub:ui', shortCircuit: true };
    if (s === '@/lib/actions/doc-drafts') return { url: 'stub:actions', shortCircuit: true };
    if (s === '@/lib/run-action') return { url: 'stub:run', shortCircuit: true };
    if (s.startsWith('@/')) {
      const base = new URL(s.slice(2), root);
      return next(`${base.href}${existsSync(base.pathname + '.tsx') ? '.tsx' : '.ts'}`, c);
    }
    return next(s, c);
  },
  load(url, c, next) {
    const stubs = {
      'stub:nav': 'export const useRouter = () => ({ refresh() {}, push() {} });',
      'stub:link': 'export default function Link(p) { return globalThis.__esignReact.createElement("a", { href: p.href }, p.children); }',
      'stub:ui': 'export function Card(p) { return p.children; } export function Chip(p) { return p.children; }',
      'stub:run': 'export const runAction = () => { throw new Error("No actions during render"); };',
      'stub:actions': ['createDocDraftAction','updateDocDraftFieldsAction','renderDocDraftAction','submitDocDraftForSignatureAction','retryDocDraftSignatureDeliveryAction','prepareInPersonSigningAction','setDocDraftVisibilityAction','voidDocDraftAction','deleteDocDraftAction','unlockDocDraftForEditAction','draftDocNarrative'].map(n => `export const ${n} = () => {};`).join('\n'),
    };
    if (stubs[url]) return { format: 'module', source: stubs[url], shortCircuit: true };
    if (url.endsWith('.tsx')) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return next(url, c);
  },
});
const { DocTypePanel } = await import('../components/projects/DocTypePanel.tsx');
const manifest = { title: 'Formal Estimate', fields: [], key: 'estimate_doc' };
function render(props) { return renderToStaticMarkup(React.createElement(DocTypePanel, { manifest, drafts: [], templateKey: 'estimate_doc', ...props })); }
test('lead Formal Estimate section offers the rough estimate instead of an impossible creation action', () => {
  const html = render({ leadSlug: 'zz-qa-lead' });
  assert.doesNotMatch(html, /New Formal Estimate|Start one from the template/);
  assert.match(html, /Rough estimate/);
  assert.match(html, /href="\/leads\/zz-qa-lead\?tab=Rough%20estimate"/);
});
test('converted lead Formal Estimate section points to the project documents', () => {
  const html = render({ leadSlug: 'zz-qa-lead', projectSlug: 'zz-qa-converted' });
  assert.doesNotMatch(html, /New Formal Estimate/);
  assert.match(html, /project.*Formal Estimate/i);
  assert.match(html, /href="\/projects\/zz-qa-converted\?tab=Documents&amp;focus=formal-estimate"/);
});
test('failed delivery is visible on the persisted document row with a retry control', () => {
  const html = render({ slug: 'zz-qa-project', templateKey: 'precon', manifest: { ...manifest, title: 'Pre-construction Agreement' }, drafts: [{
    id: 1, template_key: 'precon', title: 'ZZ QA Agreement', status: 'submitted', client_visible: false,
    field_values: {}, fill_report: {}, missing: [], pdf_file_id: null, docx_file_id: null,
    signature_request_id: 2, createdAtLabel: '', signerName: 'ZZ QA Client', signedName: null,
    signedAtLabel: null, sentAtLabel: 'Oct 30', declineReason: null, manifest,
    delivery: { status: 'failed', note: "Gmail isn't connected, so no email went out." },
  }] });
  assert.match(html, /email not delivered/i);
  assert.match(html, /Gmail isn&#x27;t connected/);
  assert.match(html, /Retry email/);
  assert.doesNotMatch(html, /Sent to ZZ QA Client/);
});
