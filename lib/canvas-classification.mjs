/** Pure result classification and validation. No actor-permission inference or DB.
 * ALL content keys are PERMISSION_KEYS minus ai/projects. Every registered tool
 * covers its possible result shapes, including incidental fields and data errors.
 * Trusted provenance must be persisted BEFORE delivery; this helper cannot attest it.
 * Shape: {version:positive integer, content_areas:string[], tools:{
 *   [toolName]: {areas:string[], variants?:{[variant]:{areas:string[]}}}
 * }}. Base areas are always unioned with a selected variant's incidental areas.
 */
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const key = (s) => typeof s === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(s) && !['__proto__', 'prototype', 'constructor'].includes(s);
function invalid() { throw new TypeError('Invalid canvas classification registry.'); }
function exact(value, allowed) { if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k)))
    invalid(); }
function areaList(value, catalog) { if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(k => !key(k) || ['ai', 'projects'].includes(k) || (catalog && !catalog.includes(k))))
    invalid(); return [...value]; }
export function validateClassificationRegistry(registry) {
    exact(registry, ['version', 'content_areas', 'tools']);
    if (!Number.isSafeInteger(registry.version) || registry.version < 1)
        invalid();
    const catalog = areaList(registry.content_areas);
    if (!catalog.length || !plain(registry.tools))
        invalid();
    const tools = Object.create(null);
    for (const [name, entry] of Object.entries(registry.tools)) {
        if (!key(name))
            invalid();
        exact(entry, ['areas', 'variants']);
        const normalized = { areas: Object.freeze(areaList(entry.areas, catalog)) };
        if (Object.hasOwn(entry, 'variants')) {
            if (!plain(entry.variants) || !Object.keys(entry.variants).length)
                invalid();
            const variants = Object.create(null);
            for (const [variant, value] of Object.entries(entry.variants)) {
                if (!key(variant))
                    invalid();
                exact(value, ['areas']);
                variants[variant] = Object.freeze({ areas: Object.freeze(areaList(value.areas, catalog)) });
            }
            normalized.variants = Object.freeze(variants);
        }
        tools[name] = Object.freeze(normalized);
    }
    return Object.freeze({ version: registry.version, content_areas: Object.freeze(catalog), tools: Object.freeze(tools) });
}
export function assertEveryToolClassified(toolNames, registry) {
    const normalized = validateClassificationRegistry(registry);
    if (!Array.isArray(toolNames) || toolNames.some(n => !key(n)) || new Set(toolNames).size !== toolNames.length)
        throw new TypeError('Invalid tool name list.');
    if (toolNames.some(name => !Object.hasOwn(normalized.tools, name)))
        throw new Error('Unclassified canvas tools: '+toolNames.filter(name=>!Object.hasOwn(normalized.tools,name)).join(', '));
    return true;
}
export function classifyToolAreas(toolName, registry, variant) {
    const normalized = validateClassificationRegistry(registry);
    const entry = Object.hasOwn(normalized.tools, toolName) ? normalized.tools[toolName] : null;
    if (!entry || (entry.variants && (typeof variant !== 'string' || !Object.hasOwn(entry.variants, variant))) || (!entry.variants && variant !== undefined))
        return { areas: [...normalized.content_areas], complete: false };
    const areas = new Set([...entry.areas, ...(entry.variants?.[variant]?.areas ?? [])]);
    return { areas: normalized.content_areas.filter(k => areas.has(k)), complete: true };
}

// Content sensitivity only: projects/ai remain separate access gates.
export const CONTENT_AREAS=Object.freeze(["today","inbox","comms","chat","leads","subs","vendors","site","newsletter","catalog","compliance","warranty","marketing","engine","estimates","invoices","purchase_orders","change_orders","bidding","cost_book","money"]);

// Audited RESULT contracts, not the tool's write authority or the tables it reads.
// A tool entry is the union of ALL its modes (read/write, scope, success, empty,
// refusal and replay). The recorder passes only the name, never call arguments;
// no narrower argument-based variant is claimed. Unexpected variants still fail
// closed in classifyToolAreas. Evidence for every entry is in
// docs/plans/build/canvas-classification-HANDOFF.md.
// Keep schema version 1: this refines future inputs only; persisted full-C inputs
// and monotonic parent requirements are never reclassified or subtracted.
export const CLASSIFICATION_REGISTRY=validateClassificationRegistry({
  version:1, content_areas:CONTENT_AREAS, tools:{
    add_bid_invites: {areas: []},
    add_estimate_lines: {areas: ["estimates"]},
    add_expense: {areas: []},
    add_mood_image_from_url: {areas: []},
    add_mood_swatch: {areas: []},
    add_mood_text: {areas: []},
    add_newsletter_recipient: {areas: ["newsletter"]},
    add_plan_comment: {areas: []},
    add_purchase_order_line: {areas: []},
    add_selection_option: {areas: []},
    adjust_internal_schedule: {areas: ["money"]},
    adopt_estimate_as_budget: {areas: ["estimates","money"]},
    allocate_scope: {areas: ["estimates","money"]},
    append_project_upload: {areas: []},
    append_unsorted_upload: {areas: []},
    apply_client_direction_approval: {areas: []},
    apply_client_product: {areas: ["estimates"]},
    apply_design_feedback: {areas: []},
    apply_owner_pricing: {areas: ["estimates"]},
    apply_plan_ops: {areas: []},
    apply_selection_choice: {areas: ["estimates"]},
    apply_snag_decision: {areas: ["money"]},
    arrange_mood_board: {areas: []},
    ask_owner: {areas: []},
    assign_cost: {areas: []},
    assign_work_item: {areas: ["today"]},
    attach_bid_file: {areas: []},
    award_bid: {areas: ["purchase_orders","bidding","vendors","subs","money"]},
    build_selection_plan: {areas: []},
    business_snapshot: {areas: ["today","leads","subs","compliance","invoices","money"]},
    candidate_suppliers: {areas: ["vendors"]},
    capability_report: {areas: ["engine"]},
    capture_knowledge: {areas: []},
    check_owner_permission: {areas: [...CONTENT_AREAS]},
    choose_supplier_quote: {areas: ["estimates"]},
    close_bid_package: {areas: []},
    closeout_checklists: {areas: []},
    closeout_step: {areas: []},
    commit_on_approval: {areas: ["purchase_orders","bidding","vendors","subs","money"]},
    commit_project_upload: {areas: []},
    commit_unsorted_upload: {areas: []},
    company_financials: {areas: ["money","invoices"]},
    compare_bids: {areas: ["bidding","subs"]},
    compare_competing_quotes: {areas: ["estimates","vendors","subs","money"]},
    compile_weekly_sub_report: {areas: []},
    complete_work_item_with_evidence: {areas: []},
    confirm_schedule: {areas: ["money"]},
    cost_learning_preview: {areas: ["cost_book","money"]},
    create_bid_package: {areas: []},
    create_document_draft: {areas: ["leads","estimates","invoices","change_orders","money"]},
    create_estimate: {areas: ["estimates"]},
    create_invoice_draft: {areas: ["invoices"]},
    create_mood_board: {areas: []},
    create_newsletter_issue: {areas: []},
    create_plan_design: {areas: []},
    create_project: {areas: ["leads"]},
    create_project_upload: {areas: []},
    create_purchase_order: {areas: []},
    create_selection_item: {areas: []},
    create_selection_section: {areas: []},
    create_skill_proposal: {areas: []},
    create_unsorted_upload: {areas: []},
    create_user: {areas: ["leads","subs","chat"]},
    create_work_item: {areas: ["today"]},
    delete_estimate_lines: {areas: ["estimates"]},
    delete_expense: {areas: ["money"]},
    delete_project_file: {areas: []},
    delete_purchase_order_line: {areas: []},
    describe_plan_design: {areas: ["leads"]},
    draw_schedule: {areas: ["invoices","estimates"]},
    duplicate_plan_design: {areas: []},
    enqueue_agent_trigger: {areas: [...CONTENT_AREAS]},
    enrich_work_item: {areas: []},
    estimate_readiness: {areas: ["estimates"]},
    execute_approved_payment: {areas: ["money","vendors","subs","purchase_orders","bidding"]},
    fetch: {areas: [...CONTENT_AREAS]},
    fetch_knowledge: {areas: [...CONTENT_AREAS]},
    file_email_document: {areas: ["money"]},
    file_unsorted_document: {areas: ["money"]},
    final_reconciliation: {areas: ["invoices","estimates","change_orders"]},
    freeze_offered_prices: {areas: ["estimates"]},
    get_bid_package: {areas: ["bidding","subs"]},
    get_bill: {areas: ["money","vendors","subs","purchase_orders","bidding"]},
    get_call: {areas: ["comms"]},
    get_canvas: {areas: []},
    get_decision: {areas: [...CONTENT_AREAS]},
    get_document_draft: {areas: ["leads","estimates","invoices","change_orders","money"]},
    get_field_evidence: {areas: ["money"]},
    get_instruction_versions: {areas: ["engine"]},
    get_lead: {areas: ["leads","estimates","money"]},
    get_lead_qualification: {areas: ["leads","money"]},
    get_newsletter_issue: {areas: ["newsletter"]},
    get_obligation: {areas: ["today","engine","inbox"]},
    get_operating_context: {areas: [...CONTENT_AREAS]},
    get_plan_design: {areas: ["leads"]},
    get_plan_measures: {areas: []},
    get_project: {areas: ["estimates","invoices","change_orders","money","leads","subs"]},
    get_project_file: {areas: [...CONTENT_AREAS]},
    get_project_financials: {areas: ["money","invoices","change_orders","purchase_orders","estimates"]},
    get_project_funding: {areas: ["money","invoices"]},
    get_project_selections: {areas: ["money"]},
    get_project_workflow: {areas: ["engine","estimates","invoices","money"]},
    get_purchase_order: {areas: ["purchase_orders","subs","vendors"]},
    get_runbook: {areas: ["engine"]},
    get_runbook_instance: {areas: ["engine"]},
    get_scope_register: {areas: ["leads","estimates","money"]},
    get_skill: {areas: ["engine"]},
    get_sms_thread: {areas: ["comms"]},
    get_standing_instructions: {areas: [...CONTENT_AREAS]},
    get_today_queue: {areas: ["today"]},
    get_work_item: {areas: [...CONTENT_AREAS]},
    import_client_newsletter_recipients: {areas: []},
    import_lead: {areas: ["leads"]},
    incorporate_quote: {areas: ["estimates"]},
    incorporate_sub_bid: {areas: ["estimates","bidding"]},
    invoice_balances: {areas: ["invoices"]},
    invoice_collision_report: {areas: ["invoices"]},
    invoice_payment_history: {areas: ["invoices"]},
    link_cost_to_po: {areas: []},
    list_access_areas: {areas: []},
    list_agent_activity: {areas: [...CONTENT_AREAS]},
    list_agent_memories: {areas: [...CONTENT_AREAS]},
    list_bid_packages: {areas: ["bidding"]},
    list_calls: {areas: ["comms"]},
    list_canvases: {areas: []},
    list_catalog_materials: {areas: ["catalog","money"]},
    list_commitments: {areas: ["purchase_orders","bidding","vendors","subs","money"]},
    list_compliance: {areas: ["compliance"]},
    list_deleted_files: {areas: []},
    list_doc_templates: {areas: []},
    list_document_drafts: {areas: ["leads","estimates","invoices","change_orders","money"]},
    list_leads: {areas: ["leads","estimates"]},
    list_mood_boards: {areas: ["money"]},
    list_newsletter_groups: {areas: ["newsletter"]},
    list_newsletter_issues: {areas: ["newsletter"]},
    list_newsletter_outbox: {areas: ["newsletter"]},
    list_newsletter_recipients: {areas: ["newsletter"]},
    list_newsletter_sequences: {areas: ["newsletter"]},
    list_obligations: {areas: ["today","engine","inbox"]},
    list_operating_docs: {areas: []},
    list_owner_permissions: {areas: [...CONTENT_AREAS]},
    list_pending_decisions: {areas: [...CONTENT_AREAS]},
    list_plan_designs: {areas: ["leads"]},
    list_plan_finishes: {areas: []},
    list_plan_library: {areas: []},
    list_plan_versions: {areas: []},
    list_project_estimates: {areas: ["estimates","change_orders"]},
    list_project_files: {areas: []},
    list_projects: {areas: ["invoices"]},
    list_purchase_orders: {areas: ["purchase_orders","subs","vendors"]},
    list_recent_knowledge: {areas: [...CONTENT_AREAS]},
    list_runbook_instances: {areas: ["engine"]},
    list_runbooks: {areas: ["engine"]},
    list_schedule_plans: {areas: ["money"]},
    list_signature_requests: {areas: ["leads"]},
    list_skills: {areas: ["engine"]},
    list_sms_threads: {areas: ["comms"]},
    list_subs: {areas: ["subs","compliance","money"]},
    list_unsorted_documents: {areas: ["money","inbox"]},
    list_users: {areas: ["leads","subs","chat"]},
    list_vendors: {areas: ["vendors"]},
    list_work_items: {areas: ["today"]},
    mark_bid_working: {areas: []},
    measurement_summary: {areas: ["engine","money","today"]},
    overhead_summary: {areas: ["money"]},
    place_call: {areas: ["comms"]},
    plan_buyout: {areas: ["money","invoices","purchase_orders"]},
    prepare_estimate_inputs: {areas: ["leads","money"]},
    prepare_tentative_schedule: {areas: ["money"]},
    preview_lead_followups: {areas: ["leads","money"]},
    pricing_setup: {areas: ["estimates","cost_book","invoices","money"]},
    procedure_checks: {areas: [...CONTENT_AREAS]},
    queue_newsletter_issue: {areas: []},
    queue_purchase_order: {areas: []},
    read_chat_attachment: {areas: []},
    read_operating_doc: {areas: []},
    receive_bill: {areas: ["money","vendors","subs","purchase_orders","bidding"]},
    record_acknowledgement: {areas: ["purchase_orders","bidding","vendors","subs","money"]},
    record_agent_execution: {areas: [...CONTENT_AREAS]},
    record_agent_run: {areas: []},
    record_bid: {areas: ["bidding"]},
    record_completion_report: {areas: []},
    record_delivery: {areas: ["purchase_orders","bidding","vendors","subs","money"]},
    record_field_progress: {areas: []},
    record_manual_payment: {areas: ["invoices"]},
    record_manual_payment_confirmation: {areas: ["money","vendors","subs","purchase_orders","bidding"]},
    record_quote: {areas: []},
    record_receipt: {areas: []},
    record_site_findings: {areas: ["estimates","money"]},
    record_skill_used: {areas: []},
    record_sub_invoice: {areas: []},
    record_supplier_evidence: {areas: []},
    record_workflow_event: {areas: []},
    release_newsletter_issue: {areas: ["newsletter"]},
    release_newsletter_outbox_item: {areas: ["newsletter"]},
    remember_agent_instruction: {areas: []},
    remove_bid_file: {areas: []},
    remove_bid_invite: {areas: []},
    remove_newsletter_recipient: {areas: []},
    render_document_draft: {areas: []},
    reply_on_unsorted_document: {areas: ["money"]},
    reply_to_owner: {areas: []},
    report_snag: {areas: ["money"]},
    request_company_funding: {areas: ["money"]},
    request_owner_permission: {areas: [...CONTENT_AREAS]},
    research_price: {areas: ["estimates","money"]},
    reset_user_password: {areas: ["leads","subs","chat"]},
    restore_file: {areas: []},
    restore_project_file: {areas: []},
    restore_work_item: {areas: []},
    reverse_manual_payment: {areas: ["invoices"]},
    review_delivery: {areas: ["purchase_orders","bidding"]},
    run_plan_checks: {areas: []},
    runbook_repair_preview: {areas: ["engine"]},
    save_lead_rough_estimate: {areas: ["leads","estimates"]},
    save_plan_version: {areas: []},
    save_project_file: {areas: []},
    search: {areas: [...CONTENT_AREAS]},
    search_knowledge: {areas: [...CONTENT_AREAS]},
    search_operating_docs: {areas: []},
    search_skills: {areas: ["engine"]},
    select_bid_for_estimate: {areas: ["bidding"]},
    send_bid_package: {areas: ["bidding"]},
    send_document_for_signature: {areas: ["leads"]},
    send_email: {areas: ["inbox","leads","estimates"]},
    send_invoice: {areas: ["invoices"]},
    send_purchase_order: {areas: ["purchase_orders","vendors","subs","money"]},
    send_sms: {areas: ["comms"]},
    set_bid_invite_message: {areas: []},
    set_budget_lines: {areas: []},
    set_budget_parties: {areas: []},
    set_budget_settings: {areas: []},
    set_catalog_material_archived: {areas: []},
    set_change_order_costs: {areas: []},
    set_design_path: {areas: ["estimates"]},
    set_draw_schedule: {areas: ["invoices","estimates"]},
    set_funding_events: {areas: []},
    set_mood_board_settings: {areas: []},
    set_newsletter_welcome_issue: {areas: []},
    set_project_status_line: {areas: ["invoices","money"]},
    set_selections_budget: {areas: ["money"]},
    set_sub_archived: {areas: []},
    set_sub_assignment_active: {areas: []},
    set_sub_invoice_status: {areas: []},
    set_user_active: {areas: ["leads","subs","chat"]},
    set_vendor_archived: {areas: []},
    show_canvas: {areas: []},
    snooze_work_item: {areas: ["today"]},
    stage_allowance_overage: {areas: ["estimates","change_orders"]},
    stage_decision: {areas: [...CONTENT_AREAS]},
    stage_initial_invoice: {areas: ["invoices","estimates"]},
    stage_milestone_confirmation: {areas: ["invoices"]},
    stage_package_release: {areas: ["bidding","subs"]},
    stage_payment_decision: {areas: ["money","vendors","subs","purchase_orders","bidding"]},
    stage_plan_sheet: {areas: []},
    stage_purchase_decision: {areas: ["purchase_orders","bidding","vendors","subs","money"]},
    stage_scope_allocation_review: {areas: ["estimates","money"]},
    stage_supplier_pricing_request: {areas: ["vendors"]},
    stage_unsorted_document: {areas: ["money"]},
    stage_vendor_pricing_request: {areas: ["vendors"]},
    start_runbook: {areas: []},
    submit_draft_for_approval: {areas: ["leads","inbox"]},
    submit_schedule_for_approval: {areas: ["money"]},
    suggest_skill_for_work_item: {areas: ["engine"]},
    trash_file: {areas: []},
    update_bid_package: {areas: []},
    update_canvas: {areas: []},
    update_catalog_material: {areas: []},
    update_document_draft: {areas: ["leads","estimates","invoices","change_orders","money"]},
    update_estimate_line: {areas: ["estimates"]},
    update_mood_item: {areas: []},
    update_newsletter_issue: {areas: []},
    update_newsletter_recipient: {areas: ["newsletter"]},
    update_purchase_order: {areas: []},
    update_purchase_order_line: {areas: []},
    update_selection_item: {areas: []},
    update_sub_record: {areas: []},
    update_user_access: {areas: ["leads","subs","chat"]},
    update_vendor_record: {areas: []},
    update_work_item: {areas: []},
    update_work_item_status: {areas: []},
    view_project_image: {areas: [...CONTENT_AREAS]},
    void_commitment: {areas: []},
    void_invoice: {areas: ["invoices"]},
    wait_for_decision: {areas: [...CONTENT_AREAS]},
  },
});
