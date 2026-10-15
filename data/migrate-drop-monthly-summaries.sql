-- monthly_summaries 폐기 (D-032 후속, 2026-10-15)
--
-- 설계상 "90일 지난 events 를 월별로 압축 보관"하는 테이블이었으나 아카이브 크론이 끝내 구현되지 않았고,
-- 코드가 읽거나 쓴 적이 없다 (운영 DB: 0행, INSERT/UPDATE/DELETE 이력 0, FK·뷰·함수·트리거 의존 없음).
-- 일/주/월 리포트는 events·cleaning_jobs 원본에서 요청 시 직접 계산한다.
-- 아카이브가 필요해지면 그때 읽기 경로와 함께 새로 설계한다 (docs/data-storage-design.md §9).
--
-- 안전장치: 행이 하나라도 있으면 중단한다. CASCADE 없이 DROP — 의존 객체가 있으면 실패한다.
DO $$
BEGIN
  IF to_regclass('monthly_summaries') IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM monthly_summaries) > 0 THEN
      RAISE EXCEPTION 'monthly_summaries 에 데이터가 있어 삭제를 중단합니다';
    END IF;
    DROP TABLE monthly_summaries;
  END IF;
END $$;
