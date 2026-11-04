import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, parseLengthPair, formatLength } from '../lib/consult/length.ts';
test('approved explicit units, fractions and laser modes store rounded inches', () => {
  for (const [text, value] of [["8'",96], ['8\' 1 1/4"',97.25], ['8 1 1/4',97.25], ['97.25',97.25], ['97 1/4',97.25], ['8.1ft',97.1875], ['2.47m',97.25], ['2470mm',97.25], ['13′4½″',160.5], ['0',0]]) {
    const parsed = parseLength(text); assert.equal(parsed.ok, true, text); assert.equal(parsed.inches, value, text);
  }
});
test('bare number uses inches first then feet within range, otherwise refuses', () => {
  assert.equal(parseLength('8', {range:[60,240]}).inches,96);
  assert.equal(parseLength('8', {range:[0,240]}).inches,8);
  assert.equal(parseLength('3', {range:[60,240]}).error,'out_of_range');
  assert.equal(parseLength('8in', {range:[60,240]}).error,'out_of_range');
});
test('pairs, carry and precision are explicit; malformed input never partially parses', () => {
  assert.deepEqual(parseLengthPair('36 × 60').inches,[36,60]);
  assert.equal(parseLengthPair('36x60x12').ok,false);
  assert.equal(formatLength(95.99,1/8),'8′ 0″');
  assert.equal(formatLength(97.25,1/16),'8′ 1 1/4″');
  for (const text of ['', '-3', 'NaN', 'Infinity', '2e3', '3/0', '1/3', '1/1', '1 8/4', '12foo', "8' 14\"", '<script>', '1+2']) assert.equal(parseLength(text).ok,false,text);
});
