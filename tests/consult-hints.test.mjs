// Visitor hints are plain words (build-consult-r2-design N1): the seed's planning notes live in
// `note` (never rendered) and only `hint` reaches the field. Fails if any rendered hint carries a
// plan marker, a field key or a scope key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as seed from '../lib/consult/forms/seed.ts';

const MARKERS = [/→/, /R\?/, /§/, /\bPhase\b/i, /_/, /\bO otherwise\b/, /\bderived\b/i, /\bmodule\b/i, /\bSignaturePad\b/, /\btemplate ∈/, /\bset_design_path\b/];

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
