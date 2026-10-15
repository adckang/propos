-- cleaning_jobs_status_check 검증 (D-032 후속, 2026-10-15)
-- migrate-source-aware-data.sql 이 레거시 행을 보호하려고 NOT VALID 로 추가했다.
-- 운영 DB 의 모든 행이 허용 목록 안에 있음을 확인한 뒤 VALIDATE (이미 검증됐으면 아무 일도 안 함).
-- 위반 행이 있으면 VALIDATE 가 실패하고 트랜잭션이 롤백된다.
ALTER TABLE cleaning_jobs VALIDATE CONSTRAINT cleaning_jobs_status_check;
