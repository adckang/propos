-- PROPOS property_cleaning_config.name UNIQUE 제약 추가 (D-016 무결성 보강, 2026-09-29)
-- 실행: psql $POSTGRES_URL -f data/migrate-property-name-unique.sql
--
-- 배경: D-016 정책상 property_id = name 이어야 하는데, 지금까지 "같은 이름 중복 등록"
-- 차단은 애플리케이션 코드(api/cleaning/[...slug].js 의 upsertProperty, 저장 전 SELECT
-- 로 검사)에만 있었다 — DB 자체엔 강제가 없어 (a) 동시 요청 경쟁 상태, (b) 그 코드 경로를
-- 거치지 않는 실수(수동 INSERT, 이전 마이그레이션 스크립트 등)에는 무방비였다.
-- 실제로 2026-09-29 프로덕션에서 "파주201"이라는 이름이 서로 다른 3개 property_id 로
-- 중복 등록돼 있던 사고가 있었음(수동으로 정리 완료, 정리 후 이 스크립트 실행).
-- 재발을 애플리케이션 레이어가 아니라 DB 레벨에서 원천 차단한다.
--
-- 사전 확인(이 ALTER 실행 전에 직접 확인할 것): 중복 이름이 남아있으면 제약 추가가
-- 실패하므로, 먼저 아래로 중복이 없는지 확인한다.
--   SELECT name, COUNT(*) FROM property_cleaning_config GROUP BY name HAVING COUNT(*) > 1;

ALTER TABLE property_cleaning_config
  ADD CONSTRAINT property_cleaning_config_name_unique UNIQUE (name);
