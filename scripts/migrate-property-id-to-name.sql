-- 숙소 식별자 이전: property_id  이전 식별자(예: prop_1723000000000) → 새 이름(ListView에 표시되는 숙소 이름)
-- 결정 D-016: 식별자 = 숙소 이름. Pi 워처 이벤트(areaName)는 이미 이름으로 쌓이므로 events 는 보통 옮길 행이 없다.
--
-- 앱은 첫 로드 때(설정 id 가 이름과 다르면) 같은 이전을 서버 API(previous_property_id)로 자동 수행한다.
-- 이 파일은 그 전에 "무엇이 옮겨지는지" 미리 확인하거나 수동으로 실행하기 위한 것이다.
--
-- 사용법 (psql 대화형 세션 — 마지막에 COMMIT / ROLLBACK 을 직접 입력):
--   psql "$POSTGRES_URL"
--   \set old prop_1723000000000
--   \set new '파주 201'
--   \i scripts/migrate-property-id-to-name.sql
--
-- 이 파일은 COMMIT 하지 않는다. UPDATE 결과의 행 수를 확인한 뒤 직접 COMMIT; 또는 ROLLBACK; 한다.

\echo '--- [미리보기] 이전 식별자가 가진 행 수 ---'
SELECT 'property_cleaning_config'  AS tbl, COUNT(*) AS rows FROM property_cleaning_config  WHERE property_id = :'old'
UNION ALL
SELECT 'cleaning_jobs',                    COUNT(*)         FROM cleaning_jobs             WHERE property_id = :'old'
UNION ALL
SELECT 'property_calendar_blockers',       COUNT(*)         FROM property_calendar_blockers WHERE property_id = :'old'
UNION ALL
SELECT 'events',                           COUNT(*)         FROM events                    WHERE property_id = :'old';

\echo '--- [충돌 확인] 새 이름이 이미 등록돼 있으면 1행이 나온다 (다른 숙소와 합치면 안 되므로 그 경우 중단) ---'
SELECT property_id, name FROM property_cleaning_config WHERE property_id = :'new';

BEGIN;

UPDATE property_cleaning_config
   SET property_id = :'new', name = :'new', updated_at = NOW()
 WHERE property_id = :'old';

UPDATE cleaning_jobs             SET property_id = :'new' WHERE property_id = :'old';
UPDATE property_calendar_blockers SET property_id = :'new' WHERE property_id = :'old';
UPDATE events                    SET property_id = :'new' WHERE property_id = :'old';

-- monthly_summaries 테이블이 있는 환경에서만 (없으면 이 줄은 주석 유지):
-- UPDATE monthly_summaries SET property_id = :'new' WHERE property_id = :'old';

\echo '--- 위 UPDATE 행 수가 [미리보기]와 맞는지 확인한 뒤 COMMIT;  이상하면 ROLLBACK; 을 입력하세요 ---'
