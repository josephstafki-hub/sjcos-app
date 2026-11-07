#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {coordinatorSequence,coordinatorCommand,RSS_CASES} from '../lib/browser/acceptance.mjs';
import {runAcceptance,parseRunnerArgs} from '../lib/browser/root-runner.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),args=process.argv.slice(2),a=parseRunnerArgs(args);
if(!args.includes('--run'))console.log(JSON.stringify({sequence:coordinatorSequence({root,uid:a.joeUid??process.getuid(),tag:a.tag??'acceptance'}),command:coordinatorCommand('rss',{root,uid:a.joeUid??process.getuid(),tag:a.tag??'acceptance'}),requiredCases:RSS_CASES,releaseReady:false,note:'Candidate root fixture only. --case is diagnostic and cannot pass full acceptance. Review common ancestor caps separately.'},null,2));
else try{await runAcceptance('rss',args);}catch(e){console.error(e.message);process.exitCode=1;}
