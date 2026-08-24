#!/usr/bin/env node
// Call one sjcos MCP tool from a shell — safely.
//
//   printf '%s' '{"slug":"molly-egan"}' | node mcp/call-tool.mjs get_project
//   node mcp/call-tool.mjs get_today_queue        # no-arg tools need no stdin
//
// The arguments JSON is read from STDIN, never from argv: an argv word has to
// be quoted by the shell, and inside double quotes bash expands $1/$2/… to
// nothing, so a body containing "$2,200" silently becomes ",200" (this exact
// bug corrupted live work-item data once — see strippedDollarError in
// sjcos-mcp.mjs). Stdin bytes pass through no interpolation layer at all.
//
// Spawns the stdio MCP server as a child; MCP_HTTP_PORT=0 keeps the child off
// the HTTP port the long-running sjcos-mcp.service already owns.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolName = process.argv[2];
if (!toolName || process.argv[3] !== undefined) {
  console.error("usage: printf '%s' '<argsJson>' | node mcp/call-tool.mjs <tool>");
  console.error("(args come from stdin only — an argv word would pass through shell quoting)");
  process.exit(2);
}

let stdin = "";
if (!process.stdin.isTTY) {
  for await (const chunk of process.stdin) stdin += chunk;
}
const args = stdin.trim() ? JSON.parse(stdin) : {};

const client = new Client({ name: "sjcos-call-tool", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(__dirname, "sjcos-mcp.mjs")],
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, MCP_HTTP_PORT: "0" },
});

await client.connect(transport);
try {
  const result = await client.callTool({ name: toolName, arguments: args });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
