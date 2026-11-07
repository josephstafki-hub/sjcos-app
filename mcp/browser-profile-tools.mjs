/** Exact browser-profile SJC and human-only schemas. Never ordinary MCP. */
import {z} from 'zod';
import {UUID} from '../lib/browser/phase1-contracts.mjs';
import {parseMcpIdentity} from '../lib/browser/cli-launch.mjs';
import {startupFromRendezvous} from '../lib/browser/rendezvous-client.mjs';
import {unixCall} from '../lib/browser/controller-rpc.mjs';
const o=z.strictObject,s=n=>z.string().max(n),nullable=s(4000).nullable();
const project=o({address:nullable,scope:nullable,permit_checklist:z.array(o({id:UUID,label:s(200),completed:z.boolean()})).max(50),license_facts:z.array(o({id:UUID,kind:s(80),value:s(200),confirmed_revision:z.number().int().positive()})).max(20)});
export const PROFILE_TOOLS=Object.freeze({
 sjcos:Object.freeze({
  get_operating_context:{input:o({}),output:o({browser_rules_version:z.literal(1),required_areas:z.array(s(120)).min(1).max(32)})},
  get_project:{input:o({project_id:UUID}),output:o({id:UUID,confirmed_facts:project})},
  get_lead:{input:o({slug:s(160).min(1)}),output:o({slug:s(160),confirmed_facts:o({address:nullable,scope:nullable})})},
  get_work_item:{input:o({id:UUID}),output:o({id:UUID,status:s(80),due_at:z.iso.datetime().nullable(),type:s(80)})},
 }),
 interact:Object.freeze({ask_owner:{input:o({question:s(1000).min(1)}),output:o({answer:s(4000)})}})
});
export function registerProfileTools(server,{kind,verifiedRun,invoke}){
 if(!PROFILE_TOOLS[kind]||verifiedRun?.profile!=='browser'||!verifiedRun.capability||typeof invoke!=='function')throw Error('BROWSER_RENDEZVOUS_REFUSED');
 for(const [name,schema] of Object.entries(PROFILE_TOOLS[kind]))server.registerTool(name,{description:'Bound task facts or a nonsecret question to the initiating person.',inputSchema:schema.input},async raw=>{
  try{const input=schema.input.parse(raw),result=schema.output.parse(await invoke({kind,name,input,run:verifiedRun}));if(Buffer.byteLength(JSON.stringify(result))>16384)throw Error();return {content:[{type:'text',text:JSON.stringify(result)}]};}
  catch{return {isError:true,content:[{type:'text',text:'{"ok":false,"code":"BROWSER_FORBIDDEN"}'}]};}
 });
 if(kind==='interact')server.registerTool('approve_action',{description:'Deny unsupported permissions.',inputSchema:o({tool_name:s(200),input:z.unknown(),tool_use_id:s(200).optional()})},async()=>({content:[{type:'text',text:JSON.stringify({behavior:'deny',message:'BROWSER_PHASE1_READ_ONLY'})}]}));
}
export async function startFilteredProfileMcp({kind,args=process.argv.slice(2),connectDb,call=unixCall,server,transport}){
 const identity=parseMcpIdentity(args);if(identity.kind!==kind||!PROFILE_TOOLS[kind])throw Error('BROWSER_RENDEZVOUS_REFUSED');
 const {client,verifiedRun}=await startupFromRendezvous({...identity,connectDb});
 try{registerProfileTools(server,{kind,verifiedRun,invoke:async payload=>{const ack=await call('/run/sjcos-browser/mcp-controller.sock',{v:1,op:'profile_invoke',...payload});if(ack.ok!==true)throw Error();return ack.result;}});await server.connect(transport);return {close:async()=>{await server.close();await client.end();}};}catch{await client.end();throw Error('BROWSER_RENDEZVOUS_REFUSED');}
}
/** Runs before ordinary environment resolution/registration. No HTTP branch. */
export async function runFilteredProfileEntry(kind){
 if(process.env.MCP_HTTP_PORT&&process.env.MCP_HTTP_PORT!=='0')throw Error('BROWSER_ATTENDED_ONLY');
 const [{McpServer},{StdioServerTransport},{default:pg}]=await Promise.all([import('@modelcontextprotocol/sdk/server/mcp.js'),import('@modelcontextprotocol/sdk/server/stdio.js'),import('pg')]);
 const server=new McpServer({name:'sjcos-browser-'+kind,version:'1.0.0'}),transport=new StdioServerTransport();
 const handle=await startFilteredProfileMcp({kind,server,transport,connectDb:async dsn=>{const client=new pg.Client({connectionString:dsn});await client.connect();return client;}});
 await new Promise(resolve=>{const old=transport.onclose;transport.onclose=()=>{old?.();resolve();};});await handle.close();
}
