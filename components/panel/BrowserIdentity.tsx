'use server';
import {can,getCurrentUser} from '@/lib/dal';
import {threadPrincipal,requireThreadAccess,askFailure,threadQueryOne} from '@/lib/thread-access';
/** Shared pane identity is independent of either feature flag. No capability. */
export async function browserPaneIdentity(threadId:string|null){
 try{const user=await threadPrincipal();if(threadId)await requireThreadAccess(threadId,user);return {ok:true as const,userId:user.id,isOwner:user.role==='owner',canChooseProject:can(await getCurrentUser(),'projects'),name:(await getCurrentUser())?.name??null};}catch(e){return askFailure(e);}
}

/** Trusted job metadata from the caller's own chat folder; never page text. */
export async function browserProject(slug:string){
 try{await threadPrincipal();if(!can(await getCurrentUser(),'projects'))return {ok:false as const};
 const project=await threadQueryOne<{id:string;label:string}>(`SELECT id,name AS label FROM projects WHERE slug=$1 OR id::text=$1`,[slug]);
 return {ok:true as const,project};}catch(e){return askFailure(e);}
}
export async function browserChatProject(threadId:string){
 try{const user=await threadPrincipal();await requireThreadAccess(threadId,user);if(!can(await getCurrentUser(),'projects'))return {ok:true as const,project:null};
 const project=await threadQueryOne<{id:string;label:string}>(`SELECT p.id,p.name AS label FROM ai_conversations c JOIN ai_folders f ON f.id=c.folder_id AND f.owner_user_id=$2 JOIN projects p ON f.entity_kind='project' AND (p.slug=f.entity_id OR p.id::text=f.entity_id) WHERE c.id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL`,[threadId,user.id]);
 return {ok:true as const,project};}catch(e){return askFailure(e);}
}
