import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMarketingCopy } from '../lib/marketing-copy.ts';
import { squareReadiness } from '../lib/payments/readiness.ts';
import { historicalAuthor, percentLabel } from '../lib/pricing-labels.ts';
import { principalLabel } from '../lib/commands/principal.ts';

test('blog envelopes, section arrays and fenced JSON become copyable prose', () => {
  const raw = '```json\n' + JSON.stringify({blogPost:{title:'A kitchen',content:[{heading:'Craft',paragraph:'Careful work.'},'A warm finish.']}}) + '\n```';
  assert.deepEqual(normalizeMarketingCopy(raw), {title:'A kitchen',body:'Craft\n\nCareful work.\n\nA warm finish.'});
  assert.equal(normalizeMarketingCopy('Plain paragraphs.\n\nStay intact.').body, 'Plain paragraphs.\n\nStay intact.');
  assert.equal(normalizeMarketingCopy(JSON.stringify({post:'New room.',hashtags:['carpentry','#remodel']})).body, 'New room.\n\n#carpentry #remodel');
  assert.equal(normalizeMarketingCopy('{"unrecognized": "debug data"}').body, '');
});
test('a fake or stale Square check cannot certify a merchant', () => {
  const cfg = {connection_state:'connected',environment:'production',capabilities:{adapter:'fake',card:true,merchant_approved:true}};
  assert.equal(squareReadiness('fake', cfg).connected, false);
  assert.equal(squareReadiness('production', cfg).connected, false);
  assert.equal(squareReadiness('production', {...cfg,capabilities:{adapter:'production'}}).connected, true);
  assert.equal(squareReadiness('sandbox', {...cfg,capabilities:{adapter:'production'}}).connected, false);
});
test('historical attribution and missing percentages never print undefined or unset%', () => {
  assert.equal(historicalAuthor('undefined (unattended)'), 'Author not recorded');
  assert.equal(historicalAuthor('owner:Joe Stafki'), 'Joe Stafki');
  assert.equal(percentLabel(null), 'Not set');
  assert.equal(percentLabel(20), '20%');
  assert.equal(principalLabel({kind:'unknown'}), 'Author not recorded');
  assert.equal(principalLabel({kind:'user',role:'owner'}), 'Author not recorded');
});
