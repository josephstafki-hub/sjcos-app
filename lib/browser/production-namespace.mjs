/** Fixed production identity, checked independently of caller-supplied RPC data. */
import {readFile,readlink,stat} from 'node:fs/promises';
import {validateProductionNamespace} from './launcher.mjs';
export function validateProductionIdentity(x){
 if(!Number.isSafeInteger(x.uid)||x.uid<=0||x.uid!==x.controllerUid||x.controllerUid===998||x.browserUid!==998||x.browserName!=='sjcos-browser')throw Error('BROWSER_PRODUCTION_IDENTITY_REFUSED');
 try{validateProductionNamespace(x.namespace);}catch{throw Error('BROWSER_PRODUCTION_NAMESPACE_REFUSED');}return true;
}
export async function productionIdentity(){
 const rows=(await readFile('/etc/passwd','utf8')).split('\n').map(x=>x.split(':'));
 const browser=rows.find(x=>x[0]==='sjcos-browser'),controller=rows.find(x=>x[0]==='sjcos-browser-controller');
 const [current,host,expected,self]=await Promise.all([readlink('/proc/self/ns/net'),readlink('/proc/1/ns/net'),stat('/run/netns/sjcos-browser'),stat('/proc/self/ns/net')]);
 const value={uid:process.getuid(),controllerUid:Number(controller?.[2]),browserUid:Number(browser?.[2]),browserName:browser?.[0],namespace:{name:'sjcos-browser',current,host,expectedInode:Number(expected.ino),currentInode:Number(self.ino)}};validateProductionIdentity(value);return value;
}
