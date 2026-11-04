// r14 design (docs/plans/reviews/build-consult-r14-design.md): a refused close that names a field the app
// knows says where its button goes and names the answer; the field it lands on says why; calmer extras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { W, closeRefusal, closeRefusalPlace } from '../lib/consult/ui/words.ts';
import { buildModel, emptyDraft } from '../lib/consult/ui/model.ts';
import { seedModules } from '../lib/consult/forms/seed.ts';

const root = new URL('../', import.meta.url);
// .tsx components load through the TypeScript transpiler; "@/x" and extensionless "./x" find .ts / .tsx.
const withExt = (href) => { for (const ext of ['', '.ts', '.tsx', '/index.ts']) if (existsSync(new URL(href + ext))) return href + ext; return href; };
registerHooks({
  resolve(s, c, n) {
    if (s.startsWith('@/')) return n(withExt(new URL(s.slice(2), root).href), c);
    if ((s.startsWith('./') || s.startsWith('../')) && c.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(s)) return n(withExt(new URL(s, c.parentURL).href), c);
    return n(s, c);
  },
  load(u, c, n) {
    if (u.endsWith('.tsx')) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(u), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return n(u, c);
  },
});
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), b ? s.indexOf(b, s.indexOf(a)) : undefined);
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

const HOUSE = '00000000-0000-4000-8000-000000000001';
const CLOSING = '00000000-0000-4000-8000-000000000002';
function visit() {
  const s = {
    consult: { id: HOUSE, status: 'in_progress', revision: 1, completion_generation: 1 },
    pins: seedModules.map((definition) => ({ kind: 'module', definition })),
    instances: [{ id: HOUSE, module_key: 'house', parent_id: null }, { id: CLOSING, module_key: 'closing', parent_id: null }],
    heads: [{ instance_id: CLOSING, field_key: 'estimate_promised', status: 'answered', value: '2026-11-12', server_revision: 1 }],
    conflicts: [],
  };
  return buildModel(s, [], [], emptyDraft());
}

test('R14-1: a known field gets Go to field (or the sheet name) and a line naming it; unknown stays Before you wrap', () => {
  const model = visit();
  assert.equal(closeRefusal('invalid_command').fix, 'before_you_wrap');
  const date = closeRefusalPlace('closing.estimate_promised', model);
  assert.equal(date.button, W.goToField);
  assert.match(date.label, /Formal estimate promised by$/, 'the field label, as conflictName reads it');
  assert.equal(closeRefusalPlace('evidence.rrp.redelivery_day', model).button, 'Renovate Right');
  assert.equal(closeRefusalPlace('flags.x', model).button, 'Flags');
  assert.equal(closeRefusalPlace('trade_walks.0.day', model).button, W.tradeWalkTitle);
  const photos = closeRefusalPlace('photos_ok', model);
  assert.equal(photos?.button, W.goToField);
  // Before you wrap with its own line and note: unknown, a skip with no address, a field not on this visit.
  for (const f of ['unknown.path', 'evidence.skips', 'skips.ffffffff-0000-4000-8000-000000000009:wall', '', null]) assert.equal(closeRefusalPlace(f, model), null, String(f));
  assert.equal(fill1(W.refusedOneAnswer, 'X'), 'The office couldn’t read one answer: X. Check it, then close again.');
});
const fill1 = (t, v) => t.replace('{field}', v);

test('R14-1: the refusal screen says Go to field and names the answer — W.goToField for closing.estimate_promised', async () => {
  const { ClosingScreen } = await import('../components/consult/field/WrapClose.tsx');
  const model = visit();
  const props = (refusedPlace) => ({ closing: { step: 'error', code: 'invalid_command', field: 'closing.estimate_promised' }, unsent: 0, online: true, autoApply: false, findings: null, findingsCode: null,
    onSend() {}, onRetry() {}, onKeepWorking() {}, async onReopen() {}, onApply() {}, home: '/consult/', onRefused() {}, refusedPlace });
  const known = text(renderToStaticMarkup(createElement(ClosingScreen, props(closeRefusalPlace('closing.estimate_promised', model)))));
  assert.match(known, new RegExp(`The office couldn’t read one answer: [^.]*Formal estimate promised by\\. Check it, then close again\\.`));
  assert.ok(known.includes(W.goToField), 'the button says Go to field');
  assert.ok(!known.includes(W.beforeYouWrap), 'no "Before you wrap" in the line or the button');
  // An unknown field keeps the plain line and its Before you wrap button.
  const unknown = text(renderToStaticMarkup(createElement(ClosingScreen, props(null))));
  assert.ok(unknown.includes('Check Before you wrap, then close again.'));
  assert.ok(unknown.includes(W.beforeYouWrap));
  assert.ok(!unknown.includes(W.goToField));
});

test('R14-1: focus:closing.estimate_promised lands on the date field with the note; cleared on save or ‹ Sections', async () => {
  assert.equal(W.fieldRefusedNote, 'The office couldn’t read this answer — check it, then close again.');
  const visitSrc = src('components/consult/field/VisitScreen.tsx');
  const branch = between(visitSrc, '      default: {', '  const ranAction');
  // The refusal path marks the field it lands on — the date for closing.estimate_promised — then goes there.
  assert.match(branch, /setFieldWhy\(refusedAt\(target\)\);\n\s*if \("sheet" in target\) setSheet\(target\.sheet\);\n\s*else if \("closing" in target\) pickDate\(\);/);
  assert.match(visitSrc, /"closing" in t \? dateField\?\.addr \?\? null/);
  assert.match(visitSrc, /const dateField = model\.sections\.find\(\(s\) => s\.module\.key === "closing"\)\?\.fields\.find\(\(f\) => f\.key === "estimate_promised"\);/);
  // A plain Pick the date (not a refusal) never sets it; the wrap-sheet fallbacks get null (no field note).
  assert.doesNotMatch(between(visitSrc, 'const pickDate', '\n'), /setFieldWhy/);
  assert.match(visitSrc, /"addr" in t && model\.sections\.some\(\(x\) => x\.instance\.id === t\.addr\.split\(":"\)\[0\]\) \? t\.addr : null;/);
  // Kept when the date's own section opens; cleared on another section, on ‹ Sections, and on that field's next save.
  assert.match(visitSrc, /setFieldWhy\(\(w\) => \(w\?\.startsWith\(`\$\{id\}:`\) \? w : null\)\);/);
  assert.match(visitSrc, /guard\(\(\) => \{ setFieldWhy\(null\); setView\("list"\); \}\)\}>‹ \{W\.sections\}/);
  assert.match(visitSrc, /if \(ok && f\.addr === fieldWhy\) setFieldWhy\(null\);/);
  assert.match(visitSrc, /&& key === fieldWhy\) setFieldWhy\(null\);/);
  assert.match(visitSrc, /refusedAddr: fieldWhy,/);

  // The date field itself, rendered with the note (and without it on any other field or with no refusal).
  const { FieldRow } = await import('../components/consult/field/FieldRow.tsx');
  const model = visit();
  const f = model.sections.find((s) => s.module.key === 'closing').fields.find((x) => x.key === 'estimate_promised');
  const actions = (refusedAddr) => ({ answer: async () => {}, keypad() {}, skip() {}, photo: async () => {}, resolve() {}, discard: async () => {}, thumbs: {}, photosOk: true, online: true, showToClient() {}, focusAddr: f.addr, focusTick: 1, refusedAddr });
  const on = renderToStaticMarkup(createElement(FieldRow, { f, actions: actions(f.addr), sectionId: CLOSING }));
  assert.ok(text(on).includes(W.fieldRefusedNote), 'the note on the landed date field');
  assert.ok(on.indexOf(W.fieldRefusedNote.slice(0, 20)) < on.indexOf(f.def.label), 'above the field');
  assert.match(on, /role="status"[^>]*class="[^"]*border-info/, 'the calm status banner, not the ⚠ one');
  assert.ok(!text(renderToStaticMarkup(createElement(FieldRow, { f, actions: actions(null), sectionId: CLOSING }))).includes(W.fieldRefusedNote));
  assert.ok(!text(renderToStaticMarkup(createElement(FieldRow, { f, actions: actions(`${CLOSING}:other`), sectionId: CLOSING }))).includes(W.fieldRefusedNote));
});

test('extra: the conflict footer Go to field is the outlined secondary button, full width when narrow', () => {
  const sheet = between(src('components/consult/field/WrapClose.tsx'), 'export function WrapSheet', 'function Line(');
  assert.match(sheet, /<Btn className="max-md:w-full" onClick=\{\(\) => onGo\(firstConflict\.instance_id, firstConflict\.key\)\}>\{W\.goToField\}<\/Btn>/);
  assert.doesNotMatch(between(sheet, '{firstConflict && <div', '{!firstConflict'), /tone="quiet"/);
});

test('extra: "Thu, Nov 12 ✓" stays together on the Before you wrap date line', async () => {
  const { WrapSheet } = await import('../components/consult/field/WrapClose.tsx');
  const model = visit();
  const html = renderToStaticMarkup(createElement(WrapSheet, { open: true, onClose() {}, model, draft: emptyDraft(), hasInitials: false, refused: 0, onGo() {}, onFlags() {}, onTrades() {}, onRrp() {}, onClient() {}, onAck() {}, onCloseVisit() {} }));
  assert.match(html, /Formal estimate promised by <span class="whitespace-nowrap">Thu, Nov 12 ✓<\/span>/);
});

test('extra: an advisory office flag (radon) has no decision line; a decidable flag keeps it', async () => {
  const { OfficeFlags } = await import('../components/consult/office/OfficeFlags.tsx');
  const flags = [
    { kind: 'advisory', key: 'radon', issue: 'Radon at or above 4 pCi/L', hint: 'Radon is 5.2 pCi/L — at or above the 4 pCi/L level. Mention mitigation.' },
    { kind: 'flag', key: 'joist', issue: 'Joist span over the table', hint: 'Check the span.' },
  ];
  const decisions = { radon: { disposition: 'not_an_issue', note: 'Reviewed' }, joist: { disposition: 'not_an_issue', note: 'Checked' } };
  const out = text(renderToStaticMarkup(createElement(OfficeFlags, { flags, decisions })));
  assert.ok(!out.includes('Reviewed'), 'no decision under the radon advisory');
  assert.ok(out.includes('Not an issue · Checked'), 'the decidable flag keeps its decision line');
  const later = text(renderToStaticMarkup(createElement(OfficeFlags, { flags: [{ ...flags[1], decisionAllowed: false }], decisions })));
  assert.ok(!later.includes('Checked'), 'decisionAllowed: false hides it too, once the model says so');
});
