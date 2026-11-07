#!/usr/bin/env node
// Installed runtime only. No browser, socket, DB or service launch.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeFiles,runtimeReadiness,inspectInstalledRuntime} from '../lib/browser/runtime-readiness.mjs';
import {loadAttestation} from '../lib/browser/acceptance-attestation.mjs';
import {sha256} from '../lib/browser/runtime-readiness.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),lock=JSON.parse(await readFile(path.join(root,'deploy/browser/runtime-lock.json'),'utf8'));
const files=await verifyRuntimeFiles(root,lock);
const installed=await inspectInstalledRuntime('/opt/sjcos-browser',lock);
try{
 if(sha256(await readFile('/opt/sjcos-browser/runtime-lock.json'))!==sha256(await readFile(path.join(root,'deploy/browser/runtime-lock.json'))))throw Error();
}catch{installed.ok=false;installed.failures.push('installed-source-lock-mismatch');}
let attestation,signatureError;
try{
 attestation=await loadAttestation(sha256(await readFile('/opt/sjcos-browser/runtime-lock.json')));
 for(const key of ['parserPatchSha256','playwrightPatchSha256','patchedBundleSha256','pythonTransitiveLockSha256'])if(attestation[key]!==lock.acceptance[key])throw Error();
 if(attestation.chromiumSha256!==installed.hashes['/opt/sjcos-browser/browsers/chromium-1248/chrome-linux64/chrome'])throw Error();
}catch{attestation=undefined;signatureError='BROWSER_INDEPENDENT_ATTESTATION_REQUIRED';}
const readiness=runtimeReadiness(attestation,a=>a===attestation&&!!attestation);
// --installation-only permits inspection BEFORE acceptance exists. It cannot
// affect the launcher's readiness gate or turn on any browser flag.
const installationOnly=process.argv.includes('--installation-only');
console.log(JSON.stringify({files,installed,installationReady:files.ok&&installed.ok,readiness,signatureError,installationOnly,releaseReady:false},null,2));
if(!files.ok||!installed.ok||(!installationOnly&&!readiness.ok))process.exitCode=1;
