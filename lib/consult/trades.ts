/** Shared captured-fact trade derivation for device and authoritative close. */
export const TRADES: Record<string,string> = { panel:'Electrician', electrical_panel:'Electrician', plumb_fixture:'Plumber', water:'Plumber', hvac:'HVAC', hvac_vent:'HVAC', hvac_exhaust_fan:'HVAC' };
export function touchedTrades(instances: {module_key:string}[], structureFlag:boolean, asbestos:unknown):string[] {
 const trades=new Set(instances.map(i=>TRADES[i.module_key]).filter(Boolean));
 if(structureFlag)trades.add('Engineer/framer');
 if(instances.some(i=>i.module_key==='footing'))trades.add('Excavation/foundation');
 if(Array.isArray(asbestos)&&asbestos.some(v=>v!=='None'))trades.add('Abatement');
 return [...trades];
}
