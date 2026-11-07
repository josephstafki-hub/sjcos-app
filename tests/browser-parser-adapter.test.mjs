import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Expectations FIRST: real pinned parsers; no sockets/browser/DB. Each Python
// unittest is surfaced separately so a missing dependency is a failure, no skip.
const cases=['header_limit','header_fragment_limit','duplicate_length','conflicting_length','expect','request_compression','response_compression','chunked_upload','unknown_upload','oversize_length','negative_length','comma_length','leading_zero','request_trailer','response_trailer','response_upgrade','two_slow_slots','one_per_context','nonborrowing_request','queue_limit','short_body','oversize_body','chunked_response','deadline','terminal_cleanup','unix_oversize','unix_peer','stock_unattested','immutable_copy','response_drain','revoke_cleanup','header_failure_cleanup','fatal_transport_cleanup','connect_deadline_not_refreshed_by_request','expired_connect_refused_after_reservation','nonfinite_connect_refused','original_deadline_bounds_owner','expiry_persists_unknown_before_release','parser_error_persists_consumed_unknown','success_requires_transport_drain_ack','unknown_persistence_failure_cleans_and_revokes'];
for(const name of cases)test('real mitmproxy parser adapter: '+name,()=>{
 const r=spawnSync('/opt/sjcos-browser/py/bin/python',['deploy/browser/parser_adapter_tests.py','AdapterTests.test_'+name],{encoding:'utf8',timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 1 test/);
});
