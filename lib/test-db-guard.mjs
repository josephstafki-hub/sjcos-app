/** Fail before pg can fall back to localhost or consume a runtime URL in tests.
 * Harness callers pass URLs directly as well as through SJC_TEST_DATABASE_URL;
 * the explicit application_name is the harness's connection marker.
 * This function is deliberately a no-op in ordinary runtime processes.
 */
export function isNodeTest() {
  return !!process.env.NODE_TEST_CONTEXT || process.argv.includes('--test') || process.execArgv.includes('--test');
}
export function assertTestDatabaseUrl(connectionString) {
  if (!isNodeTest()) return;
  let url;
  try { url = new URL(connectionString); } catch { /* fail closed below */ }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.searchParams.get('application_name') !== 'sjc_test_harness' ||
      decodeURIComponent(url.pathname).replace(/^\//, '') === 'sjcos') {
    throw new Error('TEST_DATABASE_REQUIRED: Node tests may connect only with an explicit tests/_harness/testdb.mjs URL (application_name=sjc_test_harness). Default PG connections and runtime URLs are forbidden.');
  }
}
