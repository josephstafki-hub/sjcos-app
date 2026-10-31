// Merge coverage without a browser, server, model, file store or database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const forbidden = () => { throw new Error('No actions or external effects during render'); };
const actions = new Proxy({}, { get: () => forbidden });
const wrap = tag => ({ children, disabled, type, href, ...props }) => React.createElement(tag, { disabled, type, href, 'aria-label': props['aria-label'] }, children);
const ui = new Proxy({ Button: wrap('button'), Chip: wrap('span'), Table: wrap('table'), TableHead: wrap('thead'), TableBody: wrap('tbody'), TableRow: wrap('tr'), TableCell: wrap('td'), TablePrimaryCell: ({children,meta}) => React.createElement('td',null,children,meta), TableHeader: wrap('th') }, { get: (target, name) => target[name] ?? wrap('div') });
function component(file, name, overrides = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, ...(overrides.globals ?? {}), require(specifier) {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return require(specifier);
    if (specifier === 'next/navigation') return { useRouter: () => ({ refresh: forbidden }) };
    if (specifier === 'next/link') return { __esModule: true, default: wrap('a') };
    if (specifier === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (specifier === '@/components/ui') return ui;
    if (specifier === '@/components/ui/Toast') return { toast: forbidden };
    if (specifier.startsWith('@/lib/actions/') || specifier === '@/lib/owner-time/actions') return actions;
    if (specifier === '@/lib/run-action') return { runAction: forbidden };
    if (specifier === '@/lib/use-dialog-dismiss') return { useDialogDismiss() {} };
    if (specifier.startsWith('@/lib/')) return require(`../${specifier.slice(2)}.ts`);
    if (specifier === './FinancialTable') return { FinancialTable: wrap('table') };
    if (specifier === './ActionMenu') return { ActionMenu: wrap('div') };
    if (specifier === './PostPreview') return { PostPreview: () => null };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }});
  return exports[name];
}
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('sub-document review accepts W-9s without expiry while a COI still requires it', () => {
  const Review = component('components/subs/SubDocReview.tsx', 'SubDocReview');
  const base = { slug: 'sub', documentId: 1, typedExpiry: null };
  const coi = render(Review, { ...base, docType: 'coi' });
  const w9 = render(Review, { ...base, docType: 'w9' });
  assert.match(coi, /type="date"/);
  assert.match(coi, /<button[^>]*disabled=""[^>]*>Accept<\/button>/);
  assert.doesNotMatch(w9, /type="date"/);
  const accept = w9.match(/<button[^>]*>Accept<\/button>/)?.[0];
  assert.ok(accept);
  assert.doesNotMatch(accept, / disabled=/);
});

test('marketing (main\'s posting-agent screen) keeps Mark posted; job photos offer downloads only for approved photos', () => {
  const draft = { id: 1, title: 'Clean headline', body: 'Finished work.', status: 'draft', kind: 'social', kindLabel: 'Social', projectSlug: 'job', projectName: 'Kitchen', createdLabel: 'Oct 30', media: [], platform: null, stage: 'draft', photos: [{ id: 'allowed', name: 'Approved.jpg', shareable: true }, { id: 'private', name: 'Private.jpg', shareable: false }] };
  const stubs = { './PostingPanel': { PostingPanel: () => null, InPostToggle: () => null, StageChip: () => null, editableStage: () => true }, './PostingAccounts': { PostingAccounts: () => null } };
  const Marketing = component('components/marketing/MarketingClient.tsx', 'MarketingClient', { ...stubs, './PostPhotos': { PostPhotos: () => null } });
  assert.match(render(Marketing, { projects: [{ slug: 'job', name: 'Kitchen' }], accounts: {}, isOwner: true, drafts: [draft] }), /Mark posted/);
  const Photos = component('components/marketing/PostPhotos.tsx', 'PostPhotos', stubs);
  const html = render(Photos, { draft, isOwner: true });
  assert.match(html, /href="\/api\/files\/allowed\?download=1"/);
  assert.doesNotMatch(html, /href="\/api\/files\/private\?download=1"/);
});

test('purchase-order table retains commitment status and excludes void orders from its total', () => {
  const Orders = component('components/projects/PurchaseOrders.tsx', 'PurchaseOrders');
  const base = { title: 'Lumber', poNumber: 'PO-1', vendorName: 'Vendor', lines: [], subtotal: 12000, status: 'draft', commitmentLabel: 'Cash held for this order' };
  const html = render(Orders, { slug: 'job', orders: [{ ...base, id: 1 }, { ...base, id: 2, status: 'void', subtotal: 90000 }], vendors: [], assignedSubs: [] });
  assert.match(html, /<table>/);
  assert.match(html, /Cash held for this order/);
  assert.match(html, /Total · excluding void/);
  assert.match(html, /\$120\.00/);
  assert.doesNotMatch(html, /\$1,020\.00/);
});

test('time review keeps its recorded-time view alongside the new labor-rate controls', () => {
  const Time = component('components/time/TimeReview.tsx', 'TimeReview');
  const html = render(Time, { review: { running: null, intervals: [], flags: [] }, projects: [], rates: [], from: '', to: '' });
  assert.match(html, /Recorded time/);
  assert.match(html, /Site time requires a job/);
  assert.match(html, /aria-label="Hourly labor rate in dollars"/);
  assert.match(html, /Save rate/);
});


test('cost-book markup proposals surface the approval notice instead of reporting a completed change', async () => {
  const pending = [], feedback = [], notices = [];
  const CostBook = component('components/cost-book/CostBookClient.tsx', 'CostBookClient', {
    react: { ...React, useState: initial => [initial === '10' ? '12' : initial, v => feedback.push(v)], useTransition: () => [false, fn => pending.push(fn())] },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/actions/cost-book': { setDefaultMarkup: async value => { assert.equal(value, 12); return { ok: true, notice: 'Asked Joe to approve 12%.' }; } },
    '@/lib/run-action': { runAction: async (fn, options) => { const result = await fn(); options.onSuccess(result); return result; } },
    '@/components/ui/Toast': { toast: notice => notices.push(notice) },
    './CostItemModal': { CostItemModal: () => null },
  });
  const tree = CostBook({ data: { defaultMarkup: 10, items: [] } });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  }
  const save = nodes(tree).find(n => n.props?.children === 'Save markup');
  assert.ok(save);
  save.props.onClick();
  await Promise.all(pending);
  assert.ok(feedback.includes('Asked Joe to approve 12%.'));
  assert.ok(!feedback.includes('Saved'));
  assert.equal(notices[0].kind, 'info');
  assert.equal(notices[0].message, 'Asked Joe to approve 12%.');
});

test('engine retains repair controls and repair state within the design layout', () => {
  const Engine = component('components/engine/EngineClient.tsx', 'EngineClient', {
    './WorkItemEditor': { WorkItemEditor: () => null },
    '@/components/today/AssigneePicker': { AssigneePicker: () => null, assigneeSummary: () => '' },
  });
  const instance = { id: 'runbook', runbookSlug: 'follow-up', runbookTitle: 'Client follow-up', status: 'running', currentStep: 1, stepCount: 2, startedAt: '2026-10-30', startedBy: 'Joe', repairState: 'needs_review', blockedReason: 'Missing step' };
  const props = { engine: { items: [], assignees: [], ledgers: [], receipts: [], ownerId: 'owner', counts: { total: 0, archived: 0 } }, knowledge: [], skills: { approved: [], proposed: [], runbooks: [] }, memories: { pending: [], instructions: [], examples: [], history: [] }, activeRunbooks: [instance], canAssign: true, meId: 'owner' };
  const html = render(Engine, props);
  assert.match(html, /Needs a look/);
  assert.match(html, /Missing step/);
  assert.match(html, />Repair<\/button>/);
  const repaired = render(Engine, { ...props, activeRunbooks: [{ ...instance, repairState: 'repaired' }] });
  assert.match(repaired, /repaired/);
  assert.doesNotMatch(repaired, />Repair<\/button>/);
});


test('purchase-order send preserves the gate override and reports transport failures', async () => {
  for (const fail of [false, true]) {
    let nulls = 0;
    const pending = [], results = [], sends = [];
    const Orders = component('components/projects/PurchaseOrders.tsx', 'PurchaseOrders', {
      globals: { confirm: () => true },
      react: { ...React, useState: initial => [initial === null && ++nulls === 4 ? { poId: 1, to: 'vendor@example.test', subject: 'PO', body: 'Review order' } : initial, v => results.push(v)], useTransition: () => [false, fn => pending.push(fn())] },
      'next/navigation': { useRouter: () => ({ refresh() {} }) },
      '@/lib/actions/purchase-orders': { sendPurchaseOrder: async (...args) => {
        sends.push(args);
        if (fail) throw new Error('Transport offline');
        return args[3] === true ? { ok: true } : { ok: false, confirm: true, error: 'Cash gate holds this order' };
      } },
      '@/lib/run-action': { runAction: async fn => { try { return await fn(); } catch { return { ok: false, error: 'Could not reach the server' }; } } },
    });
    function nodes(node) {
      if (!node || typeof node !== 'object') return [];
      return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
    }
    const form = nodes(Orders({ slug: 'job', orders: [], vendors: [], assignedSubs: [] })).find(n => n.type === 'form');
    assert.ok(form);
    form.props.onSubmit({ preventDefault() {} });
    await Promise.all(pending);
    if (fail) {
      assert.equal(sends.length, 1);
      assert.ok(results.includes('Could not reach the server'));
    } else {
      assert.equal(sends.length, 2);
      assert.equal(sends[1][3], true);
      assert.ok(results.includes(null), 'successful send closes the modal');
    }
  }
});
