export interface FileManifestEntry {name:string;size:number;type:string;lastModified:number}
type StorageRead=Pick<Storage,'getItem'>;
type StorageWrite=Pick<Storage,'setItem'|'removeItem'>;
export function fileManifestKey(mailbox:string,userId:string,threadKey:string):string {
  return JSON.stringify(['sjc:inbox:file-manifest:v1',mailbox.toLowerCase(),userId,threadKey]);
}
export function readFileManifest(storage:StorageRead,key:string):FileManifestEntry[] {
  try{
    const data:unknown=JSON.parse(storage.getItem(key)??'[]');
    return Array.isArray(data)?data.filter((f):f is FileManifestEntry=>Boolean(f)&&typeof f.name==='string'&&typeof f.type==='string'&&Number.isFinite(f.size)&&Number.isFinite(f.lastModified)):[];
  }catch{return [];}
}
export function saveFileManifest(storage:StorageWrite,key:string,files:FileManifestEntry[]):boolean {
  try{
    if(files.length)storage.setItem(key,JSON.stringify(files.map(({name,size,type,lastModified})=>({name,size,type,lastModified}))));
    else storage.removeItem(key);
    return true;
  }catch{return false;}
}
export function missingFiles(manifest:FileManifestEntry[],files:FileManifestEntry[]):FileManifestEntry[] {
  return manifest.filter(old=>!files.some(file=>file.name===old.name&&file.size===old.size&&file.type===old.type&&file.lastModified===old.lastModified));
}
