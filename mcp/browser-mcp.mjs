#!/usr/bin/env node
/** Dedicated stdio Browser entry, never imported by global HTTP MCP. */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {startBrowserMcp} from './browser-tools.mjs';
import {browserMcpDependencies} from '../lib/browser/controller-adapter.mjs';
try{await startBrowserMcp({...await browserMcpDependencies(),server:new McpServer({name:'sjcos-browser',version:'1.0.0'}),transport:new StdioServerTransport()});}
catch{process.stderr.write('BROWSER_MCP_STARTUP_REFUSED\n');process.exitCode=1;}
