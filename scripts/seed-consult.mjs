// Fresh-install companion, after the first owner has been provisioned.
// Requires an explicit owner-connection URL; never falls back to a local env file.
import pg from 'pg';import {seedConsult} from '../db/seed-consult.mjs';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required explicitly');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{console.log(await seedConsult(client));}finally{await client.end();}
