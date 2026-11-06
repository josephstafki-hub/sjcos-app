import 'server-only';
// Canonical full-designer entry loader. The Canvas entry uses the same area
// gate, then its stricter snapshot-only serializer (no inspector data at all).
import {getPlanDesign,getPlaceableCatalog,getPlanCostRules,listPlanDesignComments,listPlanDesignFiles,listPlanDesignVersions} from './plan-designs';
import {listEstimateTargets} from './actions/plan-estimate';
import {assertFloorAccess} from './canvas-floor';
export async function loadPlanDesigner(person:{id:string;role:string;permissions:string[];active?:boolean},id:number) {
 const design=await getPlanDesign(id);
 if(!design)throw Error('CANVAS_UNAVAILABLE');
 assertFloorAccess(person,{project_id:design.projectId,lead_slug:design.leadSlug,is_template:design.isTemplate},true);
 const can=(key:string)=>person.role==='owner'||person.permissions.includes(key);
 const [catalog,rules,comments,files,versions,estimateTargets]=await Promise.all([
  can('catalog')?getPlaceableCatalog():[],can('cost_book')?getPlanCostRules():[],listPlanDesignComments(id),listPlanDesignFiles(id),listPlanDesignVersions(id),can('estimates')?listEstimateTargets(id):[],
 ]);
 return {design,catalog:can('money')?catalog:catalog.map(c=>({...c,price:'',priceCents:null,costItemId:null})),costRuleKeys:rules.filter(r=>r.enabled).map(r=>r.measure),comments,files,versions,estimateTargets,readOnly:false,isOwner:person.role==='owner'};
}
