import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Expectations first: real pinned runtime, loopback sockets, RSS abort/deadline
// regressions and all 33 cancellation-stage cases must remain in the inventory.
test('real mitmproxy bounded socket/TLS transport adversarial suite',()=>{
 const r=spawnSync('/opt/sjcos-browser/py/bin/python',['deploy/browser/transport_tests.py'],{encoding:'utf8',timeout:90000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);assert.ok(Number(r.stderr.match(/Ran (\d+) tests/)?.[1])>=86,r.stderr);
});
