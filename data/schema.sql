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
  source_system TEXT        NOT NULL DEFAULT 'HA_WATCHER',
  source_ref    TEXT,
  data_origin   TEXT        NOT NULL DEFAULT 'REAL'
                            CHECK (data_origin IN ('REAL','SIMULATED')),
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'complete', 'failed')),
  UNIQUE (property_id, type, device_time)
);

-- 이벤트도 등록된 숙소에만(운영 DB와 같은 이름 events_property_fk, RF-36). 숙소 표는 schema-cleaning.sql 에 있어
-- 두 파일 중 어느 쪽을 먼저 적용해도 붙도록 양쪽에 같은 조건부 문장을 둔다 — 둘 다 있고 연결이 아직 없을 때만.
-- 운영 DB에는 이미 있어 아무것도 하지 않는다.
DO $$
BEGIN
  IF to_regclass('events') IS NOT NULL AND to_regclass('property_cleaning_config') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_property_fk') THEN
    ALTER TABLE events ADD CONSTRAINT events_property_fk
      FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_property_time
  ON events (property_id, device_time DESC);

CREATE INDEX IF NOT EXISTS idx_events_type_time
  ON events (type, device_time DESC);

CREATE INDEX IF NOT EXISTS idx_events_pending
  ON events (status) WHERE status = 'pending';
