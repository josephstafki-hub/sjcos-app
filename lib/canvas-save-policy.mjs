export const removedAreas=(baseline,selected)=>baseline.filter(k=>!selected.includes(k));
export const showRowWarnings=removed=>removed.length>0&&removed.length<=3;
export function audienceSentence(kind,selected,options,project){
 if(kind==='owner_only')return 'Only Joe can read this copy.';
 const names=options.filter(o=>selected.includes(o.key)).map(o=>o.label);
 if(!names.length)return `Staff who can open ${project} files can read this copy.`;
 if(names.length>3)return 'Only Joe and staff with every ticked area can read this copy.';
 return `Joe and staff with ${names.length===1?names[0]:names.slice(0,-1).join(', ')+' and '+names.at(-1)} access can read this copy.`;
}
export function acknowledgementLabel(selected,removed,options,project){
 if(!selected.length)return `I checked this canvas. Share it with everyone who can open ${project} files.`;
 const names=options.filter(o=>removed.includes(o.key)).map(o=>o.label);
 return `I understand — share without ${names.slice(0,2).join(', ')}${names.length>2?' +'+(names.length-2)+' more':''}`;
}
