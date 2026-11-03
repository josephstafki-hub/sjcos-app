import { getCurrentUser, can } from '@/lib/dal';
import { query } from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){
 const user=await getCurrentUser();
 if(!user)return Response.json({error_code:'signed_out'},{status:401});
 if(!can(user,'projects'))return Response.json({error_code:'access_denied'},{status:403});
 const {rows}=await query(`SELECT c.id,c.project_id,c.status,c.revision,c.completion_generation,c.scheduled_at,c.conducted_by
 FROM consults c WHERE ($2='owner' OR EXISTS(SELECT 1 FROM consult_assignments a WHERE a.consult_id=c.id AND a.user_id=$1 AND a.revoked_at IS NULL))
 ORDER BY c.scheduled_at DESC,c.id LIMIT 200`,[user.id,user.role]);
 return Response.json({visits:rows},{headers:{'Cache-Control':'no-store'}});
}
