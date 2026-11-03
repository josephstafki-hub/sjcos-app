// Mounted regressions for build review R4 (discovery calls): the lead page's
// Start a discovery call and the live-call bar keep approvals compact, so a
// stack of approval cards never covers them. The real NotificationCenter,
// StartDiscoveryCall and LiveCallBar run on a small simulated React host with
// the real placement registry (lib/notification-placement.ts); hooks, effects,
// cleanups and click handlers execute as written. No browser, server, DB or
// approval call: the poll is a stub returning four waiting approvals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
// The registry dispatches on `window`; the components listen on the same one.
const win = new EventTarget();
globalThis.window = win;
const placement = require('../lib/notification-placement.ts');

function compile(file) {
  return ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

/** One compiled module; each mount keeps its own hook slots and cleanups. */
function host(file, stubs, globals = {}) {
  let cur = null, ids = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init) { const c = cur, i = c.cursor++; c.slots[i] ??= { v: typeof init === 'function' ? init() : init }; const s = c.slots[i]; return [s.v, (v) => { s.v = typeof v === 'function' ? v(s.v) : v; }]; },
    useRef(init) { const c = cur, i = c.cursor++; return c.slots[i] ??= { current: init }; },
    useCallback(fn, deps) { const c = cur, i = c.cursor++; if (!same(c.slots[i]?.deps, deps)) c.slots[i] = { v: fn, deps }; return c.slots[i].v; },
    useId() { const c = cur, i = c.cursor++; return (c.slots[i] ??= { v: `:r${++ids}:` }).v; },
    useEffect(fn, deps) {
      const c = cur, i = c.cursor++;
      if (same(c.slots[i]?.deps, deps)) return;
      const prev = c.slots[i], next = { deps };
      c.slots[i] = next;
      c.effects.push(() => { prev?.clean?.(); next.clean = fn(); });
    },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const all = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': new Proxy({}, { get: (_t, name) => name }), ...stubs };
  const exports = {};
  runInNewContext(compile(file), { exports, window: win, require: (s) => { if (!(s in all)) throw new Error(`unstubbed import ${s}`); return all[s]; }, ...globals });
  return {
    mount(component, props = {}) {
      const inst = { slots: [], cursor: 0, effects: [], props };
      return {
        render(next) {
          if (next) inst.props = next;
          cur = inst; inst.cursor = 0;
          const out = exports[component](inst.props);
          for (const e of inst.effects.splice(0)) e();
          return out;
        },
        unmount() { for (const s of inst.slots) s?.clean?.(); },
      };
    },
  };
}

function* walk(node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if ('type' in node && 'props' in node) {
    yield node;
    yield* walk(node.props.children);
  }
}
const text = (node) => (node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children));
const findAll = (tree, pred) => [...walk(tree)].filter(pred);
const find = (tree, pred, what) => { const n = findAll(tree, pred)[0]; if (!n) throw new Error(`not found: ${what}`); return n; };
const flush = () => new Promise((r) => setImmediate(r));

// ── The page: a top bar slot always, a page slot only where the page has one ──
let path = '/leads/qa-alex-smith';
const topbarSlot = { id: 'approval-badge-topbar' };
const pageSlot = { id: 'approval-badge-slot' };
let elements = { 'approval-badge-topbar': topbarSlot };
const document = {
  hidden: false,
  getElementById: (id) => elements[id] ?? null,
  addEventListener() {}, removeEventListener() {},
  documentElement: { style: { setProperty() {}, removeProperty() {} } },
};
const nav = { usePathname: () => path, useRouter: () => ({ push() {}, refresh() {} }) };
const ApprovalCard = function ApprovalCard() {};
const approvals = ['a', 'b', 'c', 'd'].map((k) => ({ key: `decision-${k}`, contentHash: k }));

const center = host('components/shell/NotificationCenter.tsx', {
  'react-dom': { createPortal: (node, el) => ({ type: 'portal', props: { children: node, target: el } }) },
  'next/navigation': nav,
  'next/link': { default: function Link() {} },
  '@/components/ui/Toast': { toast: () => { throw new Error('unexpected toast'); } },
  '@/lib/actions/approvals': {
    pollNotificationCenter: async () => ({ approvals, unread: 4, fresh: [], now: 'now' }),
    approveWaiting: () => { throw new Error('approval call prohibited'); },
    declineWaiting: () => { throw new Error('approval call prohibited'); },
  },
  '@/components/notifications/ApprovalCard': { ApprovalCard },
  '@/lib/notification-placement': placement,
}, { document, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setInterval: () => 0, clearInterval() {}, CustomEvent });

const Sheet = function Sheet() {}, Btn = function Btn() {};
const starter = host('components/leads/StartDiscoveryCall.tsx', {
  'next/navigation': nav,
  '@/lib/checklist-coverage/action-result': { errorCopy: (c) => c },
  '@/lib/actions/discovery-checklist': {
    discoveryCallConfirmData: async () => ({ lead: { id: 'lead-1', name: 'Alex Smith', phone: '6125550199' }, explanation: 'Your cell rings first.' }),
    startDiscoveryCall: () => { throw new Error('no call in this test'); },
  },
  '@/lib/actions/discovery-checklist-ui': { checklistLeadBySlug: async () => ({ id: 'lead-1' }) },
  '@/lib/comms/phone': { formatUsPhone: (n) => n },
  '@/components/calls/checklist/Sheet': { Btn, Sheet },
  '@/lib/notification-placement': placement,
}, { crypto: { randomUUID: () => 'op-1' }, navigator: { onLine: true } });

const liveBar = host('components/shell/LiveCallBar.tsx', {
  'next/navigation': nav,
  'next/link': { default: function Link() {} },
  '@/lib/comms/phone': { formatUsPhone: (n) => n },
  '@/lib/notification-placement': placement,
  '@/components/calls/open-call-store': { useOpenChecklist: () => null },
  '@/components/calls/checklist/signed-in': { markSignedIn() {} },
  '@/components/calls/checklist/time': { chicagoTime: () => '8:58 PM', elapsed: () => '04:59' },
  '@/components/calls/checklist/useClock': { useClock: () => 1, useSessionValue: () => null, writeSessionValue() {} },
});

/** Mount NotificationCenter and let its first poll land. */
async function mountCenter() {
  const nc = center.mount('NotificationCenter');
  nc.render(); await flush();
  return nc;
}
const cards = (tree) => findAll(tree, (n) => n.type === ApprovalCard).length;
const stack = (tree) => findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className.includes('z-[60]')).length;
const badgeIn = (tree) => {
  const portal = find(tree, (n) => n.type === 'portal', 'badge portal');
  return { target: portal.props.target, button: find(portal, (n) => n.type === 'button', 'badge button') };
};

test('lead page: approvals are compact before Start a discovery call is tapped, through its confirm, until Joe leaves the page', async () => {
  path = '/leads/qa-alex-smith';
  elements = { 'approval-badge-topbar': topbarSlot };
  assert.deepEqual(placement.currentClaims(), placement.NO_CLAIMS);
  const start = starter.mount('StartDiscoveryCall', { slug: 'qa-alex-smith', isOwner: true, calling: true });
  let startTree = start.render();
  assert.deepEqual(placement.currentClaims(), { surface: true, modal: false }, 'the header button claims compact while it is on screen');

  const nc = await mountCenter();
  let tree = nc.render();
  assert.equal(cards(tree), 0, 'four waiting, yet no card stacks over the lead header');
  assert.equal(stack(tree), 0, 'no z-60 bottom stack');
  let badge = badgeIn(tree);
  assert.equal(badge.target, topbarSlot, 'no slot on the lead page: the badge sits beside the bell');
  assert.equal(badge.button.props['aria-label'], '4 waiting on you — show decisions');
  assert.match(badge.button.props.className, /@max-sm\/shell:size-11/, 'a 44×44 chip on a phone');
  assert.ok(findAll(badge.button, (n) => n.type === 'BellRing').length, 'chip: bell icon + count');

  // The trigger is reachable and opens its confirm; the claim holds through it.
  find(startTree, (n) => n.type === 'button' && text(n).includes('Start a discovery call'), 'trigger').props.onClick();
  startTree = start.render(); await flush(); startTree = start.render();
  find(startTree, (n) => n.type === Sheet, 'confirm sheet');
  find(startTree, (n) => n.type === Btn && text(n) === 'Cancel', 'Cancel').props.onClick();
  startTree = start.render();
  assert.equal(findAll(startTree, (n) => n.type === Sheet).length, 0, 'Cancel closes the confirm');
  assert.deepEqual(placement.currentClaims(), { surface: true, modal: false }, 'still compact after the confirm closes');

  // The badge opens the cards under the top bar (z-35); Escape closes them.
  badgeIn(nc.render()).button.props.onClick();
  tree = nc.render();
  const region = find(tree, (n) => n.props.id === 'approval-decisions', 'opened decisions');
  assert.match(region.props.className, /z-\[35\]/);
  assert.equal(cards(tree), 3);
  win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  tree = nc.render();
  assert.equal(findAll(tree, (n) => n.props.id === 'approval-decisions').length, 0, 'Escape closes the decisions');

  // Leaving the lead page releases the claim; elsewhere the usual stack is back.
  start.unmount();
  assert.deepEqual(placement.currentClaims(), placement.NO_CLAIMS);
  path = '/projects';
  nc.render(); tree = nc.render();
  assert.equal(stack(tree), 1, 'the bottom-right stack is back off the lead page');
  assert.equal(cards(tree), 3);
  assert.match(text(tree), /\+1 more waiting/);
  nc.unmount();
});

test('the … menu item does not claim compact: only the header button is the entry point', () => {
  const menu = starter.mount('StartDiscoveryCall', { slug: 'qa-alex-smith', isOwner: true, variant: 'menu' });
  menu.render();
  assert.deepEqual(placement.currentClaims(), placement.NO_CLAIMS);
  menu.unmount();
});

test('live call bar: while it shows a call approvals are compact on any page; when the call ends the stack returns', async () => {
  path = '/today';
  elements = { 'approval-badge-topbar': topbarSlot };
  const call = { id: 'call-1', status: 'bridged', label: 'Alex Smith', number: '6125550199', direction: 'inbound', answered_at: 'x', started_at: 'x', session_id: null, lead_slug: 'qa-alex-smith' };
  const bar = liveBar.mount('LiveCallBar', { data: { calls: [call], manual: [] }, userId: 'u1' });
  const barTree = bar.render();
  assert.ok(barTree, 'the bar shows the call');
  assert.deepEqual(placement.currentClaims(), { surface: true, modal: false }, 'a surface claim, not modal');

  const nc = await mountCenter();
  let tree = nc.render();
  assert.equal(cards(tree), 0, 'no card covers the live bar');
  assert.equal(badgeIn(tree).target, topbarSlot);

  // A page with its own slot (Inbox) still gets the badge there, not the top bar fallback.
  path = '/inbox';
  elements = { 'approval-badge-topbar': topbarSlot, 'approval-badge-slot': pageSlot };
  nc.render(); tree = nc.render(); // the route effect finds the slot, then React re-renders
  assert.equal(badgeIn(tree).target, pageSlot, "the page's own slot wins");

  // Call ends: the bar empties, the claim is released, a non-compact page gets its stack back.
  path = '/today';
  elements = { 'approval-badge-topbar': topbarSlot };
  assert.equal(bar.render({ data: { calls: [], manual: [] }, userId: 'u1' }), null);
  assert.deepEqual(placement.currentClaims(), placement.NO_CLAIMS);
  nc.render(); tree = nc.render();
  assert.equal(stack(tree), 1, 'stack back after hangup');
  assert.equal(findAll(tree, (n) => n.type === 'portal').length, 0, 'no badge once the stack is back');

  // And unmounting with a call showing releases it too.
  bar.render({ data: { calls: [call], manual: [] }, userId: 'u1' });
  assert.equal(placement.currentClaims().surface, true);
  bar.unmount();
  assert.deepEqual(placement.currentClaims(), placement.NO_CLAIMS);
  nc.unmount();
});
