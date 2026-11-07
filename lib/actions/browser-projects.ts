"use server";

import {searchBrowserProjects} from '@/lib/ai-chat';
import {askBoundary} from '@/lib/thread-access';
import type {AskResult} from '@/lib/ask-result-codes';

type ProjectPick={kind:'project';slug:string;name:string};
/** Browser JobPicker uses the existing component action boundary and shape. */
export async function searchBrowserProjectsAction(q:string):Promise<AskResult<{jobs:ProjectPick[]}>>{
 return askBoundary(async()=>({ok:true as const,jobs:await searchBrowserProjects(q)}));
}
