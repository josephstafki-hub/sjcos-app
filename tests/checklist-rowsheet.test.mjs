// Mounted regressions for the discovery checklist's row sheet and dialog
// surface (build review R2). The real RowSheet / Sheet components run on a
// small simulated React host: their hooks, render output and click/change
// handlers execute exactly as written; child components (Btn, CoverageMark)
// are inert markers found by props. No browser, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const answers = require('../lib/checklist-coverage/answers.ts');
const leadOrder = require('../lib/checklist-coverage/lead-order.ts');

function compile(file) {
  return ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

/** A one-component React host: hooks keep their slots across renders; effects run after each render. */
function host(file, stubs, globals = {}) {
  const slots = [], effects = []; let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    useState: (init) => { const i = cursor++; slots[i] ??= { v: typeof init === 'function' ? init() : init }; return [slots[i].v, (v) => { slots[i].v = typeof v === 'function' ? v(slots[i].v) : v; }]; },
    useRef: (init) => { const i = cursor++; return slots[i] ??= { current: init }; },
    useMemo: (fn, deps) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { v: fn(), deps }; return slots[i].v; },
    useId: () => ':r1:',
    useEffect: (fn, deps) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) { slots[i]?.clean?.(); slots[i] = { deps }; effects.push(() => { slots[i].clean = fn(); }); } },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const all = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': new Proxy({}, { get: (_t, name) => name }), ...stubs };
  const exports = {};
  runInNewContext(compile(file), { exports, require: (s) => { if (!(s in all)) throw new Error(`unstubbed import ${s}`); return all[s]; }, ...globals });
  return {
    exports,
    render(component, props) { cursor = 0; const out = exports[component](props); for (const e of effects.splice(0)) e(); return out; },
  };
}

function* walk(node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if ('type' in node && 'props' in node) {
    yield node;
    for (const [k, v] of Object.entries(node.props)) if (k === 'children' || k === 'footer' || k === 'title') yield* walk(v);
    if (node.portal) yield* walk(node.portal);
  }
}
const text = (node) => (node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children));
const find = (tree, pred, what) => { for (const n of walk(tree)) if (pred(n)) return n; throw new Error(`not found: ${what}`); };

// ── RowSheet ───────────────────────────────────────────────────────────────
const Btn = function Btn() {}, Sheet = function Sheet() {}, CoverageMark = function CoverageMark() {};
function rowSheet(key, state = 'open') {
  const h = host('components/calls/checklist/RowSheet.tsx', {
    '@/components/ui/CoverageMark': { CoverageMark },
    '@/lib/use-dictation': { useDictation: () => ({ state: 'idle', start() {}, stop() {}, supported: false }) },
    '@/lib/checklist-coverage/manual': { INSURANCE_WARNING: 'insurance' },
    '@/lib/checklist-coverage/answers': answers,
    './Sheet': { Btn, Sheet },
  }, { document: { getElementById: () => null } });
  const saved = [];
  const props = { spec: { key, label: key, questions: [], covered_when: '', partial_when: '' }, view: { state, value: null, reason: null }, manualLock: false, undoTo: null, onSave: (v) => saved.push(v), onClose() {} };
  let tree = h.render('RowSheet', props);
  const api = {
    get state() { return find(tree, (n) => n.type === 'button' && n.props['data-state'] && n.props['aria-pressed'] === true, 'pressed state').props['data-state']; },
    pick(label) { find(tree, (n) => n.type === 'button' && n.props['aria-pressed'] !== undefined && !n.props['data-state'] && text(n.props.children).replace('✓', '') === label, `pill ${label}`).props.onClick(); tree = h.render('RowSheet', props); return api; },
    type(name, value) { find(tree, (n) => n.type === 'input' && n.props.id === `:r1:-${name}`, `input ${name}`).props.onChange({ target: { value } }); tree = h.render('RowSheet', props); return api; },
    check(label, on) { const box = find(tree, (n) => n.type === 'label' && text(n.props.children).includes(label), `check ${label}`); find(box, (n) => n.type === 'input' && n.props.type === 'checkbox', 'checkbox').props.onChange({ target: { checked: on } }); tree = h.render('RowSheet', props); return api; },
    tapState(s) { find(tree, (n) => n.type === 'button' && n.props['data-state'] === s, `state ${s}`).props.onClick(); tree = h.render('RowSheet', props); return api; },
    save() { find(tree, (n) => n.type === Btn && n.props.kind === 'primary', 'Save').props.onClick(); return saved.at(-1); },
  };
  return api;
}

test('Property: parts filled move the row up, deselecting one moves it back down', () => {
  const s = rowSheet('property');
  assert.equal(s.pick('Owns it').state, 'partial');
  assert.equal(s.pick('House').state, 'partial');
  assert.equal(s.pick('No HOA').state, 'covered');
  assert.equal(s.pick('No HOA').state, 'partial', 'deselecting HOA drops Covered');
  s.pick('House'); assert.equal(s.pick('Owns it').state, 'open', 'clearing every part puts it back to Open');
  s.pick('Owns it'); s.pick('Condo'); s.pick('Not sure');
  assert.deepEqual(JSON.parse(JSON.stringify(s.save())), { state: 'covered', value: { owner: 'yes', type: 'condo', hoa: 'unknown' }, reason: null });
});

test('Address: street and city without "They confirmed" is only Partly; removing a part drops it', () => {
  const s = rowSheet('address');
  s.type('street', '4410 Elm St');
  assert.equal(s.type('city', 'Edina').state, 'partial');
  assert.equal(s.check('They confirmed', true).state, 'covered');
  assert.equal(s.type('city', '').state, 'partial', 'clearing the city drops Covered');
  s.type('city', 'Edina'); assert.equal(s.check('They confirmed', false).state, 'partial', 'unconfirming drops Covered');
  s.type('street', ''); s.type('city', '');
  assert.equal(s.state, 'open');
  assert.equal(s.save().value, null);
});

test('Budget: Stated without an amount is Partly; the amount covers it; clearing goes back down', () => {
  const s = rowSheet('budget');
  assert.equal(s.pick('Stated').state, 'partial');
  assert.equal(s.type('amount_text', 'around $40k').state, 'covered');
  assert.equal(s.type('amount_text', '').state, 'partial');
  assert.equal(s.pick('Stated').state, 'open');
  assert.equal(s.pick('No budget yet').state, 'covered');
});

test('Contact: removing the email drops Covered to Partly', () => {
  const s = rowSheet('contact');
  s.type('name', 'Alex Smith'); s.type('phone_e164', '612 555 0199');
  assert.equal(s.type('email', 'alex@example.com').state, 'covered');
  assert.equal(s.type('email', '').state, 'partial');
  assert.equal(s.check('No email', true).state, 'covered');
});

test('A state Joe tapped never moves, up or down', () => {
  const s = rowSheet('property');
  s.tapState('covered');
  s.pick('Owns it'); s.pick('Owns it');
  assert.equal(s.state, 'covered', 'explicit Covered survives an answer being added and removed');
  const t = rowSheet('budget');
  t.tapState('open'); t.pick('No budget yet');
  assert.equal(t.state, 'open', 'explicit Open survives a covering answer');
  assert.equal(t.save().state, 'open');
});

test('A row that opened already Partly is not moved by the answer', () => {
  const s = rowSheet('property', 'partial');
  s.pick('Owns it'); s.pick('House'); s.pick('No HOA');
  assert.equal(s.state, 'partial');
});

test('suggestedState is conservative for structurally incomplete answers', () => {
  const { suggestedState, buildValue } = answers;
  assert.equal(suggestedState('budget', { response: 'stated' }), 'partial');
  assert.equal(suggestedState('address', { street: '123 Main', city: 'Minneapolis' }), 'partial');
  assert.equal(suggestedState('address', buildValue('address', { street: '123 Main', city: 'Minneapolis', confirmed: 'true' })), 'covered');
  assert.equal(suggestedState('found_us', { channel: 'Referral' }), 'partial');
  assert.equal(suggestedState('found_us', { channel: 'Referral', referrer: 'Pat' }), 'covered');
  assert.equal(suggestedState('next_step', { kind: 'other' }), 'partial');
  assert.equal(suggestedState('other_bids', { detail: 'maybe' }), 'partial');
});

// ── Sheet (dialog bounds) ──────────────────────────────────────────────────
function sheet(root) {
  const portals = [];
  const h = host('components/calls/checklist/Sheet.tsx', { 'react-dom': { createPortal: (el, at) => { portals.push(at); return { type: 'Portal', props: {}, portal: el }; } } },
    { document: { querySelector: (sel) => (sel === '[data-sheet-root]' ? root ?? null : null), activeElement: null, addEventListener() {}, removeEventListener() {} } });
  const results = Array.from({ length: 12 }, (_, i) => ({ type: 'li', props: { children: `Lead ${i}` } }));
  const tree = h.render('Sheet', { title: 'Link to a lead', layout: 'dialog', onClose() {}, children: results });
  const overlay = [...walk(tree)].find((n) => n.type === 'div' && /inset-0/.test(n.props.className ?? ''));
  const dialog = [...walk(tree)].find((n) => n.props.role === 'dialog');
  const body = [...walk(dialog)].find((n) => n.type === 'div' && /overflow-y-auto/.test(n.props.className ?? ''));
  return { portals, overlay, dialog, body };
}

test('Dialog sheet is bounded and scrolls its body (12 lead results stay reachable)', () => {
  for (const root of [undefined, { id: 'shell-column' }]) {
    const { portals, overlay, dialog, body } = sheet(root);
    assert.match(dialog.props.className, /max-h-\[calc\((100%|100dvh)-2rem\)\]/, 'the dialog never grows past its container');
    assert.match(dialog.props.className, /\bflex-col\b/);
    assert.match(dialog.props.className, /\bmin-h-0\b/);
    assert.match(body.props.className, /\bmin-h-0\b.*\bflex-1\b.*\boverflow-y-auto\b/, 'the results scroll inside the body');
    if (root) {
      assert.deepEqual(portals, [root], 'opens in the Shell column, not over the sidebar or dock');
      assert.match(overlay.props.className, /^absolute inset-0/);
      assert.match(dialog.props.className, /max-h-\[calc\(100%-2rem\)\]/);
    } else {
      assert.equal(portals.length, 0);
      assert.match(overlay.props.className, /^fixed inset-0/);
    }
  }
});

// ── Lead picker ordering, lead page live call ──────────────────────────────
test("The call's own lead comes first, marked, once; typed search keeps it only when it matches", () => {
  const { orderForCall } = leadOrder;
  const alex = { id: 'a', name: 'Alex Smith' }, bo = { id: 'b', name: 'Bo' }, cy = { id: 'c', name: 'Cy' };
  assert.deepEqual(orderForCall([alex], [bo, alex, cy], false).map((l) => [l.id, l.on_call]), [['a', true], ['b', false], ['c', false]]);
  assert.deepEqual(orderForCall([alex], [bo], false).map((l) => l.id), ['a', 'b'], 'recent page: the caller is added even if not recent');
  assert.deepEqual(orderForCall([alex], [bo], true).map((l) => l.id), ['b'], 'typed search: no unrelated caller injected');
  assert.equal(orderForCall([], Array.from({ length: 20 }, (_, i) => ({ id: String(i) })), false).length, 12);
});

test('liveCallForLead matches the linked lead first, then the phone of an unlinked call', () => {
  const { liveCallForLead } = leadOrder;
  const calls = [
    { id: 'other', number: '+16125550100', lead_slug: 'someone-else' },
    { id: 'byphone', number: '+16125550199', lead_slug: null },
    { id: 'linked', number: '+16125550111', lead_slug: 'alex-smith' },
  ];
  assert.equal(liveCallForLead(calls, { slug: 'alex-smith', phone: '(612) 555-0199' }).id, 'linked');
  assert.equal(liveCallForLead(calls.slice(0, 2), { slug: 'alex-smith', phone: '612-555-0199' }).id, 'byphone');
  assert.equal(liveCallForLead([{ id: 'x', number: '+16125550199', lead_slug: 'someone-else' }], { slug: 'alex-smith', phone: '6125550199' }), null, "another lead's call is not this lead's");
  assert.equal(liveCallForLead(null, { slug: 'alex-smith', phone: null }), null);
});
