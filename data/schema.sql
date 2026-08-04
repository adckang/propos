-- PROPOS 이벤트 저장소 스키마
-- 적용: npx vercel env pull .env.local && node scripts/apply-schema.mjs

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   TEXT        NOT NULL,
  type          TEXT        NOT NULL,
  is_soft       BOOLEAN     NOT NULL DEFAULT false,
  device_time   TIMESTAMPTZ NOT NULL,
  server_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data          JSONB,
  blob_url      TEXT,
  notified_at   TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'complete', 'failed')),
  UNIQUE (property_id, type, device_time)
);

CREATE INDEX IF NOT EXISTS idx_events_property_time
  ON events (property_id, device_time DESC);

CREATE INDEX IF NOT EXISTS idx_events_type_time
  ON events (type, device_time DESC);

CREATE INDEX IF NOT EXISTS idx_events_pending
  ON events (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS monthly_summaries (
  property_id        TEXT  NOT NULL,
  month              DATE  NOT NULL,  -- 항상 해당 달 1일
  check_ins          INT   NOT NULL DEFAULT 0,
  check_outs         INT   NOT NULL DEFAULT 0,
  anomaly_count      INT   NOT NULL DEFAULT 0,
  energy_waste_count INT   NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, month)
);
