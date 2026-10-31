import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
function luminance(token) {
  const hex = css.match(new RegExp(`--${token}: #([0-9a-f]{6});`, 'i'))?.[1];
  assert.ok(hex, `Missing color token ${token}`);
  const rgb = hex.match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test('helper and timestamp tokens meet AA normal-text contrast on cream surfaces', () => {
  for (const ink of ['ink-2', 'ink-3', 'ink-4']) {
    for (const paper of ['paper', 'paper-2', 'card']) {
      const contrast = (luminance(paper) + 0.05) / (luminance(ink) + 0.05);
      assert.ok(contrast >= 4.5, `${ink} on ${paper}: ${contrast.toFixed(2)}:1`);
    }
  }
});
