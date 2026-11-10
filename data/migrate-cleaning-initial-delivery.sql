-- File only: applying this migration to a service DB requires separate approval.
-- Existing rows remain NULL/legacy and are never queued for automatic replay.
BEGIN;
ALTER TABLE cleaning_notifs
  ADD COLUMN IF NOT EXISTS initial_delivery_state TEXT,
  ADD COLUMN IF NOT EXISTS initial_delivery_data JSONB,
  ADD COLUMN IF NOT EXISTS initial_accepted_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='cleaning_notifs'::regclass AND conname='cleaning_notifs_initial_delivery_check') THEN
    ALTER TABLE cleaning_notifs ADD CONSTRAINT cleaning_notifs_initial_delivery_check CHECK (
      (initial_delivery_state IS NULL AND initial_delivery_data IS NULL AND initial_accepted_at IS NULL)
      OR (initial_delivery_state IS NOT NULL
        AND initial_delivery_state IN ('READY','SENDING','ACCEPTED','RETRYABLE','UNKNOWN','FAILED','CANCELLED')
        AND initial_delivery_data IS NOT NULL AND jsonb_typeof(initial_delivery_data)='object'
        AND COALESCE(initial_delivery_data->>'kind','')='INITIAL_REQUEST'
        AND initial_delivery_data ?& ARRAY['kind','payload','cleaner','expectedStatus','nextStatus','attempts','propertyId','checkoutAt','cleaningStartAt']
        AND COALESCE(initial_delivery_data->>'propertyId','')<>''
        AND (initial_delivery_data->>'checkoutAt')::timestamptz IS NOT NULL
        AND (initial_delivery_data->>'cleaningStartAt')::timestamptz IS NOT NULL
        AND jsonb_typeof(initial_delivery_data->'payload')='object'
        AND jsonb_typeof(initial_delivery_data->'cleaner')='object'
        AND jsonb_typeof(initial_delivery_data->'attempts')='number'
        AND (initial_delivery_data->>'attempts')::integer>=0
        AND initial_delivery_data->'cleaner' ? 'id'
        AND (initial_delivery_data->'cleaner'->>'id')::uuid IS NOT DISTINCT FROM cleaner_id
        AND CASE WHEN initial_delivery_state='SENDING' THEN
          (initial_delivery_data->>'attemptId')::uuid IS NOT NULL
          AND (initial_delivery_data->>'attemptedAt')::timestamptz IS NOT NULL ELSE true END
        AND CASE WHEN initial_delivery_state='RETRYABLE' THEN
          (initial_delivery_data->>'nextAttemptAt')::timestamptz IS NOT NULL ELSE true END
        AND ((initial_delivery_state='ACCEPTED') = (initial_accepted_at IS NOT NULL)))
    );
  END IF;
END $$;
COMMIT;
