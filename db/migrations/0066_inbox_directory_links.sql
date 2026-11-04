-- The existing owner-side link action can link a message to a sub/vendor as well
-- as a job/lead. No new table, login, or grants: narrow logins remain read-only.
ALTER TABLE thread_links DROP CONSTRAINT IF EXISTS thread_links_link_type_check;
ALTER TABLE thread_links ADD CONSTRAINT thread_links_link_type_check
  CHECK (link_type IN ('project','lead','sub','vendor'));
