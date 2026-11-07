#!/usr/bin/node
import {runSuite} from '../../../lib/browser/root-fixture.mjs';
try{await runSuite(process.argv.slice(2));}catch(e){console.error(e.stack);process.exitCode=1;}
