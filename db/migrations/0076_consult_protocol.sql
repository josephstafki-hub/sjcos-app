-- Website owner transaction service only. No new raw narrow privileges.
CREATE TABLE consult_batches (
 consult_id uuid NOT NULL REFERENCES consults(id), nonce text NOT NULL,
 actor uuid NOT NULL REFERENCES users(id), request_hash text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(consult_id,nonce)
);
CREATE TABLE consult_sync_receipts (
 consult_id uuid NOT NULL REFERENCES consults(id), device_id uuid NOT NULL, epoch bigint NOT NULL,
 event_id uuid NOT NULL, seq bigint NOT NULL CHECK(seq>0), hash text NOT NULL,
 result jsonb NOT NULL, PRIMARY KEY(consult_id,event_id), UNIQUE(consult_id,device_id,epoch,seq),
 FOREIGN KEY(consult_id,device_id,epoch) REFERENCES consult_devices(consult_id,device_id,epoch)
);
CREATE TABLE consult_close_evidence (
 consult_id uuid PRIMARY KEY REFERENCES consults(id), evidence jsonb NOT NULL,
 actor uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER consult_batches_immutable BEFORE UPDATE OR DELETE ON consult_batches FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
CREATE TRIGGER consult_sync_receipts_immutable BEFORE UPDATE OR DELETE ON consult_sync_receipts FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
REVOKE ALL ON consult_batches,consult_sync_receipts,consult_close_evidence FROM PUBLIC;
-- node scripts/db-roles-sql.mjs consult_batches consult_sync_receipts consult_close_evidence
-- Output: empty (all narrow grants intentionally withheld).

-- Protected evidence identity and relational membership. Website commands are owner
-- transactions; narrow users have no raw DML and cannot execute person commands.
CREATE FUNCTION consult_answer_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM consult_instances i JOIN consult_form_pins p ON p.consult_id=i.consult_id AND p.kind='module' AND p.key=i.module_key
 JOIN consult_form_versions v ON v.id=p.form_id, jsonb_array_elements(v.definition->'fields') f
 WHERE i.id=NEW.instance_id AND i.consult_id=NEW.consult_id AND i.removed_at IS NULL AND f->>'key'=NEW.field_key) THEN RAISE EXCEPTION 'unknown pinned field'; END IF;
 IF NOT EXISTS(SELECT 1 FROM consult_events e WHERE e.consult_id=NEW.consult_id AND e.event_id=NEW.event_id AND e.actor=NEW.actor
 AND e.generation=NEW.generation AND e.server_revision=NEW.server_revision) THEN RAISE EXCEPTION 'answer event mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consult_answer_membership BEFORE INSERT ON consult_answers FOR EACH ROW EXECUTE FUNCTION consult_answer_membership();
REVOKE ALL ON FUNCTION consult_answer_membership() FROM PUBLIC;
-- A single executable validator: typed Zod/condition/formula publication validation
-- writes a checksum-bound attestation in the SAME owner transaction. SQL refuses
-- publication without it. This avoids two drifting TS/PLpgSQL schema interpreters.
CREATE TABLE consult_mapping_registries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL UNIQUE CHECK(version>0),
 mappings jsonb NOT NULL CHECK(jsonb_typeof(mappings)='object'), author uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consult_publication_validations (
 form_id uuid PRIMARY KEY REFERENCES consult_form_versions(id), checksum text NOT NULL,
 registry_id uuid NOT NULL REFERENCES consult_mapping_registries(id), validator_version integer NOT NULL CHECK(validator_version=1),
 validated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER consult_registry_immutable BEFORE UPDATE OR DELETE ON consult_mapping_registries FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
CREATE TRIGGER consult_validation_immutable BEFORE UPDATE OR DELETE ON consult_publication_validations FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
REVOKE ALL ON consult_mapping_registries,consult_publication_validations FROM PUBLIC;
CREATE OR REPLACE FUNCTION consult_validate_definition(definition jsonb, kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM consult_publication_validations a JOIN consult_form_versions f ON f.id=a.form_id
 WHERE f.kind=consult_validate_definition.kind AND f.definition=consult_validate_definition.definition
 AND f.checksum=a.checksum AND a.validator_version=1) THEN RAISE EXCEPTION 'typed publication validation required'; END IF;
END $$;
-- node scripts/db-roles-sql.mjs consult_mapping_registries consult_publication_validations
-- Output: empty (owner publication service only).
