import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Expectations first: real pinned Python runtime and only process-local sockets.
test('real mitmproxy bounded socket/TLS transport adversarial suite',()=>{
 const r=spawnSync('/opt/sjcos-browser/py/bin/python',['deploy/browser/transport_tests.py'],{encoding:'utf8',timeout:90000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran (?:[2-9][5-9]|[3-9][0-9]) tests/);
});
