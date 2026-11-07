import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {RSS_CASES} from '../lib/browser/acceptance.mjs';
// Expectations first: real pinned runtime, loopback sockets, RSS abort/deadline
// regressions, all 15 RSS cases and 36 cancellation stages stay in the inventory.
test('real mitmproxy bounded socket/TLS transport adversarial suite',()=>{
 const r=spawnSync('/opt/sjcos-browser/py/bin/python',['-B','deploy/browser/transport_tests.py','-v'],{encoding:'utf8',timeout:180000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);assert.ok(Number(r.stderr.match(/Ran (\d+) tests/)?.[1])>=108,r.stderr);
 for(const name of RSS_CASES)assert.ok(r.stderr.includes('test_rss_case_'+name.replaceAll('-','_')+' ('),name);
});
