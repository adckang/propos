-- RF-25 자동화 개선율: 정책, 내부 숙박/청소 의무, 이상 본체/이력 저장소.
--
-- 이 단계는 확장 마이그레이션이다. 기존 예약·청소 작업은 보존하고 새 참조 열은
-- nullable로 둔다. 새 코드가 모든 신규 행에 내부 ID를 기록하는 것을 확인한 뒤 별도
-- 마이그레이션에서 NOT NULL로 좁힌다. 과거 이상·해결 이력은 추정해서 만들지 않는다.

-- 버전 있는 마스터/숙소별 안정화 정책. 숙소 버전은 일부 유형만 재정의할 수 있다.
CREATE TABLE IF NOT EXISTS automation_policy_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          TEXT NOT NULL CHECK (scope IN ('MASTER','PROPERTY')),
  property_id    TEXT REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE ON DELETE CASCADE,
  effective_from TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope='MASTER' AND property_id IS NULL) OR (scope='PROPERTY' AND property_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS automation_policy_master_effective_unique
  ON automation_policy_versions(effective_from) WHERE scope='MASTER';
CREATE UNIQUE INDEX IF NOT EXISTS automation_policy_property_effective_unique
  ON automation_policy_versions(property_id,effective_from) WHERE scope='PROPERTY';

CREATE TABLE IF NOT EXISTS automation_policy_values (
  policy_version_id     UUID NOT NULL REFERENCES automation_policy_versions(id) ON DELETE CASCADE,
  anomaly_type          TEXT NOT NULL CHECK (anomaly_type IN (
                          'noise','vacant_energy_waste','guest_complaint_sensor',
                          'cleaning_unassigned','device_offline'
                        )),
  stabilization_minutes INT NOT NULL CHECK (stabilization_minutes >= 0),
  PRIMARY KEY (policy_version_id, anomaly_type)
);

-- DEC-21 마스터 초기값. 고정 ID라 마이그레이션을 다시 실행해도 새 버전이 생기지 않는다.
INSERT INTO automation_policy_versions(id,scope,property_id,effective_from)
VALUES ('25000000-0000-4000-8000-000000000001','MASTER',NULL,'2026-11-24T00:00:00+09:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO automation_policy_values(policy_version_id,anomaly_type,stabilization_minutes) VALUES
  ('25000000-0000-4000-8000-000000000001','noise',5),
  ('25000000-0000-4000-8000-000000000001','vacant_energy_waste',5),
  ('25000000-0000-4000-8000-000000000001','guest_complaint_sensor',10),
  ('25000000-0000-4000-8000-000000000001','cleaning_unassigned',0),
  ('25000000-0000-4000-8000-000000000001','device_offline',5)
ON CONFLICT (policy_version_id,anomaly_type) DO NOTHING;

-- 외부 예약 UID와 분리된 PROPOS 내부 숙박.
CREATE TABLE IF NOT EXISTS property_stays (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       TEXT NOT NULL REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE,
  initial_check_in  TIMESTAMPTZ NOT NULL,
  initial_check_out TIMESTAMPTZ NOT NULL,
  data_origin       TEXT NOT NULL CHECK (data_origin IN ('REAL','SIMULATED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id,id),
  UNIQUE (property_id,initial_check_in,initial_check_out),
  CHECK (initial_check_out > initial_check_in)
);

ALTER TABLE property_reservations ADD COLUMN IF NOT EXISTS stay_id UUID;

INSERT INTO property_stays(property_id,initial_check_in,initial_check_out,data_origin,created_at)
SELECT property_id,check_in,check_out,
       CASE WHEN BOOL_OR(data_origin='REAL') THEN 'REAL' ELSE 'SIMULATED' END,
       MIN(created_at)
  FROM property_reservations
 GROUP BY property_id,check_in,check_out
ON CONFLICT (property_id,initial_check_in,initial_check_out) DO NOTHING;

UPDATE property_reservations r
   SET stay_id=s.id
  FROM property_stays s
 WHERE r.stay_id IS NULL
   AND s.property_id=r.property_id
   AND s.initial_check_in=r.check_in
   AND s.initial_check_out=r.check_out;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='property_reservations_stay_fk') THEN
    ALTER TABLE property_reservations ADD CONSTRAINT property_reservations_stay_fk
      FOREIGN KEY (property_id,stay_id) REFERENCES property_stays(property_id,id) ON UPDATE CASCADE;
  END IF;
END $$;

-- 청소 작업이 생기기 전부터 존재하는 청소 의무. 퇴실 변경/취소 시 앞 의무는 끝내고 새 의무를 만든다.
CREATE TABLE IF NOT EXISTS cleaning_obligations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE,
  stay_id     UUID NOT NULL,
  checkout_at TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TARGET_REMOVED')),
  ended_at    TIMESTAMPTZ,
  end_reason  TEXT,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('REAL','SIMULATED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id,id),
  CONSTRAINT cleaning_obligations_stay_fk FOREIGN KEY (property_id,stay_id)
    REFERENCES property_stays(property_id,id) ON UPDATE CASCADE,
  CHECK ((status='ACTIVE' AND ended_at IS NULL AND end_reason IS NULL)
      OR (status='TARGET_REMOVED' AND ended_at IS NOT NULL AND end_reason IS NOT NULL))
);

-- 같은 숙박이 A→B→A로 다시 바뀌면 끝난 A를 다시 열지 않고 새 의무를 만든다.
-- 초기 확장판에 있던 시각 유일 제약은 그 재발을 막으므로 제거하고, 현재 ACTIVE 하나만 아래 인덱스로 보장한다.
ALTER TABLE cleaning_obligations
  DROP CONSTRAINT IF EXISTS cleaning_obligations_stay_id_checkout_at_key;

CREATE UNIQUE INDEX IF NOT EXISTS cleaning_obligations_one_active_per_stay
  ON cleaning_obligations(stay_id) WHERE status='ACTIVE';

ALTER TABLE cleaning_jobs ADD COLUMN IF NOT EXISTS cleaning_obligation_id UUID;

-- 기존 예약에는 신원만 백필한다. 이 백필로 과거 이상/해결을 만들거나 지표에 넣지 않는다.
WITH grouped AS (
  SELECT r.property_id,r.stay_id,r.check_out,
         CASE WHEN BOOL_OR(r.status='ACTIVE') THEN 'ACTIVE' ELSE 'TARGET_REMOVED' END AS status,
         CASE WHEN BOOL_OR(r.status='ACTIVE') THEN NULL ELSE MAX(r.updated_at) END AS ended_at,
         CASE WHEN BOOL_OR(r.status='ACTIVE') THEN NULL ELSE 'RESERVATION_CANCELLED' END AS end_reason,
         CASE WHEN BOOL_OR(r.data_origin='REAL') THEN 'REAL' ELSE 'SIMULATED' END AS data_origin,
         MIN(r.created_at) AS created_at
    FROM property_reservations r
   WHERE r.stay_id IS NOT NULL
   GROUP BY r.property_id,r.stay_id,r.check_out
)
INSERT INTO cleaning_obligations(property_id,stay_id,checkout_at,status,ended_at,end_reason,data_origin,created_at)
SELECT g.property_id,g.stay_id,g.check_out,g.status,g.ended_at,g.end_reason,g.data_origin,g.created_at
  FROM grouped g
 WHERE NOT EXISTS (
   SELECT 1 FROM cleaning_obligations o WHERE o.stay_id=g.stay_id AND o.checkout_at=g.check_out
 );

-- 같은 UID의 날짜 변경으로 남은 옛 작업도 해당 숙박의 끝난 의무로만 연결한다.
INSERT INTO cleaning_obligations(property_id,stay_id,checkout_at,status,ended_at,end_reason,data_origin,created_at)
SELECT DISTINCT r.property_id,r.stay_id,j.checkout_at,'TARGET_REMOVED',j.updated_at,'CHECKOUT_CHANGED',j.data_origin,j.created_at
  FROM cleaning_jobs j
  JOIN property_reservations r
    ON r.property_id=j.property_id AND r.reservation_uid=j.reservation_uid
 WHERE r.stay_id IS NOT NULL AND r.check_out<>j.checkout_at
   AND NOT EXISTS (
     SELECT 1 FROM cleaning_obligations o WHERE o.stay_id=r.stay_id AND o.checkout_at=j.checkout_at
   );

UPDATE cleaning_jobs j
   SET cleaning_obligation_id=o.id
  FROM property_reservations r
  JOIN cleaning_obligations o ON o.stay_id=r.stay_id
 WHERE j.cleaning_obligation_id IS NULL
   AND r.property_id=j.property_id
   AND r.reservation_uid=j.reservation_uid
   AND o.checkout_at=j.checkout_at;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cleaning_jobs_obligation_fk') THEN
    ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_obligation_fk
      FOREIGN KEY (property_id,cleaning_obligation_id)
      REFERENCES cleaning_obligations(property_id,id) ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cleaning_jobs_obligation_unique') THEN
    ALTER TABLE cleaning_jobs ADD CONSTRAINT cleaning_jobs_obligation_unique UNIQUE (cleaning_obligation_id);
  END IF;
END $$;

-- 청소 의무의 배정 상태 이력. 기존 행에는 과거 배정 시각을 추정하지 않고 이 마이그레이션을
-- 적용한 시점의 현재 상태만 기준점으로 남긴다. 이후 변경은 업무 UPDATE와 같은 트랜잭션에서
-- record_cleaning_assignment_history를 호출한다.
CREATE TABLE IF NOT EXISTS cleaning_assignment_history (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id            TEXT NOT NULL REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE,
  cleaning_obligation_id UUID NOT NULL,
  cleaning_job_id        UUID REFERENCES cleaning_jobs(id),
  assignment_state       TEXT NOT NULL CHECK (assignment_state IN ('UNASSIGNED','ASSIGNED','TARGET_REMOVED')),
  assigned_cleaner_id    UUID REFERENCES cleaners(id),
  actor_type             TEXT NOT NULL CHECK (actor_type IN ('SYSTEM','ADMIN','OPERATOR','CLEANER')),
  change_reason          TEXT NOT NULL,
  source_event_key       TEXT NOT NULL UNIQUE,
  occurred_at            TIMESTAMPTZ NOT NULL,
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  details                JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cleaning_assignment_history_obligation_fk
    FOREIGN KEY (property_id,cleaning_obligation_id)
    REFERENCES cleaning_obligations(property_id,id) ON UPDATE CASCADE,
  CHECK ((assignment_state='ASSIGNED' AND assigned_cleaner_id IS NOT NULL)
      OR (assignment_state<>'ASSIGNED' AND assigned_cleaner_id IS NULL))
);

CREATE INDEX IF NOT EXISTS cleaning_assignment_history_obligation_time
  ON cleaning_assignment_history(cleaning_obligation_id,occurred_at,recorded_at);

ALTER TABLE cleaning_assignment_history
  ALTER COLUMN recorded_at SET DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION record_cleaning_assignment_history(
  p_property_id TEXT,
  p_cleaning_obligation_id UUID,
  p_cleaning_job_id UUID,
  p_assignment_state TEXT,
  p_assigned_cleaner_id UUID,
  p_actor_type TEXT,
  p_change_reason TEXT,
  p_source_event_key TEXT,
  p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
  p_details JSONB DEFAULT '{}'::jsonb
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  previous cleaning_assignment_history%ROWTYPE;
  inserted_id UUID;
BEGIN
  IF p_cleaning_obligation_id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO previous
    FROM cleaning_assignment_history
   WHERE cleaning_obligation_id=p_cleaning_obligation_id
   ORDER BY occurred_at DESC,recorded_at DESC,id DESC
   LIMIT 1;

  IF FOUND AND previous.assignment_state=p_assignment_state
     AND previous.assigned_cleaner_id IS NOT DISTINCT FROM p_assigned_cleaner_id THEN
    RETURN FALSE;
  END IF;

  INSERT INTO cleaning_assignment_history(
    property_id,cleaning_obligation_id,cleaning_job_id,assignment_state,assigned_cleaner_id,
    actor_type,change_reason,source_event_key,occurred_at,details
  ) VALUES(
    p_property_id,p_cleaning_obligation_id,p_cleaning_job_id,p_assignment_state,p_assigned_cleaner_id,
    p_actor_type,p_change_reason,
    COALESCE(NULLIF(p_source_event_key,''),'assignment:'||gen_random_uuid()::text),
    p_occurred_at,COALESCE(p_details,'{}'::jsonb)
  )
  ON CONFLICT (source_event_key) DO NOTHING
  RETURNING id INTO inserted_id;

  RETURN inserted_id IS NOT NULL;
END $$;

INSERT INTO cleaning_assignment_history(
  property_id,cleaning_obligation_id,cleaning_job_id,assignment_state,assigned_cleaner_id,
  actor_type,change_reason,source_event_key,occurred_at,details
)
SELECT o.property_id,o.id,j.id,
       CASE
         WHEN o.status='TARGET_REMOVED' THEN 'TARGET_REMOVED'
         WHEN j.status IN ('ASSIGNED','COMPLETED') AND j.assigned_cleaner_id IS NOT NULL THEN 'ASSIGNED'
         ELSE 'UNASSIGNED'
       END,
       CASE
         WHEN o.status='ACTIVE' AND j.status IN ('ASSIGNED','COMPLETED') THEN j.assigned_cleaner_id
         ELSE NULL
       END,
       'SYSTEM','MIGRATION_BASELINE','assignment-baseline:'||o.id::text,NOW(),
       jsonb_build_object('baseline',true)
  FROM cleaning_obligations o
  LEFT JOIN cleaning_jobs j ON j.cleaning_obligation_id=o.id
 WHERE NOT EXISTS (
   SELECT 1 FROM cleaning_assignment_history h WHERE h.cleaning_obligation_id=o.id
 )
ON CONFLICT (source_event_key) DO NOTHING;

-- 이상 본체는 한 번 쓰고 고치지 않는다. 현재 열린 사건의 유일성은 아래 매핑 테이블이 맡는다.
CREATE TABLE IF NOT EXISTS automation_anomalies (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                TEXT NOT NULL REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE,
  anomaly_type               TEXT NOT NULL CHECK (anomaly_type IN (
                               'noise','vacant_energy_waste','guest_complaint_sensor',
                               'cleaning_unassigned','device_offline'
                             )),
  incident_key               TEXT NOT NULL,
  previous_anomaly_id        UUID REFERENCES automation_anomalies(id),
  stay_id                    UUID,
  cleaning_obligation_id     UUID,
  target_ref                 TEXT,
  source_type                TEXT NOT NULL,
  source_ref                 TEXT NOT NULL,
  master_policy_version_id   UUID NOT NULL REFERENCES automation_policy_versions(id),
  property_policy_version_id UUID REFERENCES automation_policy_versions(id),
  stabilization_minutes      INT NOT NULL CHECK (stabilization_minutes >= 0),
  occurred_at                TIMESTAMPTZ NOT NULL,
  recorded_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_anomalies_stay_fk FOREIGN KEY (property_id,stay_id)
    REFERENCES property_stays(property_id,id) ON UPDATE CASCADE,
  CONSTRAINT automation_anomalies_obligation_fk FOREIGN KEY (property_id,cleaning_obligation_id)
    REFERENCES cleaning_obligations(property_id,id) ON UPDATE CASCADE,
  CHECK (
    (anomaly_type='noise' AND stay_id IS NOT NULL)
    OR (anomaly_type='guest_complaint_sensor' AND stay_id IS NOT NULL AND target_ref IS NOT NULL)
    OR (anomaly_type='cleaning_unassigned' AND cleaning_obligation_id IS NOT NULL)
    OR (anomaly_type IN ('vacant_energy_waste','device_offline') AND target_ref IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS automation_anomalies_property_occurred
  ON automation_anomalies(property_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS automation_anomalies_type_occurred
  ON automation_anomalies(anomaly_type,occurred_at DESC);

-- Gmail 원문은 저장하지 않는다. Airbnb 답장 한 건에서 확인된 주제만 추가 전용으로 남긴다.
CREATE TABLE IF NOT EXISTS guest_complaint_signals (
  gmail_message_id TEXT NOT NULL,
  topic            TEXT NOT NULL CHECK (topic IN ('temperature','humidity')),
  property_id      TEXT NOT NULL REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE,
  stay_id          UUID,
  airbnb_room_id   TEXT NOT NULL,
  airbnb_thread_id TEXT NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (gmail_message_id,topic),
  CONSTRAINT guest_complaint_signals_stay_fk FOREIGN KEY (property_id,stay_id)
    REFERENCES property_stays(property_id,id) ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS guest_complaint_signals_pairing
  ON guest_complaint_signals(property_id,topic,occurred_at DESC);

CREATE TABLE IF NOT EXISTS automation_open_incidents (
  incident_key TEXT PRIMARY KEY,
  anomaly_id   UUID NOT NULL UNIQUE REFERENCES automation_anomalies(id) ON DELETE CASCADE,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_anomaly_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id       UUID NOT NULL REFERENCES automation_anomalies(id) ON DELETE CASCADE,
  history_type     TEXT NOT NULL CHECK (history_type IN ('STATE_CHANGE','INTERVENTION','RESOLUTION','CORRECTION')),
  state            TEXT CHECK (state IS NULL OR state IN (
                     'IN_PROGRESS','STABILIZING','RESOLVED','UNRESOLVED_ENDED','TARGET_REMOVED'
                   )),
  actor_type       TEXT CHECK (actor_type IS NULL OR actor_type IN ('SYSTEM','ADMIN','OPERATOR','CLEANER','GUEST')),
  source_event_key TEXT NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (anomaly_id,history_type,source_event_key),
  CHECK ((history_type IN ('STATE_CHANGE','RESOLUTION') AND state IS NOT NULL)
      OR (history_type IN ('INTERVENTION','CORRECTION')))
);

CREATE INDEX IF NOT EXISTS automation_anomaly_history_case_time
  ON automation_anomaly_history(anomaly_id,occurred_at,recorded_at);

COMMENT ON TABLE automation_anomalies IS
  'RF-25: 이 마이그레이션 이전의 과거 이상은 추정 백필하지 않으며 effective_from 이후 기록만 집계한다';
