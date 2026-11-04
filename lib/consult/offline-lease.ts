/** Server-only signing; public verification key is pinned during online enrollment. */
import {createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import type {DeviceLease,SignedLease} from './offline.ts';
export function signOfflineLease(lease:DeviceLease,secret:Buffer):SignedLease{
 const seed=createHash('sha256').update('consult-offline-lease-v1').update(secret).digest();
 const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
 const payload=JSON.stringify(lease);return {payload,signature:sign(null,Buffer.from(payload),key).toString('base64'),public_key:createPublicKey(key).export({format:'jwk'})};
}
