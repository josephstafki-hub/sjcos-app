#!/usr/bin/env node
// Disposable Postgres for tests (A00). See tests/_harness/testdb.mjs.
//   node scripts/test-db.mjs start   # boot (idempotent) + load schema, print URL
//   node scripts/test-db.mjs reset   # drop + recreate + reload schema/migrations
//   node scripts/test-db.mjs url     # print the URL of the running cluster
//   node scripts/test-db.mjs stop    # shut down and delete the cluster
import { startCluster, stopCluster, resetDatabase, clusterAlive } from "../tests/_harness/testdb.mjs";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const cmd = process.argv[2] ?? "start";
if (cmd === "stop") {
  console.log(stopCluster() ? "stopped" : "no cluster running");
} else if (cmd === "start" || cmd === "reset" || cmd === "url") {
  const state = startCluster();
  if (!clusterAlive(state)) throw new Error("cluster failed to start");
  const marker = path.join(state.dir, "schema-loaded");
  if (cmd === "reset" || !existsSync(marker)) {
    await resetDatabase(state);
    writeFileSync(marker, new Date().toISOString());
  }
  console.log(`SJC_TEST_DATABASE_URL=${state.url}`);
} else {
  console.error("usage: test-db.mjs start|reset|url|stop");
  process.exit(2);
}
