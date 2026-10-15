-- 운영자 계정과 숙소 권한 (D-034)
-- 슈퍼관리자는 DB 계정이 아니라 환경변수 로그인(PROPOS_ADMIN_PASSWORD)이다 — DB 가 고장 나도 갇히지 않고 전체를 본다.
-- 운영자(일반)는 이 테이블의 계정이고, operator_properties 에 배정된 숙소만 본다. 배정이 없으면 아무것도 안 보인다(기본 거부).
-- 재실행 안전.

CREATE TABLE IF NOT EXISTS operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,                 -- scrypt$<salt>$<hash> (평문 저장 금지)
  active        BOOLEAN NOT NULL DEFAULT true, -- false 면 로그인·기존 세션 모두 즉시 거절
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT operators_email_lower CHECK (email = lower(email)),
  CONSTRAINT operators_email_unique UNIQUE (email)
);

-- 운영자 ↔ 숙소 연결 테이블 (N:M). 숙소 이름 변경(D-016)을 따라가고, 숙소·계정이 지워지면 권한도 같이 지워진다.
CREATE TABLE IF NOT EXISTS operator_properties (
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (operator_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_operator_properties_property ON operator_properties(property_id);
