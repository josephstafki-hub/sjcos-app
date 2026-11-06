export const id = '123e4567-e89b-42d3-a456-426614174000';
export const task = {
  task_id:id,run_id:id,state:'active',control:'agent',private:false,privacy_mode:'public',
  allowed_sites:['https://permit.example'],required_areas:['projects','compliance'],
  manifest_revision:1,read_manifest_revision:1,control_epoch:0,document_epoch:1,attention:'none',
};
export const publicObservation = {ok:true,observation_id:id,document_epoch:1,
  expires_at:'2026-11-05T18:00:00.000Z',private:false,
  untrusted_page:{origin:'https://permit.example',text:'Untrusted portal text',
    controls:[{ref:'r1',role:'button',label:'Next'}]}};
export const privateObservation = {ok:true,observation_id:id,document_epoch:1,
  expires_at:'2026-11-05T18:00:00.000Z',private:true,adapter_id:null,controls:[]};
// One fixture for the research producer and attended-start consumer. §11's exact
// payload contains no task_id: association with a task is server-side on Open.
export const permitHandoff = {version:1,project_id:id,project_slug:'bath-renovation',
  work_item_id:id,research_file_ids:['file-brief'],portal_origin:null,city:null,
  confirmed_facts:{address:null,applicant_name:null,license_number:null,scope_summary:null},
  missing:['Confirm portal'],required_areas:['projects','compliance'],
  next_step:'confirm_details',source_trigger_ref:'project:123:permit'};
export const inputs = {
  browser_open:{task_id:id},browser_status:{task_id:id},browser_observe:{task_id:id},
  browser_navigate:{task_id:id,url:'https://permit.example/',observation_id:id,idempotency_key:id},
  browser_act:{task_id:id,observation_id:id,ref:'r1',operation:'click',idempotency_key:id},
  browser_list_logins:{task_id:id},
  browser_fill_login:{task_id:id,login_id:id,observation_id:id,idempotency_key:id},
  browser_prepare_action:{task_id:id,observation_id:id,ref:'r1',kind:'submit',summary:'Submit application',idempotency_key:id},
  browser_request_take_over:{task_id:id,reason:'login'},browser_action_status:{task_id:id,action_id:id},
  browser_list_downloads:{task_id:id},
  browser_stage_upload:{task_id:id,file_id:'file-plan',observation_id:id,ref:'r1',idempotency_key:id},
  browser_close:{task_id:id,reason:'finished'},
};
export const outputs = {
  browser_open:{ok:true,task,queue_position:null},
  browser_status:{ok:true,task,pending_action_id:null,last_result:'none'},
  browser_observe:publicObservation,
  browser_navigate:{ok:true,task,result:'loaded',action_id:null},
  browser_act:{ok:true,result:'done',action_id:null,document_epoch:1},
  browser_list_logins:{ok:true,logins:[{id,label:'Permit portal',origin:'https://permit.example',can_use:true}]},
  browser_fill_login:{ok:true,status:'private',login_filled:true},
  browser_prepare_action:{ok:true,action_id:id,state:'pending',needs_owner:true,expires_at:'2026-11-05T18:00:00.000Z'},
  browser_request_take_over:{ok:true,task,requested:true},
  browser_action_status:{ok:true,action_id:id,state:'pending',result_code:null,needs_person:true},
  browser_list_downloads:{ok:true,downloads:[{download_id:id,name:'Private browser file.',mime:'application/pdf',bytes:12,private:true,state:'quarantined'}]},
  browser_stage_upload:{ok:true,action_id:id,state:'pending',needs_owner:true,expires_at:'2026-11-05T18:00:00.000Z'},
  browser_close:{ok:true,task_id:id,state:'closed'},
};
