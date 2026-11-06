"use server";
import {canvasSearchProjects} from '@/lib/canvas-exports';
import {askFailure} from '@/lib/thread-access';
import type {AskResult} from '@/lib/ask-result-codes';
type ProjectPick={kind:'project';slug:string;name:string};
/** The rail keeps its owner-only entity search. This boundary returns no causes. */
export async function searchCanvasProjectsAction(id:string,version:number,query:string):Promise<AskResult<{jobs:ProjectPick[]}>>{
 try{return {ok:true,jobs:await canvasSearchProjects(id,version,query)};}
 catch(error){return askFailure(error);}
}
