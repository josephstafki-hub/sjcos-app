#!/usr/bin/node
/** Dedicated stdio browser MCP executable. Not installed in global MCP config. */
import {loadBootstrap,trustedPath} from '../../lib/browser/protected-bootstrap.mjs';
import {parseMcpIdentity} from '../../lib/browser/cli-launch.mjs';
import {startBrowserMcp} from '../../mcp/browser-tools.mjs';
try{
 const identity=parseMcpIdentity(process.argv.slice(2));if(identity.kind!=='browser')throw Error();
 const {adapter,config}=await loadBootstrap();
 if(typeof adapter.browserMcpDependencies!=='function')throw Error();
 const base='/opt/sjcos-browser/node/node_modules/@modelcontextprotocol/sdk/dist/esm/server/';
 await trustedPath(base+'mcp.js');await trustedPath(base+'stdio.js');
 const [{McpServer},{StdioServerTransport}]=await Promise.all([import(base+'mcp.js'),import(base+'stdio.js')]);
 const deps=await adapter.browserMcpDependencies({config});
 await startBrowserMcp({...deps,server:new McpServer({name:'sjcos-browser',version:'0.0.1'}),transport:new StdioServerTransport()});
}catch{process.stderr.write('BROWSER_MCP_STARTUP_REFUSED\n');process.exitCode=1;}
