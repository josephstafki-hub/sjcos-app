/** Shared picker/server rules. The byte cap applies before MIME/base64 encoding. */
export const MAX_MAIL_BYTES = 20 * 1024 * 1024;
export const MAIL_FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt';
export type MailFileInfo = {name:string;size:number;type:string};
const extensions: Record<string,string[]> = {
 jpg:['image/jpeg'],jpeg:['image/jpeg'],png:['image/png'],gif:['image/gif'],webp:['image/webp'],heic:['image/heic'],heif:['image/heif'],pdf:['application/pdf'],
 doc:['application/msword'],docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
 xls:['application/vnd.ms-excel'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
 ppt:['application/vnd.ms-powerpoint'],pptx:['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
 txt:['text/plain'],csv:['text/csv','application/vnd.ms-excel'],rtf:['application/rtf','text/rtf'],odt:['application/vnd.oasis.opendocument.text'],
};
export function mailFileType(file:MailFileInfo):string {
 const types=extensions[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
 if(!types || /[\r\n"\\]/.test(file.name) || !file.name.trim()) throw Error('Choose images, PDFs or common document files.');
 if(file.type && file.type!=='application/octet-stream' && !types.includes(file.type.toLowerCase())) throw Error(`File type does not match ${file.name}.`);
 return types[0];
}
export function validateMailFiles(files:MailFileInfo[]):void {
 if(files.length>50)throw Error('Attach at most 50 files.');
 let total=0;
 for(const file of files){mailFileType(file);if(!Number.isSafeInteger(file.size)||file.size<0)throw Error('Invalid file size.');total+=file.size;}
 if(total>MAX_MAIL_BYTES)throw Error('Attachments must total 20 MB or less.');
}
export function fileSize(size:number):string {return size>=1024*1024?`${(size/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.ceil(size/1024))} KB`;}
