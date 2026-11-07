// Pure, explicit serialization boundary. No catalog/rule/estimate/file reads.
import {docCounts,migrateDoc} from './plan-doc.ts';
import type {DesignerProps} from '../components/floor/Designer';
export function floorBoundaryId(id:unknown):number {
 if(typeof id!=='string'||!/^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id)))throw Error('INVALID_INPUT');
 return Number(id);
}
// Only the visual scalar props used by generic cabinetry/appliance renderers.
const visualProps=new Set(['construction','doorStyle','drawerStyle','finish','finishColor','hardware','hardwareFinish','pullIn','toe','crown','lightRail','glass','doors','drawers','hinge','color','roughness','modelKey','power','venting']);
export function floorPreviewProps(row:Record<string,any>):DesignerProps {
 const id=floorBoundaryId(row.design_id),sid=floorBoundaryId(row.id);
 const doc=migrateDoc(row.doc);
 doc.meta={};doc.photos=[];doc.underlay=null;doc.underlays=[];
 doc.items=doc.items.map(i=>({...i,catalogId:null,selectionOptionId:null,props:Object.fromEntries(Object.entries(i.props).filter(([k,v])=>visualProps.has(k)&&['string','number','boolean'].includes(typeof v)))}));
 // Finish references contain catalog IDs too; never pass them to this viewer.
 const strip=(v:any):any=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='catalogId'&&k!=='selectionOptionId').map(([k,x])=>[k,strip(x)])):v;
 const clean=strip(doc);for(const i of clean.items)i.catalogId=null;
 return {design:{id,name:row.name,projectId:row.project_id??null,projectSlug:row.project_slug??null,projectName:null,leadSlug:row.lead_slug??null,leadName:null,isTemplate:false,rev:row.source_rev??0,updatedAt:new Date(row.created_at??0).toISOString(),updatedLabel:'',counts:docCounts(clean),versionCount:0,latestVersion:{id:sid,number:row.number,label:''},doc:clean},catalog:[],costRuleKeys:[],comments:[],files:[],versions:[],estimateTargets:[],readOnly:true,isOwner:false,embeddedPreview:true};
}
