-- 0111 — One text conversation per (person, our number), finishing 0110.
--
-- 0110 added the (phone, business_number) key the phone-lines code uses but
-- kept the old phone-only key, because the build running before the restart
-- still upserts ON CONFLICT (phone). Apply this AFTER the phone-lines build is
-- live (it no longer uses that key). Until it is applied, Settings › Phone lines
-- refuses to add a second number (lib/actions/phone-lines.ts), since a second
-- line's first text to an existing contact would trip the old key.

ALTER TABLE sms_threads DROP CONSTRAINT IF EXISTS sms_threads_phone_key;
