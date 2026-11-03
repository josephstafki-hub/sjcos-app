import { loadChecklist } from '@/lib/actions/discovery-checklist';
export const runtime='nodejs';
export async function GET(request:Request) {
 const url=new URL(request.url);const session=url.searchParams.get('session');
 const headers={'Cache-Control':'private, no-store'};
 if(!session) return Response.json({ok:false,code:'CHECKLIST_INVALID_ID'},{status:400,headers});
 try { const snapshot=await loadChecklist(session);
 if(url.searchParams.get('rev')===String(snapshot.session.revision)) return new Response(null,{status:304,headers});
 return Response.json(snapshot,{headers});
 } catch(error) { if(String(error).includes('NEXT_REDIRECT')) throw error;
 return Response.json({ok:false,code:'CHECKLIST_UNAVAILABLE'},{status:400,headers}); }
}
