/** Owner-connection seed loader. Caller owns transaction and authenticated context.
 * All drafts are staged before publishing so mutually referring modules validate.
 * Never replace Joe's published versions. */
import type {PoolClient} from 'pg';
import {publish} from '../protocol.ts';
import {seedModules,templates,addOns,scopeMappings,validateSeed} from './seed.ts';
export async function publishConsultSeed(c:PoolClient,context:Parameters<typeof publish>[1],owner:string){
 validateSeed();
 const registry=(await c.query(`INSERT INTO consult_mapping_registries(version,mappings,author)
 SELECT coalesce(max(version),0)+1,$1,$2 FROM consult_mapping_registries RETURNING id`,[scopeMappings,owner])).rows[0].id;
 const staged:string[]=[];
 for(const [kind,defs] of [['module',seedModules],['template',[...templates,...addOns]]] as const)for(const def of defs){
  if((await c.query('SELECT id FROM consult_form_versions WHERE kind=$1 AND key=$2 AND status=\'published\'',[kind,def.key])).rowCount)continue;
  const row=(await c.query(`INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES($1,$2,$3,$4,'',$5) RETURNING id`,[kind,def.key,def.version,def,owner])).rows[0];staged.push(row.id);
 }
 for(const id of staged)await publish(c,context,{form_id:id,registry_id:registry});
 return {published:staged.length};
}
