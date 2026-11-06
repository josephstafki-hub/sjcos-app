/** Pure schema only. No populated tool registry, source-sensitivity inference or DB.
 * The coordinator must supply ALL content keys from PERMISSION_KEYS minus ai/projects
 * and explicitly classify every tool and result/scope variant (including data errors).
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

// Explicit conservative coverage: broad business tools can return incidental data
// from multiple areas. Full catalog is deliberate until a narrower result contract
// is audited. Actor permissions NEVER classify a result.
export const CONTENT_AREAS=Object.freeze(["today", "inbox", "comms", "chat", "leads", "subs", "vendors", "site", "newsletter", "catalog", "compliance", "warranty", "marketing", "engine", "estimates", "invoices", "purchase_orders", "change_orders", "bidding", "cost_book", "money"]);
const registeredToolNames=[
"set_sub_archived", "set_vendor_archived", "set_catalog_material_archived", "update_sub_record", "update_vendor_record",
  "add_bid_invites",
  "add_estimate_lines",
  "add_expense",
  "add_mood_image_from_url",
  "add_mood_swatch",
  "add_mood_text",
  "add_newsletter_recipient",
  "add_plan_comment",
  "add_purchase_order_line",
  "add_selection_option",
  "adjust_internal_schedule",
  "adopt_estimate_as_budget",
  "allocate_scope",
  "append_project_upload",
  "append_unsorted_upload",
  "apply_client_direction_approval",
  "apply_client_product",
  "apply_design_feedback",
  "apply_owner_pricing",
  "apply_plan_ops",
  "apply_selection_choice",
  "apply_snag_decision",
  "arrange_mood_board",
  "ask_owner",
  "assign_cost",
  "assign_work_item",
  "attach_bid_file",
  "award_bid",
  "build_selection_plan",
  "business_snapshot",
  "candidate_suppliers",
  "capability_report",
  "capture_knowledge",
  "check_owner_permission",
  "choose_supplier_quote",
  "close_bid_package",
  "closeout_checklists",
  "closeout_step",
  "commit_on_approval",
  "commit_project_upload",
  "commit_unsorted_upload",
  "company_financials",
  "compare_bids",
  "compare_competing_quotes",
  "compile_weekly_sub_report",
  "complete_work_item_with_evidence",
  "confirm_schedule",
  "cost_learning_preview",
  "create_bid_package",
  "create_document_draft",
  "create_estimate",
  "create_invoice_draft",
  "create_mood_board",
  "create_newsletter_issue",
  "create_plan_design",
  "create_project",
  "create_project_upload",
  "create_purchase_order",
  "create_selection_item",
  "create_selection_section",
  "create_skill_proposal",
  "create_unsorted_upload",
  "create_user",
  "create_work_item",
  "delete_estimate_lines",
  "delete_expense",
  "delete_project_file",
  "delete_purchase_order_line",
  "describe_plan_design",
  "draw_schedule",
  "duplicate_plan_design",
  "enqueue_agent_trigger",
  "enrich_work_item",
  "estimate_readiness",
  "execute_approved_payment",
  "fetch",
  "fetch_knowledge",
  "file_email_document",
  "file_unsorted_document",
  "final_reconciliation",
  "freeze_offered_prices",
  "get_bid_package",
  "get_bill",
  "get_call",
  "get_canvas",
  "get_decision",
  "get_document_draft",
  "get_field_evidence",
  "get_instruction_versions",
  "get_lead",
  "get_lead_qualification",
  "get_newsletter_issue",
  "get_obligation",
  "get_operating_context",
  "get_plan_design",
  "get_plan_measures",
  "get_project",
  "get_project_file",
  "get_project_financials",
  "get_project_funding",
  "get_project_selections",
  "get_project_workflow",
  "get_purchase_order",
  "get_runbook",
  "get_runbook_instance",
  "get_scope_register",
  "get_skill",
  "get_sms_thread",
  "get_standing_instructions",
  "get_today_queue",
  "get_work_item",
  "import_client_newsletter_recipients",
  "import_lead",
  "incorporate_quote",
  "incorporate_sub_bid",
  "invoice_balances",
  "invoice_collision_report",
  "invoice_payment_history",
  "link_cost_to_po",
  "list_access_areas",
  "list_agent_activity",
  "list_agent_memories",
  "list_bid_packages",
  "list_calls",
  "list_canvases",
  "list_catalog_materials",
  "list_commitments",
  "list_compliance",
  "list_deleted_files",
  "list_doc_templates",
  "list_document_drafts",
  "list_leads",
  "list_mood_boards",
  "list_newsletter_groups",
  "list_newsletter_issues",
  "list_newsletter_outbox",
  "list_newsletter_recipients",
  "list_newsletter_sequences",
  "list_obligations",
  "list_operating_docs",
  "list_owner_permissions",
  "list_pending_decisions",
  "list_plan_designs",
  "list_plan_finishes",
  "list_plan_library",
  "list_plan_versions",
  "list_project_estimates",
  "list_project_files",
  "list_projects",
  "list_purchase_orders",
  "list_recent_knowledge",
  "list_runbook_instances",
  "list_runbooks",
  "list_schedule_plans",
  "list_signature_requests",
  "list_skills",
  "list_sms_threads",
  "list_subs",
  "list_unsorted_documents",
  "list_users",
  "list_vendors",
  "list_work_items",
  "mark_bid_working",
  "measurement_summary",
  "overhead_summary",
  "place_call",
  "plan_buyout",
  "prepare_estimate_inputs",
  "prepare_tentative_schedule",
  "preview_lead_followups",
  "pricing_setup",
  "procedure_checks",
  "queue_newsletter_issue",
  "queue_purchase_order",
  "read_chat_attachment",
  "read_operating_doc",
  "receive_bill",
  "record_acknowledgement",
  "record_agent_execution",
  "record_agent_run",
  "record_bid",
  "record_completion_report",
  "record_delivery",
  "record_field_progress",
  "record_manual_payment",
  "record_manual_payment_confirmation",
  "record_quote",
  "record_receipt",
  "record_site_findings",
  "record_skill_used",
  "record_sub_invoice",
  "record_supplier_evidence",
  "record_workflow_event",
  "release_newsletter_issue",
  "release_newsletter_outbox_item",
  "remember_agent_instruction",
  "remove_bid_file",
  "remove_bid_invite",
  "remove_newsletter_recipient",
  "render_document_draft",
  "reply_on_unsorted_document",
  "reply_to_owner",
  "report_snag",
  "request_company_funding",
  "request_owner_permission",
  "research_price",
  "reset_user_password",
  "restore_file",
  "restore_project_file",
  "restore_work_item",
  "reverse_manual_payment",
  "review_delivery",
  "run_plan_checks",
  "runbook_repair_preview",
  "save_lead_rough_estimate",
  "save_plan_version",
  "save_project_file",
  "search",
  "search_knowledge",
  "search_operating_docs",
  "search_skills",
  "select_bid_for_estimate",
  "send_bid_package",
  "send_document_for_signature",
  "send_email",
  "send_invoice",
  "send_purchase_order",
  "send_sms",
  "set_bid_invite_message",
  "set_budget_lines",
  "set_budget_parties",
  "set_budget_settings",
  "set_change_order_costs",
  "set_design_path",
  "set_draw_schedule",
  "set_funding_events",
  "set_mood_board_settings",
  "set_newsletter_welcome_issue",
  "set_project_status_line",
  "set_selections_budget",
  "set_sub_assignment_active",
  "set_sub_invoice_status",
  "set_user_active",
  "show_canvas",
  "snooze_work_item",
  "stage_allowance_overage",
  "stage_decision",
  "stage_initial_invoice",
  "stage_milestone_confirmation",
  "stage_package_release",
  "stage_payment_decision",
  "stage_plan_sheet",
  "stage_purchase_decision",
  "stage_scope_allocation_review",
  "stage_supplier_pricing_request",
  "stage_unsorted_document",
  "stage_vendor_pricing_request",
  "start_runbook",
  "submit_draft_for_approval",
  "submit_schedule_for_approval",
  "suggest_skill_for_work_item",
  "trash_file",
  "update_bid_package",
  "update_canvas",
  "update_catalog_material",
  "update_document_draft",
  "update_estimate_line",
  "update_mood_item",
  "update_newsletter_issue",
  "update_newsletter_recipient",
  "update_purchase_order",
  "update_purchase_order_line",
  "update_selection_item",
  "update_user_access",
  "update_work_item",
  "update_work_item_status",
  "view_project_image",
  "void_commitment",
  "void_invoice",
  "wait_for_decision"
];
export const CLASSIFICATION_REGISTRY=validateClassificationRegistry({version:1,content_areas:CONTENT_AREAS,tools:Object.fromEntries(registeredToolNames.map(name=>[name,{areas:["show_canvas","update_canvas","get_canvas","list_canvases","ask_owner","list_operating_docs","search_operating_docs","read_operating_doc","read_chat_attachment"].includes(name)?[]:[...CONTENT_AREAS]}]))});
