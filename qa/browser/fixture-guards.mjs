/** QA artifact/tooling only. Never imported by the production module graph. */
export async function qaBrowserDirectory(db,env=process.env){
 if(env.SJC_QA_SIDE_BUILD!=='1'||!env.SJC_QA_BROWSER_FAKE)return null;
 const dir=env.SJC_QA_BROWSER_FAKE;
 if(!/^\/home\/joe\/qa-sjcos\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(dir))throw Error('BROWSER_DISABLED');
 const {rows}=await db.query("SELECT current_database() AS name,current_setting('port')::int AS port");
 if(!/^sjcos_qa_[a-z0-9_]+$/.test(rows[0]?.name??'')||!Number.isInteger(rows[0]?.port)||rows[0].port===5432)throw Error('BROWSER_DISABLED');
 return dir;
}
export async function clusterBinding(db){
 const {rows}=await db.query("SELECT (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('port')::int AS port,pg_postmaster_start_time()::text AS started_at");
 return rows[0];
}
