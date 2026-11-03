// Mounted regression for the checklist lead picker's kept first page (build
// review R3/R4): prefetch → create a lead from the checklist → reopen the
// picker shows that lead; and a kept page more than a few seconds old is read
// again behind the scenes. The real Pickers.tsx (one module instance, so one
// cache) runs on a small simulated React host with a fake clock and a fake
// /api/calls/checklist-leads that counts its reads. No browser, server or DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function compile(file) {
  return ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function host(file, stubs, globals = {}) {
  let cur = null, ids = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init) { const c = cur, i = c.cursor++; c.slots[i] ??= { v: typeof init === 'function' ? init() : init }; const s = c.slots[i]; return [s.v, (v) => { s.v = typeof v === 'function' ? v(s.v) : v; }]; },
    useRef(init) { const c = cur, i = c.cursor++; return c.slots[i] ??= { current: init }; },
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
  const all = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, ...stubs };
  const exports = {};
  runInNewContext(compile(file), { exports, require: (s) => { if (!(s in all)) throw new Error(`unstubbed import ${s}`); return all[s]; }, ...globals });
  return {
    exports,
    mount(component, props) {
      const inst = { slots: [], cursor: 0, effects: [] };
      return {
        render() { cur = inst; inst.cursor = 0; const out = exports[component](props); for (const e of inst.effects.splice(0)) e(); return out; },
        unmount() { for (const s of inst.slots) s?.clean?.(); },
      };
    },
  };
}

function* walk(node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if ('type' in node && 'props' in node) { yield node; yield* walk(node.props.children); }
}
const find = (tree, pred, what) => { for (const n of walk(tree)) if (pred(n)) return n; throw new Error(`not found: ${what}`); };
// The picker reads on a 0 ms timer; let it fire and its promises settle.
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 2)); };

// ── Fake server and clock ────────────────────────────────────────────────
let clock = 1_000_000;
let serverLeads = [{ id: 'l-alex', name: 'Alex Smith', scope: 'Bath', phone: null, on_call: false }];
let reads = 0;
const fetch = async (url) => {
  assert.match(String(url), /^\/api\/calls\/checklist-leads\?/);
  reads += 1;
  const leads = serverLeads.map((l) => ({ ...l }));
  return { ok: true, json: async () => ({ ok: true, leads }) };
};
const Sheet = function Sheet() {}, Btn = function Btn() {};
const pickers = host('components/calls/checklist/Pickers.tsx', {
  '@/lib/actions/discovery-checklist-ui': {
    checklistLeadBySlug: async (slug) => ({ id: `l-${slug}`, name: 'Pat New', slug }),
    checklistRecentCalls: async () => [],
  },
  '@/lib/actions/leads': {
    // The checklist's New lead: the lead lands on the server, as the real action does.
    createLeadFromInbox: async (form) => {
      serverLeads = [{ id: 'l-pat-new', name: String(form.get('name')), scope: null, phone: null, on_call: false }, ...serverLeads];
      return { slug: 'pat-new' };
    },
  },
  '@/lib/comms/phone': { formatUsPhone: (n) => n },
  './Sheet': { Btn, Sheet },
  './time': { chicagoWhen: () => '' },
}, {
  fetch, URLSearchParams, setTimeout, clearTimeout,
  Date: { now: () => clock },
  window: { matchMedia: () => ({ matches: false }) },
});
const { prefetchChecklistLeads } = pickers.exports;

/** Open the picker, let its reads land, return the names under Recent leads. */
async function openPicker() {
  const picker = pickers.mount('LeadPicker', { onPick() {}, onClose() {}, callNumber: null });
  picker.render(); await flush();
  const tree = picker.render();
  const names = [...walk(tree)].filter((n) => n.type === 'button' && /^Link /.test(n.props['aria-label'] ?? '')).map((n) => n.props['aria-label'].slice(5));
  picker.unmount();
  return names;
}

test('prefetch → create a lead in the checklist → reopen the picker: the new lead is there', async () => {
  await prefetchChecklistLeads(null);
  assert.equal(reads, 1, 'the first page is fetched ahead');
  assert.deepEqual(await openPicker(), ['Alex Smith']);
  assert.equal(reads, 1, 'opened right away: the kept page, no second read');

  clock += 1_000; // well inside the five-second freshness window
  const created = [];
  const sheet = pickers.mount('NewLeadSheet', { phone: '', onClose() {}, onCreated: (l) => { created.push(l); } });
  const form = find(sheet.render(), (n) => n.type === 'form', 'new lead form');
  form.props.action({ get: (k) => ({ name: 'Pat New', source: 'Phone call' })[k] ?? '' });
  await flush();
  assert.equal(created.length, 1, 'the checklist links to the new lead');

  clock += 1_000;
  const names = await openPicker();
  assert.equal(reads, 2, 'creating dropped the kept page: reopening reads it fresh');
  assert.deepEqual(names, ['Pat New', 'Alex Smith'], 'the lead made a moment ago is in Recent leads');
});

test('a kept page older than five seconds is read again behind the scenes', async () => {
  // Someone else adds a lead; the kept page doesn't know yet.
  serverLeads = [{ id: 'l-quinn', name: 'Quinn Other', scope: null, phone: null, on_call: false }, ...serverLeads];
  const before = reads;
  clock += 2_000;
  assert.deepEqual(await openPicker(), ['Pat New', 'Alex Smith'], 'inside five seconds: the kept page, at once');
  assert.equal(reads, before, 'no read inside the freshness window');

  clock += 6_000;
  assert.deepEqual(await openPicker(), ['Quinn Other', 'Pat New', 'Alex Smith'], 'stale kept page: re-read and shown');
  assert.equal(reads, before + 1, 'exactly one revalidating read');

  clock += 1_000;
  assert.deepEqual(await openPicker(), ['Quinn Other', 'Pat New', 'Alex Smith']);
  assert.equal(reads, before + 1, 'the re-read page is kept for the next open');
});
