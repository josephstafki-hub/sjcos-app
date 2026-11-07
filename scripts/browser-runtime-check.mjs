#!/usr/bin/env node
// Installed runtime only. No browser, socket, DB or service launch.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyRuntimeFiles,runtimeReadiness,inspectInstalledRuntime} from '../lib/browser/runtime-readiness.mjs';
const root=process.cwd(),lock=JSON.parse(await readFile(path.join(root,'deploy/browser/runtime-lock.json'),'utf8'));
const files=await verifyRuntimeFiles(root,lock);
const installed=await inspectInstalledRuntime('/opt/sjcos-browser',lock);
// A root-owned JSON object alone is not a signature. Independent root trust-key
// verification is deliberately absent until the acceptance reviewer supplies it.
const readiness=runtimeReadiness(lock.acceptance);
console.log(JSON.stringify({files,installed,readiness,releaseReady:false},null,2));
if(!files.ok||!installed.ok||!readiness.ok)process.exitCode=1;
