-- Narrow-login grants for the directory and sub-assignment tools added by the
-- full-app design pass (mcp/directory-tools.mjs, lib/directory-maintenance.ts,
-- lib/sub-assignment-maintenance.ts): archive / restore subs, vendors and
-- catalog items, and remove / restore a sub's job assignment (its chat-room
-- membership and queued portal invite go with it, and come back on restore).
-- Mirrors deploy/db-roles.manifest.json; sjcos_grant (0060) is a no-op with a
-- NOTICE while a login does not exist.
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'catalog_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'catalog_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'catalog_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'subs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'subs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'subs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'vendors');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'vendors');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'vendors');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, DELETE', 'chat_members');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_members');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_members');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'project_subs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_subs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_subs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'sub_portal_invites');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sub_portal_invites');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_portal_invites');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'sub_assignment_trash');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sub_assignment_trash');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_assignment_trash');
