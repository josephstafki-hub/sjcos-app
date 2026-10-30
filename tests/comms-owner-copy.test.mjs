import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionCopy } from '../lib/comms/connection-copy.ts';
test('disconnected messaging and calls explain the limitation and next step without deployment diagnostics', () => {
  for (const kind of ['sms', 'voice']) {
    const c = connectionCopy(kind);
    assert.match(c.title, /not connected/i);
    assert.match(c.error, /not connected/i);
    assert.match(c.help, /business number/);
    assert.doesNotMatch(JSON.stringify(c), /SMS_|VOICE_|API_KEY|env var|restart|\.md|banned/);
  }
});

test('setup names a server prerequisite and treats Joe as the owner', () => {
  for (const kind of ['sms', 'voice']) {
    const c = connectionCopy(kind);
    assert.match(c.help, /one-time setup on the server/i);
    assert.doesNotMatch(c.help, /ask the person|administrator/i);
  }
});
