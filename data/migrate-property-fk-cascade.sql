-- 숙소 식별자 변경(D-016 rename)이 FK 때문에 막히지 않도록 ON UPDATE CASCADE 로 재정의.
--
-- 배경: migrate-source-aware-data.sql 이 property_cleaning_config(property_id)를 참조하는 FK 를
-- 기본(NO ACTION)으로 추가했다. 그러면 레지스트리 property_id 를 바꾸는 순간 하위 행이 남아 있어
-- 거절되고, 하위 행을 먼저 바꾸면 새 부모가 없어 거절된다 → 이름 변경이 항상 실패한다.
-- 또 property_reservations 가 이전 대상 목록에 없어 예약 이력이 옛 이름에 남을 수 있었다.
--
-- 복합 FK(cleaning_jobs → property_reservations)는 DEFERRABLE INITIALLY DEFERRED 여야 한다:
-- 레지스트리 UPDATE 의 CASCADE 가 cleaning_jobs 를 property_reservations 보다 먼저 옮기므로
-- 검사를 트랜잭션 끝으로 미뤄야 한다.
--
-- 레거시 정리: 가리키는 예약이 property_reservations 에 없는 청소 작업(iCal 이 지난 예약을 더 이상
-- 주지 않아 복원 불가)은 이름 변경 때 키가 바뀌며 FK 검사에 걸려 변경 전체를 막는다. 원래 uid 는
-- source_ref 에 보존하고 reservation_uid 만 비운다 (추적 가능, 되돌릴 수 있음).
--   source_ref 에 이미 값이 있으면 ' | ' 로 이어붙인다 (기존 값을 덮어쓰지 않고 uid 도 잃지 않음).
-- 재실행 안전.

UPDATE cleaning_jobs j
   SET source_ref = COALESCE(j.source_ref || ' | ', '') || 'legacy_reservation_uid:' || j.reservation_uid,
       reservation_uid = NULL,
       updated_at = NOW()
 WHERE j.reservation_uid IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM property_reservations r
      WHERE r.property_id = j.property_id AND r.reservation_uid = j.reservation_uid);

DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('property_reservations',        'property_reservations_property_fk',        'FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE'),
      ('cleaning_jobs',                'cleaning_jobs_property_fk',                'FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE'),
      ('cleaning_jobs',                'cleaning_jobs_reservation_fk',             'FOREIGN KEY (property_id, reservation_uid) REFERENCES property_reservations(property_id, reservation_uid) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED'),
      ('property_calendar_blockers',   'property_calendar_blockers_property_fk',   'FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE'),
      ('events',                       'events_property_fk',                       'FOREIGN KEY (property_id) REFERENCES property_cleaning_config(property_id) ON UPDATE CASCADE')
    ) AS t(tbl, conname, def)
  LOOP
    IF to_regclass(spec.tbl) IS NULL THEN CONTINUE; END IF;
    -- 이미 CASCADE 면 건너뜀 (confupdtype 'c' = CASCADE)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = spec.conname AND confupdtype = 'c'
                 AND condeferrable = (spec.def LIKE '%DEFERRABLE%')) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = spec.conname) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', spec.tbl, spec.conname);
    END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', spec.tbl, spec.conname, spec.def);
  END LOOP;
END $$;
