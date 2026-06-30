# SJC OS — MCP server

`sjcos-mcp.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io)
server exposing **read-only, structured access** to the SJC OS database. MCP is
an open standard, so this is **AI-agnostic** — any MCP client (Claude Desktop,
Claude Code, Cursor, Continue, …) can connect, not just Claude.

It runs as its own process over **stdio**, separate from the Next app, and reads
`DATABASE_URL` from `../.env.local`.

## Tools

| Tool | Purpose |
|---|---|
| `business_snapshot` | Counts: leads by stage, projects by status, subs, outstanding A/R, compliance due in 60d |
| `list_leads` | Leads (optional `stage`, `limit`) |
| `get_lead` | One lead + intake answers + recent activity (`slug`) |
| `list_projects` | Projects (optional `status`) |
| `get_project` | One project + invoices + subs + money summary (`slug`) |
| `list_subs` | Subcontractors + COI status (optional `trade`) |
| `list_compliance` | Unresolved compliance items due within N days (`within_days`, default 90) |
| `list_signature_requests` | E-sign requests (optional `project_slug`, `status`) |

All tools are parameterized `SELECT`s. **No raw-SQL tool** is exposed. Write
tools (owner-gated) can be added later.

## Register with a client

**Claude Code (CLI):**
```
claude mcp add sjcos -- node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs
```

**Generic client config (e.g. Claude Desktop `claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "sjcos": {
      "command": "node",
      "args": ["/home/joe/sjcos-app/mcp/sjcos-mcp.mjs"]
    }
  }
}
```

The client spawns the server with a clean env; the server falls back to reading
`DATABASE_URL` from `.env.local`, so no extra env wiring is needed when run from
the project on this box.

## Smoke test

```
# from sjcos-app/, a quick stdio round-trip:
node -e '
import("@modelcontextprotocol/sdk/client/index.js").then(async ({Client})=>{
  const {StdioClientTransport}=await import("@modelcontextprotocol/sdk/client/stdio.js");
  const c=new Client({name:"t",version:"1.0.0"});
  await c.connect(new StdioClientTransport({command:"node",args:["mcp/sjcos-mcp.mjs"]}));
  console.log((await c.listTools()).tools.map(t=>t.name));
  await c.close();
});'
```
