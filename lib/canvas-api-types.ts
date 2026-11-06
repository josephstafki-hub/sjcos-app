/** Canvas §5.5 wire contract. IDs are strings; timestamps are ISO8601. No source in metadata. */
export type CanvasKind = 'diagram' | 'page' | 'floor_plan';
export type Availability = {revision:string;master:boolean;diagrams:boolean;pages:boolean;floor:boolean;exports:boolean;staff:boolean;source:boolean};
export type CanvasAvailability = Availability;
export type CanvasMeta = {id:string;thread_id:string;user_id:string;created_run_id:string|null;kind:CanvasKind;project_slug:string|null;lead_slug:string|null;latest_version:number;created_at:string;updated_at:string};
export type VersionMeta = {version:number;title:string;summary:string;change_note:string;actor:{id:string;name:string};run_id:string|null;created_at:string;restored_from_version:number|null;design:null|{id:string;snapshot_id:string;number:number;rev:number}};
export type CanvasVersionMeta = VersionMeta;
export type CanvasCapabilities = {preview:boolean;code:boolean;download_formats:string[];save:boolean;restore:boolean;load_latest:boolean};
export type CanvasPreview = null|{mode:'diagram_renderer'|'static_page'|'floor';href:string|null;renderer_version:string};
export type CanvasErrorCode = 'CANVAS_DISABLED'|'AUTH_REQUIRED'|'CANVAS_UNAVAILABLE'|'CONTEXT_PROVENANCE_INCOMPLETE'|'RUN_CONTEXT_REQUIRED'|'INVALID_INPUT'|'UNSUPPORTED_KIND'|'UNSAFE_CONTENT'|'CONTENT_TOO_LARGE'|'TOO_COMPLEX'|'VERSION_CONFLICT'|'DESIGN_CHANGED'|'IDEMPOTENCY_CONFLICT'|'QUOTA_EXCEEDED'|'RENDER_FAILED'|'RENDER_TIMEOUT'|'EXPORT_NOT_READY'|'SAVE_POLICY_CHANGED'|'SAVE_POLICY_CONFLICT'|'FILE_RESTORE_CONFLICT'|'RENDERER_HASH_CONFLICT'|'SAVE_FAILED'|'INTERNAL_ERROR'|'ASK_PAUSED';
export type CanvasError = {ok:false;code:CanvasErrorCode;message:string;retryable:boolean;details?:Record<string,unknown>};
export type CanvasCodeResponse = {ok:true;canvas_id:string;version:number;kind:'diagram'|'page';code:string;sha256:string;untrusted:true;availability:Availability};
export type CanvasGetResponse = {ok:true;canvas:CanvasMeta;selected:VersionMeta;availability:Availability;capabilities:CanvasCapabilities;preview:CanvasPreview;code?:CanvasCodeResponse};
export type CanvasMutationResponse = {ok:true;canvas:CanvasMeta;selected:VersionMeta;changed:boolean;card:{canvas_id:string;run_id:string|null;version:number};href:string;availability:Availability};
export type CanvasListResponse = {ok:true;canvases:{canvas:CanvasMeta;latest:VersionMeta}[];next_cursor:string|null;availability:Availability};
export type CanvasVersionsResponse = {ok:true;versions:VersionMeta[];next_before:number|null;availability:Availability};
export type CanvasDeleteResponse = {ok:true;state:'pending'|'deleted'};
type EventBase = {id:string;thread_id:string;run_id:string|null;actor_user_id:string;at:string;group_id:string};
export type CanvasEvent = EventBase & (
 | {kind:'created'|'updated'|'restored'|'floor_latest';canvas_id:string;version:VersionMeta}
 | {kind:'saved';canvas_id:string;version:VersionMeta;file_id:string;project_name:string;effective_policy:Record<string,unknown>}
 | {kind:'deleted';canvas_id:string}
 | {kind:'rejected';canvas_id:null;reason:'too big'|'not supported'|'not allowed'}
 | {kind:'unavailable';canvas_id:string|null}
);
export type EventPage = {events:CanvasEvent[];cursor:string;next_before:string|null;has_more:boolean;availability:Availability};
export type CanvasEventPage = EventPage;
export type CanvasEventsResponse = {ok:true}&EventPage;
export type CanvasResponse<T> = T|CanvasError;
