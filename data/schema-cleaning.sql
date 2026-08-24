-- PROPOS 청소 자동화 스키마
-- 적용: node scripts/migrate-cleaning.mjs

-- 숙소별 청소 설정 (google_calendar_id, booking_url 포함)
CREATE TABLE IF NOT EXISTS property_cleaning_config (
  property_id                TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  checkout_hour              INT  NOT NULL DEFAULT 11,
  cleaning_duration_hours    FLOAT NOT NULL DEFAULT 2.5,
  google_calendar_id         TEXT,
  google_calendar_booking_url TEXT,
  host_phone                 TEXT,
  ical_url                   TEXT,            -- Airbnb iCal 폴링 URL (백엔드 전용, git 비공개)
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 청소자 목록
CREATE TABLE IF NOT EXISTS cleaners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  tier       TEXT NOT NULL
               CHECK (tier IN ('VIP_1','VIP_2','VIP_3','BULK')),
  active     BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 청소 일정
CREATE TABLE IF NOT EXISTS cleaning_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         TEXT NOT NULL,
  reservation_uid     TEXT,
  checkout_at         TIMESTAMPTZ NOT NULL,
  cleaning_start_at   TIMESTAMPTZ NOT NULL,
  cleaning_end_at     TIMESTAMPTZ,
  dispatch_after      TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 발송 가능 시각 (월간 배치 분산용)
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN (
                          'PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3',
                          'NOTIFYING_BULK','BULK_REMINDED','ESCALATED','ASSIGNED','COMPLETED','CANCELLED'
                        )),
  assigned_cleaner_id UUID REFERENCES cleaners(id),
  google_event_id          TEXT,
  google_blocker_event_id  TEXT,
  source              TEXT NOT NULL
                        CHECK (source IN ('MONTHLY_BATCH','SHORT_NOTICE')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, checkout_at)
);

-- 알림 발송 내역
CREATE TABLE IF NOT EXISTS cleaning_notifs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES cleaning_jobs(id) ON DELETE CASCADE,
  cleaner_id   UUID NOT NULL REFERENCES cleaners(id),
  tier         TEXT NOT NULL,
  token        CHAR(6) NOT NULL UNIQUE,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reminded_at  TIMESTAMPTZ,
  response     TEXT CHECK (response IS NULL OR response IN ('DECLINED','DECLINED_AFTER_ASSIGNED')),
  response_at  TIMESTAMPTZ,
  channel      TEXT CHECK (channel IS NULL OR channel IN ('FCM','SMS','SMS_FALLBACK')),
  UNIQUE (job_id, cleaner_id)
);

-- 캘린더 블로커 이벤트 ID 저장 (월간 배치 → 블로커 삭제 시 사용)
CREATE TABLE IF NOT EXISTS property_calendar_blockers (
  property_id TEXT    NOT NULL,
  block_date  DATE    NOT NULL,
  event_id    TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, block_date)
);

CREATE INDEX IF NOT EXISTS idx_cleaning_jobs_status   ON cleaning_jobs(status);
CREATE INDEX IF NOT EXISTS idx_cleaning_jobs_checkout ON cleaning_jobs(checkout_at);
CREATE INDEX IF NOT EXISTS idx_cleaning_notifs_token  ON cleaning_notifs(token);
CREATE INDEX IF NOT EXISTS idx_cleaning_notifs_job    ON cleaning_notifs(job_id);
