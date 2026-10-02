// lib/authority — delegated approval authority, worker identities, agent run
// profiles and usage metering (A08a / A08b / A22).
//
// Pure (importable from node --test and the MCP .mjs server):
//   catalog.ts          approval action types + labels; gated-action → kind map
//   grants.ts           grant / revoke / list / effectiveAuthority / session revocations / audit
//   mcp-gate.ts         principalMaySpendGrant() — the person-behind-the-agent check
//   usage.ts            thresholds + agent_usage rows
//   worker-identity.ts  worker registry + assertWorkerMay()
//   run-profile.mjs     operator vs business profile: CLI args, limits, admission
// server-only:
//   commands.ts         the above wrapped in lib/commands/db command()

export * from "./catalog";
export * from "./grants";
export * from "./mcp-gate";
export * from "./usage";
export * from "./worker-identity";
