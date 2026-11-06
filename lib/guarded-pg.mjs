/** The only runtime pg import. Check before construction AND pool reuse/connect. */
import pg from 'pg';
import {assertTestDatabaseConfig} from './test-db-guard.mjs';
const boundary={
 construct(Target,args,newTarget){
  const config=args[0];assertTestDatabaseConfig(config);
  const instance=Reflect.construct(Target,args,newTarget);
  for(const method of ['connect','query'])instance[method]=new Proxy(instance[method],{
   apply(fn,self,params){assertTestDatabaseConfig(config);return Reflect.apply(fn,self,params);},
  });
  return instance;
 },
};
export const Pool=new Proxy(pg.Pool,boundary);
export const Client=new Proxy(pg.Client,boundary);
export default {...pg,Pool,Client};
