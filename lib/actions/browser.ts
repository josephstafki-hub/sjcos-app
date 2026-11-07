'use server';
import {validateBrowserReturnPath} from '@/lib/web-sessions';
/** Return links carry display selection only. They never join/start/control. */
export async function browserReturnPath(taskId:string,reviewId?:string):Promise<string|null>{
 return validateBrowserReturnPath(`/today?browser=${taskId}${reviewId?`&review=${reviewId}`:''}`);
}
