// A3b expectations first. Pure fake process backend; no real launches or sockets.
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
for(const scenario of ['fixed-launch','nonfixed-executable','foreign-pid','wrong-peer','release-before-bind','stale-process','cancel','protected-claims'])test('root broker '+scenario,()=>{const r=spawnSync('python3',['-I','-B','deploy/browser/root_broker_tests.py',scenario],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);});
