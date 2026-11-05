// Ops only: run ONCE for a demonstrably never-enabled installation. Never on
// restore/lost state; recover its protected deployment volume instead.
import {bootstrapDeployment} from '../lib/ask-deployment-state.mjs';
if(process.argv[2]!=='--new-install')throw Error('Explicit --new-install required; never bootstrap a restore');
await bootstrapDeployment();
console.log('Ask deployment identity provisioned. Protect this volume outside DB/journal restores.');
