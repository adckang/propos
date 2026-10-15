-- 숙소별 데이터 출처와 원본 추적성 보강
--
-- 목적:
--   REAL(파주201)과 SIMULATED(가상 숙소)를 환경별로 나누지 않고 같은 스키마에 저장한다.
--   모든 예약·청소 작업·이벤트는 property_id로 숙소와 연결되고, 행 자체에도 당시 출처를 남긴다.
--
-- 실행 전제: 기존 스키마(schema.sql, schema-cleaning.sql)가 먼저 적용되어 있어야 한다.
-- 이 파일은 테이블/컬럼/제약만 추가하며, 운영 데이터 행을 삭제하거나 상태를 변경하지 않는다.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE property_cleaning_config
  ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS source_ref TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE property_cleaning_config
   SET data_origin = COALESCE(NULLIF(data_origin, ''), 'REAL'),
       source_system = COALESCE(NULLIF(source_system, ''), CASE WHEN ical_url IS NOT NULL THEN 'AIRBNB_ICAL' ELSE 'MANUAL' END),
       source_updated_at = COALESCE(source_updated_at, updated_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_cleaning_config_data_origin_check') THEN
    ALTER TABLE property_cleaning_config
      ADD CONSTRAINT property_cleaning_config_data_origin_check
      CHECK (data_origin IN ('REAL', 'SIMULATED'));
  END IF;
END $$;

-- Airbnb/iCal 예약 원본의 정규 저장소. 실데이터와 시뮬레이션 데이터가 같은 계약을 사용한다.
CREATE TABLE IF NOT EXISTS property_reservations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      TEXT NOT NULL,
  reservation_uid  TEXT NOT NULL,
  guest_name       TEXT,
  platform         TEXT NOT NULL DEFAULT 'Airbnb',
  check_in         TIMESTAMPTZ NOT NULL,
  check_out        TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'CANCELLED', 'BLOCKED')),
  source_system    TEXT NOT NULL,
  source_ref       TEXT,
  raw_data         JSONB,
  data_origin      TEXT NOT NULL DEFAULT 'REAL'
                   CHECK (data_origin IN ('REAL', 'SIMULATED')),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, reservation_uid),
  CHECK (check_out > check_in)
);

ALTER TABLE cleaning_jobs
  ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

ALTER TABLE cleaning_notifs
  ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'REAL';

ALTER TABLE property_calendar_blockers
  ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'REAL';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'HA_WATCHER',
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

UPDATE cleaning_jobs j
   SET data_origin = COALESCE(p.data_origin, 'REAL')
  FROM property_cleaning_config p
 WHERE p.property_id = j.property_id;

UPDATE property_calendar_blockers b
   SET data_origin = COALESCE(p.data_origin, 'REAL')
  FROM property_cleaning_config p
 WHERE p.property_id = b.property_id;

UPDATE events e
   SET data_origin = COALESCE(p.data_origin, 'REAL')
  FROM property_cleaning_config p
 WHERE p.property_id = e.property_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaning_jobs_data_origin_check') THEN
    ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_data_origin_check
      CHECK (data_origin IN ('REAL', 'SIMULATED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaning_notifs_data_origin_check') THEN
    ALTER TABLE cleaning_notifs ADD CONSTRAINT cleaning_notifs_data_origin_check
      CHECK (data_origin IN ('REAL', 'SIMULATED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_calendar_blockers_data_origin_check') THEN
    ALTER TABLE property_calendar_blockers ADD CONSTRAINT property_calendar_blockers_data_origin_check
      CHECK (data_origin IN ('REAL', 'SIMULATED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_data_origin_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_data_origin_check
      CHECK (data_origin IN ('REAL', 'SIMULATED'));
  END IF;
END $$;

-- 기존 행은 보존하고, 새 행부터 숙소 존재를 DB가 보장한다. NOT VALID은 과거 레거시 행을
-- 즉시 삭제하지 않으면서 신규 입력의 무결성을 보장하기 위한 선택이다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_reservations_property_fk') THEN
    ALTER TABLE property_reservations ADD CONSTRAINT property_reservations_property_fk
      FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaning_jobs_property_fk') THEN
    ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_property_fk
      FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaning_jobs_reservation_fk') THEN
    ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_reservation_fk
      FOREIGN KEY (property_id, reservation_uid)
      REFERENCES property_reservations(property_id, reservation_uid) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_calendar_blockers_property_fk') THEN
    ALTER TABLE property_calendar_blockers ADD CONSTRAINT property_calendar_blockers_property_fk
      FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_property_fk') THEN
    ALTER TABLE events ADD CONSTRAINT events_property_fk
      FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_properties_data_origin
  ON property_cleaning_config (data_origin, name);
CREATE INDEX IF NOT EXISTS idx_reservations_property_checkout
  ON property_reservations (property_id, check_out);
CREATE INDEX IF NOT EXISTS idx_reservations_origin
  ON property_reservations (data_origin, check_out);
CREATE INDEX IF NOT EXISTS idx_cleaning_jobs_origin_checkout
  ON cleaning_jobs (data_origin, checkout_at);
CREATE INDEX IF NOT EXISTS idx_events_origin_time
  ON events (data_origin, device_time DESC);

-- 현재 운영 DB의 명시적인 테스트 숙소는 SIMULATED로 분류한다.
-- 파주201만 외부 Airbnb/Google 원본을 사용하는 REAL 숙소로 유지한다.
UPDATE property_cleaning_config
   SET data_origin = 'SIMULATED',
       source_system = COALESCE(NULLIF(source_system, 'MANUAL'), 'SIMULATED_FIXTURE'),
       source_updated_at = COALESCE(source_updated_at, NOW()),
       updated_at = NOW()
 WHERE property_id = 'PROP_TEST_001'
   AND ical_url IS NULL;

UPDATE cleaning_jobs j
   SET data_origin = p.data_origin,
       updated_at = NOW()
  FROM property_cleaning_config p
 WHERE p.property_id = j.property_id
   AND p.data_origin = 'SIMULATED'
   AND j.data_origin <> 'SIMULATED';

-- 레거시 운영 DB에는 CANCELLED가 빠진 상태 제약이 남아 있을 수 있다.
-- 코드·신규 스키마와 동일한 청소 일정 상태 계약으로 확장한다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaning_jobs_status_check') THEN
    ALTER TABLE cleaning_jobs DROP CONSTRAINT cleaning_jobs_status_check;
  END IF;
  ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_status_check
    CHECK (status IN (
      'PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3',
      'NOTIFYING_BULK','BULK_REMINDED','ESCALATED','ASSIGNED','COMPLETED','CANCELLED'
    )) NOT VALID;
END $$;
