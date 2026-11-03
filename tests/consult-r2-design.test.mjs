// Round-2 design judge fixes (docs/plans/reviews/build-consult-r2-design.md): the client summary
// tells the truth (N2), repeat instances keep their names, keypad typography (N8), and the
// screen-level rules that are cheapest to hold in source (N3, N5, N6, N9, N11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seedModules, templates } from '../lib/consult/forms/seed.ts';
import { buildModel, emptyDraft, summaryInput, instanceLabel, spokenSelections, leaveLine } from '../lib/consult/ui/model.ts';
import { clientSummary } from '../lib/consult/client-summary.ts';
import { prettyLength } from '../lib/consult/length.ts';
import { plainWords, readyReason } from '../lib/consult/ui/words.ts';

const consultId = randomUUID();
const tpl = (...keys) => keys.map((k) => templates.find((t) => t.key === k));
function snapshot(tpls, instances = [], heads = []) {
  return {
    consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
    pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), ...tpls.map((t) => ({ kind: 'template', definition: t }))],
    instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
    heads: [{ id: randomUUID(), instance_id: consultId, field_key: 'templates', status: 'answered', value: tpls.map((t) => t.key), skip_reason: null, skip_note: null, server_revision: '4' }, ...heads],
    conflicts: [],
  };
}
const inst = (module_key, label, parent_id = null) => ({ id: randomUUID(), module_key, parent_id, removed_at: null, label });
const head = (i, field_key, value) => ({ id: randomUUID(), instance_id: i.id, field_key, status: 'answered', value, skip_reason: null, skip_note: null, server_revision: '4' });

// r3 (design C6, domain N3): the client sees names they know — the room's own name, else its area,
// else its level — and "Not measured today", never "We'll come back to" or "Room 2".
test('client summary lists only rooms with something covered; untouched places are "not measured today", never "looked over"', () => {
  const r1 = inst('room', 'Room 1'), r2 = inst('room', 'Room 2'), bath = inst('bath_scope', 'Bath 1');
  const kitchen = inst('kitchen_scope', 'Kitchen'), wall = inst('kitchen_wall', 'Kitchen wall 1');
  const s = snapshot(tpl('kitchen', 'bath'), [r1, r2, bath, kitchen, wall], [head(r1, 'length', 144), head(r1, 'width', 120), head(r1, 'name', 'Kitchen')]);
  const m = buildModel(s, [], [], emptyDraft());
  const sum = clientSummary(summaryInput(m, { client: 'Michael Larson' }, 'Nov 3', 'Nov 17'));
  assert.deepEqual(sum.rooms.map((r) => r.name), ['Kitchen']);
  assert.ok(sum.rooms[0].work.includes('Measured'));
  assert.ok(!JSON.stringify(sum).includes('Measured and looked over'), 'never the stock sentence');
  assert.deepEqual(sum.come_back, ['another room', 'the bathroom'], 'the kitchen is listed as gone over, so it is not also "not measured"');
  assert.ok(!sum.come_back.some((n) => /Room \d|Bath \d/.test(n)), 'no generic instance names reach the client');
  assert.ok(!sum.rooms.some((r) => /^wall\b/i.test(r.name)) && !sum.come_back.some((n) => /wall/i.test(n)), 'kitchen walls are not rooms');
});

test('still to decide is grouped by room, the room prefix dropped from each item', () => {
  const sels = ['Bath — Vanity', 'Bath — Faucets', 'Kitchen — Sink', 'Kitchen — Hood'].map((l) => inst('selections', l));
  const s = snapshot(tpl('kitchen', 'bath'), sels, sels.map((x) => head(x, 'decision', x.label)).concat([head(sels[1], 'status', 'Exact product picked')]));
  const sum = summaryInput(buildModel(s, [], [], emptyDraft()), { client: 'C' }, '', '');
  assert.deepEqual(sum.still_to_decide, [{ group: 'Bathroom', items: ['Vanity'] }, { group: 'Kitchen', items: ['Sink', 'Hood'] }]);
});

test('rooms made for an area keep it: visitor "Room 1 — Bath", client "the bathroom"; kitchen walls never repeat Kitchen', () => {
  const r1 = inst('room', 'Room dimensions 1 — Bathroom'), r2 = inst('room', 'Room dimensions 2 — Kitchen'), r3 = inst('room', 'Room dimensions 3 — Kitchen');
  const wall = inst('kitchen_wall', 'Kitchen wall 1 — Kitchen'), bath = inst('bath_scope', 'Bathroom 1 — Bathroom');
  const m = buildModel(snapshot(tpl('bath', 'kitchen'), [r1, r2, r3, wall, bath], [head(r3, 'level', 'Main')]), [], [], emptyDraft());
  const label = (i) => m.sections.find((x) => x.instance.id === i.id).label;
  assert.equal(label(r1), 'Room 1 — Bath'); assert.equal(label(r2), 'Room 2 — Kitchen');
  assert.equal(label(wall), 'Kitchen wall 1'); assert.equal(label(bath), 'Bathroom work 1', 'the scope row is not a second "Bath" beside the room (r4 R4-8)');
  const sum = summaryInput(m, { client: 'C' }, '', '');
  assert.deepEqual(sum.come_back, ['the bathroom', 'the kitchen']);
});

test('closing line 3 is spoken grouped by area and capped, without "Bath —" prefixes or asides (r2 N4)', () => {
  const sels = ['Bath — Vanity', 'Bath — Vanity top', 'Bath — Sink', 'Bath — Faucets', 'Bath — Toilet', 'Bath — Shower valve/trim', 'Bath — Fan', 'Kitchen — Cabinet line/door style', 'Kitchen — Appliance package (each appliance)'].map((l) => inst('selections', l));
  const m = buildModel(snapshot(tpl('bath', 'kitchen'), sels, sels.map((x) => head(x, 'decision', x.label))), [], [], emptyDraft());
  const said = spokenSelections(m);
  assert.equal(said, 'for the bathroom, the vanity, vanity top, sink, faucets and toilet, and two more; for the kitchen, the cabinet line and door style and appliances');
  assert.doesNotMatch(said, /—|\(/);
});

test('leave banner: at most three names per group, then "and n more" (r3 C3)', () => {
  assert.equal(leaveLine(['A', 'B']), 'A · B');
  assert.equal(leaveLine(['A', 'B', 'C', 'D', 'E']), 'A · B · C and 2 more');
});

test('a repeat instance whose name field is blank keeps "<Title> <n>", never a bare word', () => {
  const kw = seedModules.find((m) => m.key === 'kitchen_wall');
  assert.equal(instanceLabel(kw, { id: 'x', module_key: 'kitchen_wall', parent_id: null, removed_at: null }, 2, new Map()), 'Kitchen wall 2');
  assert.equal(instanceLabel(kw, { id: 'x', module_key: 'kitchen_wall', parent_id: null, removed_at: null }, 1, new Map([['x:letter', { status: 'answered', value: 'B' }]])), 'Wall B');
});

test('keypad reading uses primes and fraction glyphs (§6.6)', () => {
  assert.equal(prettyLength('8′ 1 1/4″'), '8′ 1¼″');
  assert.equal(prettyLength(`6' 9"`), '6′ 9″');
  assert.equal(prettyLength('36″ × 60 1/2″'), '36″ × 60½″');
  assert.equal(prettyLength('1 3/16″'), '1 3/16″');
});

test('words: the stuck queue and the second device read as plain sentences', () => {
  assert.equal(plainWords('send_stuck'), 'Nothing went out — your answers are safe on this device.');
  assert.equal(readyReason('offline_lease', 'device_access_denied'), 'This visit is set up on another device. Use that one, or ask Joe to move it here.');
});

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('screens: Sections at every opening step, Next sticky on tablet landscape, 12-digit hand-back PIN, stuck send, grouped wrap', () => {
  const visit = src('components/consult/field/VisitScreen.tsx');
  assert.doesNotMatch(visit, /openingStep > 0 \? <Btn[^>]*>\{W\.previous\}<\/Btn> : <Btn[^>]*>‹ \{W\.sections\}/, 'Back must not replace ‹ Sections');
  assert.match(visit, /lg:sticky/); assert.doesNotMatch(visit, /lg:static/);
  const client = src('components/consult/field/ClientView.tsx');
  assert.match(client, /slice\(0, 12\)/); assert.doesNotMatch(client, /slice\(0, 8\)/);
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /useStuckSince/); assert.match(app, /send_stuck/); assert.match(app, /nothingWentOut/);
  assert.match(src('components/consult/field/WrapClose.tsx'), /groupBySection/);
  assert.match(src('components/consult/field/Keypad.tsx'), /\{label\}<\/span>\} dock/);
});
