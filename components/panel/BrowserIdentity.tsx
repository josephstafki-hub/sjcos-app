'use server';
import {getCurrentUser} from '@/lib/dal';
import {threadPrincipal,requireThreadAccess,askFailure} from '@/lib/thread-access';
/** Shared pane identity is independent of either feature flag. No capability. */
export async function browserPaneIdentity(threadId:string|null){
 try{const user=await threadPrincipal();if(threadId)await requireThreadAccess(threadId,user);return {ok:true as const,userId:user.id,isOwner:user.role==='owner',name:(await getCurrentUser())?.name??null};}catch(e){return askFailure(e);}
}
