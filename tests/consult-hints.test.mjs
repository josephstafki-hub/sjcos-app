// Visitor hints are plain words (build-consult-r2-design N1): the seed's planning notes live in
// `note` (never rendered) and only `hint` reaches the field. Fails if any rendered hint carries a
// plan marker, a field key or a scope key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as seed from '../lib/consult/forms/seed.ts';
import { visitorFlagText } from '../lib/consult/ui/model.ts';

const MARKERS = [/→/, /R\?/, /§/, /\bPhase\b/i, /_/, /\bO otherwise\b/, /\bderived\b/i, /\bmodule\b/i, /\bSignaturePad\b/, /\btemplate ∈/, /\bset_design_path\b/];
// Code citations stay in the office text (r3 C5): "R314", "R308.4.2", "299F.51", "1346.0501", "IRC", "UPC"…
const CODES = [/\bR\d{3}\b/, /\b\d{3}[A-Z]\.\d+/, /\bIRC\b/, /\bUPC\b/, /\bNEC\b/, /Minn\. R\./, /MN Rules/, /\bCFR\b/, /\b(?:1346|1322|1303|4714|745)(?:\.\d+)?\b/, /\bMDH\b/, /\bAHJ\b/];

function seedFlagRules() {
  const out = [];
  for (const m of seed.seedModules) for (const f of m.fields) [...(f.flag ? [f.flag] : []), ...(f.flags ?? [])].forEach((rule, i) => out.push([`${m.key}.${f.key}${i ? `#${i}` : ''}`, rule]));
  return out;
}

function renderedHints() {
  const out = [];
  for (const m of seed.seedModules) {
    for (const f of m.fields) {
      if (f.hint) out.push([`${m.key}.${f.key}`, f.hint]);
      for (const s of f.shots ?? []) if (s.hint) out.push([`${m.key}.${f.key}.${s.key}`, s.hint]);
    }
    for (const s of m.shots) if (s.hint) out.push([`${m.key}.${s.key}`, s.hint]);
  }
  return out;
}

test('no seed field still carries the old rendered `help` text', () => {
  for (const m of seed.seedModules) for (const f of m.fields) assert.equal(f.help, undefined, `${m.key}.${f.key} still has help`);
});

test('every rendered hint is plain visitor words', () => {
  const hints = renderedHints();
  assert.ok(hints.length >= 40, `expected the seed to carry visitor hints, found ${hints.length}`);
  const scopeKeys = Object.keys(seed.scopeMappings ?? {});
  for (const [where, hint] of hints) {
    for (const re of MARKERS) assert.doesNotMatch(hint, re, `${where}: "${hint}" contains ${re}`);
    for (const k of scopeKeys) assert.ok(!hint.includes(k), `${where}: "${hint}" names scope key ${k}`);
    assert.ok(hint.length <= 220, `${where}: hint too long for a field`);
    assert.match(hint, /^[A-Z0-9“]/, `${where}: hint starts as a sentence`);
  }
});

test('the field row renders hint only, never note or help', () => {
  const src = readFileSync(new URL('../components/consult/field/FieldRow.tsx', import.meta.url), 'utf8');
  assert.match(src, /d\.hint/);
  assert.doesNotMatch(src, /\bd\.help\b|\bd\.note\b|def\.note|def\.help/);
});

test('every rendered hint is free of code citations', () => {
  for (const [where, hint] of renderedHints()) for (const re of CODES) assert.doesNotMatch(hint, re, `${where}: "${hint}" cites ${re}`);
});

test('every ⚑ flag carries a plain visitor sentence; the code stays in the office issue', () => {
  const rules = seedFlagRules();
  assert.ok(rules.length >= 60, `expected the seed's flags, found ${rules.length}`);
  for (const [where, rule] of rules) {
    assert.ok(rule.hint, `${where}: flag has no visitor hint`);
    for (const re of [...MARKERS, ...CODES]) assert.doesNotMatch(rule.hint, re, `${where}: "${rule.hint}" contains ${re}`);
    assert.match(rule.hint, /^[A-Z0-9“]/, `${where}: flag hint starts as a sentence`);
    assert.match(rule.hint, /[.!?]$/, `${where}: flag hint ends as a sentence`);
    assert.ok(rule.hint.length <= 140, `${where}: flag hint too long for one line`);
    assert.ok(rule.issue.trim(), `${where}: the office issue text stays`);
  }
  // The office text keeps its citations for Joe (look-over, scope facts).
  assert.ok(rules.some(([, r]) => /R314/.test(r.issue)) && rules.some(([, r]) => /299F\.51/.test(r.issue)));
});

test('a flag published without a hint never shows its code on the visit screen', () => {
  for (const [where, rule] of seedFlagRules()) {
    const text = visitorFlagText(rule.issue);
    for (const re of CODES.filter((r) => !/MDH|745/.test(String(r)))) assert.doesNotMatch(text, re, `${where}: fallback "${text}" contains ${re}`);
  }
  assert.equal(visitorFlagText('permitted work: review R314/R315; CO within 10 ft of sleeping rooms (299F.51)'), 'Permitted work: review; CO within 10 ft of sleeping rooms.');
});

test('visit screens render the flag hint, never the office issue', () => {
  const row = readFileSync(new URL('../components/consult/field/FieldRow.tsx', import.meta.url), 'utf8');
  const wrap = readFileSync(new URL('../components/consult/field/WrapClose.tsx', import.meta.url), 'utf8');
  assert.match(row, /fl\.hint/); assert.doesNotMatch(row, /fl\.issue/);
  assert.match(wrap, /f\.hint/); assert.doesNotMatch(wrap, /\{f\.issue\}/);
});
