# X MCP / Open Brain overview from Joseph

Joseph provided this document as background while teaching SJC OS / Open Brain.

Key ideas captured:

- X provides two hosted MCP servers:
  - X API MCP: `https://api.x.com/mcp`, normally reached through `xurl mcp` for OAuth/user-context access.
  - Docs MCP: `https://docs.x.com/mcp`, for searching/reading X API docs.
- X API MCP capabilities include posts, search, users, bookmarks, news/trends, and Articles.
- The full user-context route uses a local `xurl mcp` bridge over stdio JSON-RPC:
  - MCP client -> local `xurl mcp` bridge -> hosted `api.x.com/mcp`
  - The bridge handles OAuth2 PKCE, browser login, token caching, and token refresh.
- App-only Bearer token route can connect directly to `https://api.x.com/mcp` with an Authorization header, but is read-only/no user context.
- The docs MCP can be connected directly by URL: `https://docs.x.com/mcp`.
- Useful security notes:
  - Treat `~/.xurl`, access tokens, CLIENT_ID, CLIENT_SECRET, and bearer tokens as secrets.
  - Prefer env vars/config references over committing raw secrets.
  - Use dedicated X apps/scopes.
- Joseph wants this as part of teaching the assistant how SJC OS software and Open Brain are supposed to work.

Original source file in Hermes cache:
`/home/joe/.hermes/cache/documents/doc_a7fce07fb984_Untitled document.md`
