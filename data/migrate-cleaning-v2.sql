-- PROPOS 청소 자동화 스키마 마이그레이션 v2
-- 실행: POSTGRES_URL 환경변수 설정 후 psql $POSTGRES_URL -f data/migrate-cleaning-v2.sql

-- cleaning_notifs: 알림 채널 기록 컬럼 추가
ALTER TABLE cleaning_notifs
  ADD COLUMN IF NOT EXISTS channel TEXT
    CHECK (channel IS NULL OR channel IN ('FCM', 'SMS', 'SMS_FALLBACK'));

-- cleaning_jobs: 구글 블로커 이벤트 ID 컬럼 추가 (블로커 삭제 시 필요)
ALTER TABLE cleaning_jobs
  ADD COLUMN IF NOT EXISTS google_blocker_event_id TEXT;

-- cleaning_jobs: 구글 예약 이벤트 ID (Calendar Webhook에서 cleaner가 예약한 이벤트 ID)
ALTER TABLE cleaning_jobs
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- cleaning_jobs: CANCELLED 상태 추가 (CHECK 제약 재설정)
ALTER TABLE cleaning_jobs DROP CONSTRAINT IF EXISTS cleaning_jobs_status_check;
ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_status_check
  CHECK (status IN (
    'PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3',
    'NOTIFYING_BULK','BULK_REMINDED','ESCALATED','ASSIGNED','COMPLETED','CANCELLED'
  ));

-- cleaners: Worker App 관련 컬럼 (이미 있으면 무시)
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS fcm_token       TEXT,
  ADD COLUMN IF NOT EXISTS fcm_token_at    TIMESTAMPTZ,
  -- 비워 둘 수 있다(운영 DB와 같게, RF-50)
  ADD COLUMN IF NOT EXISTS fcm_status      TEXT DEFAULT 'uninstalled'
    CHECK (fcm_status IS NULL OR fcm_status IN ('uninstalled','active','inactive','invalid','unregistered')),
  ADD COLUMN IF NOT EXISTS app_installed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ;

-- 운영 DB에 있는 앱 상태 조회용 색인(scripts/migrate-workers.js가 만든 것과 같게, RF-50)
CREATE INDEX IF NOT EXISTS idx_cleaners_fcm_status ON cleaners(fcm_status);
CREATE INDEX IF NOT EXISTS idx_cleaners_last_seen ON cleaners(last_seen_at);

-- property_cleaning_config: host_phone + ical_url 컬럼
ALTER TABLE property_cleaning_config
  ADD COLUMN IF NOT EXISTS host_phone TEXT;

ALTER TABLE property_cleaning_config
  ADD COLUMN IF NOT EXISTS ical_url TEXT;

-- 캘린더 블로커 이벤트 ID 저장 테이블
CREATE TABLE IF NOT EXISTS property_calendar_blockers (
  property_id TEXT    NOT NULL,
  block_date  DATE    NOT NULL,
  event_id    TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, block_date)
);
