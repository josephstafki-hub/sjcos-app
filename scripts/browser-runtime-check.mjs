#!/usr/bin/env node
// Metadata/files only. No executable imports, DNS, DB, browsers or services.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyRuntimeFiles,runtimeReadiness} from '../lib/browser/runtime-readiness.mjs';
import {RUNTIME_PINS} from '../lib/browser/runtime-pins.mjs';
const root=process.cwd(),lock=JSON.parse(await readFile(path.join(root,'deploy/browser/runtime-lock.json'),'utf8'));
const files=await verifyRuntimeFiles(root,lock);
let installedVersion=null;try{installedVersion=JSON.parse(await readFile(path.join(root,'node_modules/playwright-core/package.json'),'utf8')).version;}catch{}
const readiness=runtimeReadiness(null);
console.log(JSON.stringify({files,playwright:{expected:RUNTIME_PINS.playwrightCore.version,installed:installedVersion,ok:installedVersion===RUNTIME_PINS.playwrightCore.version},readiness,releaseReady:false},null,2));
if(!files.ok||installedVersion!==RUNTIME_PINS.playwrightCore.version||!readiness.ok)process.exitCode=1;
