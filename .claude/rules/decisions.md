# Design Decisions

> 이미 검토하고 버린 선택지를 Claude가 다시 제안하는 것을 방지.

---

## 현재 활성 결정

## [D-027] 월간 레포트 "발견된 패턴" — 지표/숙소/기간 비교로 찾아낸 규칙 기반 인사이트 최대 3문장 (2026-09-28 확정)
- **결정**: 월간 레포트(ListView·대시보드가 공유하는 `SelectedPropertyReport`, this_month/last_month에서만) 요약 문장 바로 아래에, 기존 표에 이미 있는 숫자들 사이의 관계를 **정해진 규칙**으로 자동으로 찾아 최대 3문장까지 보여주는 "🔍 발견된 패턴 N건" 항목을 추가한다. 요약 문장(D-026)은 그대로 두고, 이건 그 **하부의 독립적인 펼침 항목**이다 — 기존 "자세히"(전체 표 펼치기) 토글과는 완전히 별개의 토글이라 서로 상태가 안 섞인다. 패턴이 하나도 없으면 항목 자체가 안 보인다(D-020과 같은 원칙 — 조용히 숨김).
  - **구현 범위(V1)**: 4종만 — **REPEAT**(같은 숙소·같은 지표가 이번 달에 2번 이상 반복), **CONCENTRATION**(한 지표의 이번 달 전체 실패 중 절반 이상이 한 숙소에 몰림, 총 실패 3건 이상·해당 숙소 2건 이상일 때만), **MONTH_OVER_MONTH**(지표 하나의 실패율이 지난달 대비 10%p 이상 변함, 이번달·지난달 모두 표본 5건 이상일 때만), **CONSECUTIVE**(같은 지표가 이번 달을 포함해 최근 달부터 끊기지 않고 2개월 이상 연속 실패).
  - **제외(사용자 결정)**: CO_OCCURRENCE(예: "절전도 안 되고 보안도 안 됨 — 같은 퇴실 건인가?")와 WORKER_CONCENTRATION(특정 청소 담당자에게 문제 집중)은 V1에서 뺐다. CO_OCCURRENCE는 "같은 생애주기 사건인지"를 신뢰성 있게 판별할 조인 키가 지금 데이터 구조엔 `post_checkout_energy`/`post_checkout_security` 한 쌍(퇴실 이벤트를 앵커로 삼는 `detectPostCheckoutFailures`)밖에 없어 범위가 좁고, WORKER_CONCENTRATION은 (a) events와 cleaning_jobs 사이에 조인 키 자체가 없고 (b) 실제 청소 담당자 배정 데이터가 현재 사실상 0건이라 두 가지 다른 이유로 막혀 있었다. 더 결정적으로, 느슨한 시간창 조인으로 담당자를 잘못 연결하면 **실제 사람 이름이 틀리게 문장에 나올 위험**이 있어 제외를 확정했다(사용자 지시: "사람 이름이 틀리게 나올 위험").
  - **이 기능의 성격**: 통계적 추론이나 AI 추천이 아니다. "합리적으로 판단"/"의미 있다고 판단" 같은 주관적 로직이 전혀 없고, 모든 발생 조건이 `INSIGHT_THRESHOLDS` 상수 하나로만 정의된다. 파이프라인은 `detect(타입별, threshold는 이미 적용됨) → dedupe → 결정적 정렬(타입 우선순위 고정, 가중치·AI-like score 없음) → 상위 3개`로 완전히 분리돼 있어, 나중에 순서나 임계값만 바꾸면 된다.
- **이유**: 사용자 요청 — "최종 산출물은 월간 리포트패널 Summary 영역에 표시할 최대 3개의 짧은 문장이다. 기존 지표를 요약하지 말고, 지표 간/숙소 간/기간 간 비교를 통해 새롭게 발견되는 패턴만 출력한다." 표는 이미 지표별 성공률을 다 보여주지만, "어느 숙소가 유독 반복되는지", "이번 달 vs 지난달이 어떻게 달라졌는지" 같은 건 사람이 표 여러 개를 직접 비교해야 알 수 있었다.
- **데이터 현황(중요, 재검토 근거)**: 실제 운영 중인 숙소는 파주201 1곳뿐이고, 라이브 프로덕션 DB 조회 결과 이벤트 원본이 2건, `monthly_summaries`는 0행, 실제 청소 담당자 배정도 0건이라 지금은 이 기능이 실제로 패턴을 찾아낼 만한 데이터가 거의 없다. 사용자 결정("데이터가 없는거면 어차피 mock데이터니 니가 채워넣으면되는거구")에 따라 기능 자체는 지금 완성하고, dev 스텁(`vite.config.mjs`)에 4종 전부가 자연스럽게 나오는 목업을 심어 화면에서 바로 확인할 수 있게 했다. 실제 숙소가 늘어 데이터가 쌓이면 별도 코드 변경 없이 그대로 동작한다.
- **버린 대안**: 새 분석 화면·상세 리포트로 따로 만들기 — 사용자가 명시적으로 "새로운 분석 화면이나 상세 리포트를 만드는 작업이 아니다"로 범위를 좁힘 / 인라인 아코디언으로 기존 "자세히" 안에 끼워 넣기 — 사용자가 "서머리의 하부 항목으로" 독립적으로 표현되길 원해 별도 토글로 분리 / CO_OCCURRENCE·WORKER_CONCENTRATION 포함 — 위 이유로 보류(별도 재검토 필요).
- **구현**:
  - `src/domain/insightDomain.js`(신규) — `INSIGHT_THRESHOLDS`, `detectRepeatInsights`/`detectConcentrationInsights`/`detectMonthOverMonthInsights`/`detectConsecutiveInsights`(4개 detector), `rankInsights`(dedupe + 타입 우선순위 CONCENTRATION>CONSECUTIVE>MONTH_OVER_MONTH>REPEAT + 상위 3개), `formatInsightSentence`(reportPeriod을 그대로 써서 "이번달/지난달" 하드코딩 없음), `buildMonthlyInsightSentences`(통합 진입점).
  - `src/domain/periodDomain.js` — `monthsAgoRange(n, nowMs)` 추가(이번 달 기준 n개월 전 KST 달력 월 범위 + `YYYY-MM` 키). 기존 이름 기간 시스템(`describePeriod`/`parseOffsetPeriod`)과 완전히 독립된 순수 추가 함수 — 기존 화면 어디에도 영향 없음(사이드이펙트 최소화를 위한 의도적 설계).
  - `src/infrastructure/cleaningJobRepository.js` — `queryCleaningJobCountsByProperty(db, range, propertyIds)` 추가(기존 `queryCleaningJobCounts`의 숙소별 GROUP BY 버전, REPEAT/CONCENTRATION용). 기존 함수는 그대로 둬서 다른 호출부(월간 요약 등) 영향 없음.
  - `src/application/reportingService.js` — `getMonthlyInsights(period, {db, propertyIds, now})` 추가. this_month/last_month가 아니면 DB 호출 없이 빈 배열. 최근 4개월(`INSIGHT_LOOKBACK_MONTHS`)치 스코프 합산 지표를 한 번씩만 조회해 MONTH_OVER_MONTH(현재·직전)와 CONSECUTIVE(전체 이력) 둘 다 재사용, 이번 달 이벤트만 별도로 숙소별로 나눠 REPEAT/CONCENTRATION 입력을 만든다. **"전체 숙소" 스코프(propertyIds=null)일 때 별도의 "숙소 목록" 테이블 조회를 새로 추가하지 않고, 이미 가져온 이번 달 이벤트에 실제로 등장한 property_id만 스코프로 삼는다** — 그 달에 기록이 전혀 없는 숙소는 REPEAT/CONCENTRATION 어느 쪽으로도 뽑힐 수 없어 조회할 이유가 없다는 판단(기존 `property_cleaning_config` 조회는 `api/cleaning/[...slug].js`·`api/cron/[...slug].js`에 인라인으로만 있고 재사용 가능한 저장소 함수가 없어, 새 의존성을 추가하는 대신 이미 있는 데이터에서 파생시키는 쪽을 택함). property_id는 D-016에 따라 그 자체가 표시 이름이라 별도 이름 조회 불필요.
  - `api/stats.js` — `getMonthlyInsights` import, this_month/last_month 응답에만 `result.insights` 추가(기존 `{period, stats, summary}`에 더해지는 필드, 다른 기간은 건드리지 않음).
  - `src/hooks/useReportingStats.js` — `insights: data.insights ?? []`로 노출(모든 상태 분기에 필드 추가).
  - `src/components/v2/reporting/SummaryBanner.jsx` — 새 prop `insights = []`(기본값이라 기존 호출부 — ListView/DetailView의 SummaryBanner — 영향 없음). "🔍 발견된 패턴 N건 ▾" 행 + 펼치면 문장 리스트, 기존 `expanded`(자세히) state와 별개인 `insightsExpanded` state로 독립 토글.
  - `src/components/v2/reporting/SelectedPropertyReport.jsx` — `useReportingStats`에서 `insights`를 구조분해해 `<SummaryBanner insights={insights}>`로 전달.
  - `vite.config.mjs`(dev 전용) — `/api/stats` 스텁에 `mockMonthlyInsights(period, nowMs)` 추가, 실제 `buildMonthlyInsightSentences`를 그대로 불러써서(D-026 dev 스텁 교훈과 같은 원칙 — 스텁이 문장 로직을 따로 만들면 production과 갈라짐) this_month/last_month에서 CONCENTRATION·CONSECUTIVE·MONTH_OVER_MONTH 3종이 자연스럽게 상위 3개로 뽑히는 목업 데이터 제공(REPEAT 후보도 같이 넣어 "임계값 이상 후보가 top3보다 많을 때 타입 우선순위로 걸러진다"는 랭킹 규칙까지 확인 가능).
  - 테스트: `tests/unit/s63.monthly-insights.test.js`(L1 — `monthsAgoRange`, 4개 detector 각각의 임계값 경계, `rankInsights`의 dedupe·타입 우선순위·limit, `formatInsightSentence`의 4개 타입 문장, `buildMonthlyInsightSentences` 통합 / L2 — `getMonthlyInsights`의 period 게이트·숙소 스코프 파생·DB 조합을 고정 목업 이벤트로 결정적으로 검증, `api/stats.js`·`useReportingStats.js`·`SummaryBanner.jsx`·`SelectedPropertyReport.jsx`의 소스 계약). 35개 테스트 전부 통과, `npm test` 전체 스위트(2063개) 회귀 없음 확인. period 게이트·CONCENTRATION 비율 조건·`SummaryBanner`의 `hasInsights` 가드 각각 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인.
  - `npx vite build` 정상 빌드 확인. 브라우저로 직접 확인(Playwright, 콘솔 에러 0건): 대시보드 "이번달" — 요약 문장 바로 아래 "🔍 발견된 패턴 3건" 펼침, 클릭 시 3문장(CONCENTRATION/CONSECUTIVE/MONTH_OVER_MONTH) 표시, "자세히"(전체 표) 토글과 독립적으로 열고 닫힘. "지난달" — 월 라벨이 8월로 정확히 밀려서 표시. "다음달"(미래) — 발견된 패턴 항목 자체가 안 보임(설계대로 this_month/last_month에서만 계산).
- **재검토 시점**: 실제 숙소·운영 데이터가 쌓이면 mock 목업을 걷어내고 실데이터로만 확인. CO_OCCURRENCE·WORKER_CONCENTRATION은 (a) 이벤트-청소잡 조인 키가 생기고 (b) 실제 담당자 배정 데이터가 쌓이면 재검토.

## [D-026] "완료" 7개 운영 지표 — 요약 문장·표를 "담당자가 보고하는 느낌"으로 (2026-09-25 확정)
- **결정**: 과거/진행중 레포트("지난주/이번주/지난달/이번달" 등)의 "완료" 섹션 — 7개 운영 지표 표와 그 위 한 줄 요약 문장 — 을 시스템 필드명 직역("입실전 숙소 최적화율", "달성률" 등) 대신 사람이 실제로 보고하는 듯한 워딩으로 바꾼다. ListView(주/일)와 대시보드(월) 양쪽 다 적용 — 대시보드는 "지난달/이번달" 같은 과거/진행중 구간에만, "다음달"(미래)은 그대로.
  - **표**: 라벨을 짧게(입실전 숙소 최적화율→**게스트 맞이 준비**, 퇴실후 청소전 절전 적용률→**퇴실 후 절전**, 퇴실후 청소전 보안 적용률→**퇴실 후 보안**, 청소후 공실중 절전 적용률→**빈방 절전 유지**, 청소후 공실중 보안 적용률→**빈방 보안 유지**, 청소 시작~완료 시간 준수율→**청소시간 준수**, 청소 스케줄 할당 성공률→**청소 담당자 배정**). 헤더 "달성률"→**"성공률"**. 각 행은 "N/M건 · 성공률%"는 그대로 두고, **기준(90%) 미달일 때만** 빨간 "실패 K건" 배지를 덧붙인다(잘된 건 조용히, 문제만 눈에 띄게 — D-020과 같은 원칙).
  - **요약 문장**: "지난주 운영은 전반적으로 잘 됐어요. 다만 빈방 절전이 3번 새어나갔고, 퇴실 후 절전이 2번 안 됐고, 청소시간이 2번 기준을 벗어났어요. 이 항목들 확인해 주세요." 처럼 ① 전체 평가 한 줄 + ② "다만 ~" 뒤에 기준(90%) 미달 지표만 **지표마다 다른 동사**로(늦었다/안 됐다/새어나갔다/풀렸다/벗어났다 — 한 템플릿으로 뭉치지 않음) + ③ 실패 개수에 맞는 마무리("확인해 주세요"/"이 두 항목만 확인하면 됩니다"/"이 항목들 확인해 주세요"). 미달 지표가 없으면 "N개 모두 기준을 통과했어요."만. **측정 가능한 지표의 절반 넘게** 미달이면 "잘 됐다" 대신 "신경 쓸 부분이 있었어요"로 톤이 바뀐다(심각 등급, urgent 배너).
  - **표와 요약의 기준 통일(중요 버그 수정)**: 처음엔 표의 빨간 배지를 "실패 1건이라도 있으면" 조건으로 만들었다가, 브라우저로 확인하는 과정에서 **"7개 모두 기준을 통과했어요"(초록, 정상) 요약 바로 아래 표에는 7행 전부 빨간 배지가 붙어 있는 모순**을 발견했다 — 92%(1건 실패)는 요약 기준(<90%)으론 "통과"지만 배지 기준(실패>0)으론 "빨강"이었기 때문. 표 배지 기준을 요약과 똑같이 "90% 미만"으로 통일해서 해결(사용자가 최초 제시한 예시 표에서도 92% 행엔 배지가 없었음 — 그게 맞는 기준이었다). 드릴다운(›)은 배지와 무관하게 실패 1건이라도 있으면 그대로 가능.
  - **적용 범위(중요)**: 이 요약은 ListView·대시보드 **양쪽 다 실제로 쓰는 `generateSummary`(서버, `reportingService.js`) 안에서** 만들어진다 — 대시보드 쪽이 따로 쓰던 `issueSummary`(캘린더 "문제 N건" 배지 합계 기반, 7개 지표와 무관한 별개 집계)는 제거하고 `generateSummary`의 결과를 그대로 쓰도록 통일했다. 이제 두 화면이 완전히 같은 문장·같은 숫자 정의를 쓴다.
- **이유**: 사용자가 여러 턴에 걸쳐 실제 예시("지난주 운영은 전반적으로 잘 됐습니다. 다만 청소 후 빈방 절전이 12번 중 3번...")를 직접 다듬어 확정한 워딩·표 포맷을 그대로 반영. "직역된 지표명 + 딱딱한 %"보다 "무슨 일이 있었는지 한 줄로 바로 이해되는" 문장이 실제 운영자에게 더 유용하다는 판단.
- **부수 발견 — dev 스텁이 실제 로직과 따로 놀고 있었음**: 로컬(`npm run dev`)에서 브라우저로 확인하는데 화면에 옛날 문장("이번 달 20개 숙소 운영 문제 9건이 있었어요.")이 그대로 떠서 조사해보니, `vite.config.mjs`의 `/api/stats` dev 스텁이 **실제 DB 없이 화면만 확인하려고 만든 자체 요약 문장 로직**을 따로 갖고 있었다(`generateSummary`를 안 씀). 실제 서버(Vercel, production)는 `reportingService.js`를 그대로 쓰므로 프로덕션 동작 자체엔 문제 없었지만, dev 스텁이 낡아 있으면 로컬 확인이 계속 실제 동작과 어긋난다 — 스텁이 `summarizeOperationalMetrics`를 직접 불러 쓰도록 고쳐서 dev와 production이 같은 문장을 내게 맞췄다.
- **버린 대안**: 표 배지를 "실패 1건이라도 있으면" 유지 — 위에서 설명한 요약-표 모순 때문에 폐기 / 대시보드 요약에 anomalies(실시간 이상감지 건수)를 계속 반영 — 이 표가 다루는 7개 지표와 무관한 별개 신호라 판단, 다른 화면(상태칩 등)이 이미 보여줌.
- **구현**:
  - `src/domain/operationalMetricsDomain.js`(신규) — `computeOperationalMetrics(stats)`(7개 지표 라벨+분자+분모, 표·요약 공통 정의), `computeMeasurableMetrics`, `summarizeOperationalMetrics(period, stats)`(요약 문장, past/active 아니면 null), `PCT_GOOD`(=90, export).
  - `src/components/v2/reporting/EventMatrixPanel.jsx` — 인라인 METRICS 배열을 `computeOperationalMetrics`로 교체, 헤더 "성공률"로 변경, 행 key를 지표 key로.
  - `src/components/v2/reporting/SharedMetricRow.jsx` — 배지 조건 `pct < PCT_GOOD`(요약과 동일 기준)로.
  - `src/application/reportingService.js` — `generateSummary`의 this_week/last_week/this_month/last_month/yesterday/last_hour + 몇 주·며칠 전(과거) 분기에서 `summarizeOperationalMetrics` 우선 사용, `null`이면(운영 지표 데이터가 없는 얕은 stats) 기존 문장으로 폴백 — 기존 단위테스트(`s21`/`s49`, 최소 필드만 있는 픽스처)가 전부 이 폴백 경로를 타서 그대로 통과함.
  - `src/components/v2/reporting/SelectedPropertyReport.jsx` — `issueSummary`(캘린더 이슈 카운트 기반) 제거, `useReportingStats`가 주는 `summary`를 그대로 사용(다음 달만 `futureSummaryFor` 유지).
  - `src/components/v2/reporting/SummaryBanner.jsx` — `isUrgent()`에서 옛 `/운영 문제 [1-9]\d*건/` 정규식 제거, 새 심각 문구 `'신경 쓸 부분이'` 추가.
  - `vite.config.mjs`(dev 전용) — `/api/stats` 스텁이 과거/진행중 기간엔 `summarizeOperationalMetrics(period, stats)`을 직접 불러써서 production과 같은 문장을 내도록 수정.
  - 테스트: `tests/unit/s62.operational-metrics-summary.test.js`(신규, L1 도메인 함수 + L2 컴포넌트 배선), `tests/unit/s21.summary-sentence.test.js`(운영 지표 데이터가 있는 stats를 주면 새 문장이 나오는 걸 반영해 2건 갱신 — anomalies 필드가 이 요약엔 더 이상 영향 없음을 명시), `tests/e2e/s40.dashboard.spec.js`(더 이상 유효하지 않은 "운영 문제 N건 == 캘린더 배지 합계" 단언 제거). "심각" 등급 임계값(과반)을 무력화하는 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인.
  - 브라우저로 직접 확인(Playwright, 콘솔 에러 0건): ListView 지난주 — 요약·표·배지 완전히 일치하는 실제 데이터로 확인. 대시보드 지난달(7행 모두 92%, 배지 없음, 요약 "모두 통과") / 이번달(6행 83~88%, 배지 있음, 요약 "신경 쓸 부분이 있었어요" + 3개 지표 호명) 둘 다 확인.
- **재검토 시점**: dev 스텁과 실제 서버 로직이 이런 식으로 또 갈라지지 않도록, 공유 가능한 요약/집계 로직은 앞으로도 `src/domain/`에 순수 함수로 두고 스텁이 직접 import해서 쓰는 패턴을 유지할 것.
- **후속 수정 — 요약 문장을 5단계 등급 + 실패 총건수로 단순화 (2026-09-25, 같은 날)**: 위 "다만 ~" 서술형 요약을 실제로 써보니 사용자가 "요약부분에 맨트가 상당히 장황하게 느껴진다"고 지적 — **"완벽해요"/"양호해요"/"보통이에요"/"조금 불안정해요"/"아주 불안정해요"** 5단계 등급 + **"(실패 00건)"** 형태로 바꿔 달라고 요청.
  - 등급은 표 하단 "안심지수"와 **완전히 같은 평균 점수 계산**(measurable 지표의 raw 비율 평균)을 재사용 — 요약의 등급과 표를 펼쳤을 때 보이는 안심지수 숫자가 항상 서로 맞아떨어진다. 컷오프: 90점 이상 양호해요 / 75점 이상 보통이에요 / 50점 이상 조금 불안정해요 / 그 미만 아주 불안정해요. **"완벽해요"는 평균 점수가 아니라 실패 총건수 0으로 직접 판정**한다 — 평균은 반올림되므로(예: 실패가 있어도 평균이 100으로 반올림될 여지) 평균 기준만 쓰면 "완벽해요 (실패 1건)" 같은 모순이 생길 수 있어서다.
  - "(실패 N건)"은 7개 지표의 실패 건수를 전부 더한 총합(지표별로 무슨 실패인지는 이제 요약 문장에 안 나옴 — 표에서 행별 배지로 확인). "다만 ~" 서술 절·지표별 동사(늦었다/안 됐다/새어나갔다 등)는 전부 제거.
  - urgent(빨간 배너) 판정 문구도 `'신경 쓸 부분이'` → `'불안정해요'`로 교체(조금/아주 불안정해요 둘 다 매칭 — 하위 두 단계, 평균 75점 미만).
  - 표(라벨·헤더·행별 실패 배지)는 이번 수정 대상이 아니고 그대로 유지 — 이번엔 요약 "문장"만 바꿨다.
  - **버린 대안**: 등급 임계값을 서술형 문장의 "과반 미달" 기준(질적 판단)과 다르게 새로 정의 — 표의 안심지수와 다른 기준을 쓰면 또 "요약과 표가 다른 말을 하는" 모순이 재발할 수 있어, 안심지수와 완전히 같은 평균 점수 계산을 그대로 재사용하는 쪽으로 확정.
  - **구현**: `src/domain/operationalMetricsDomain.js` — `summarizeOperationalMetrics`를 5단계 등급 로직으로 전면 교체(`FAIL_STEM` 서술 문구 제거), `PCT_GOOD`은 표 배지 기준으로 계속 사용(export 유지). `src/components/v2/reporting/SummaryBanner.jsx` — `isUrgent()` 문구 교체. 테스트: `tests/unit/s62.operational-metrics-summary.test.js` Section B 전면 재작성(경계값 90/75/50점 테스트 포함), `tests/unit/s21.summary-sentence.test.js` 3건 갱신. "완벽해요" 판정 가드를 무력화하는 뮤테이션으로 테스트가 실제로 깨지는 것까지 확인. 브라우저로 재확인(콘솔 에러 0건): 대시보드 이번달 "보통이에요 (실패 7건)", 지난달 "양호해요 (실패 7건)", ListView 지난주 "보통이에요 (실패 10건)".
- **버그 수정 4건 — 실사용(파주201) 중 발견 (2026-09-26)**: 사용자가 ListView에서 실제 숙소(파주201) 하나만 선택해 써보다가 4가지를 지적. 원인 조사 결과 진짜 로직 버그 2개, 배지 기준 재검토 1개(사용자가 D-026 당일 자신이 확정한 90% 기준을 실사용해 보고 재지적), 순수 CSS 정렬 버그 1개였다.
  1. **"이번주 ... 이상감지 undefined건이 있었어요"**: `vite.config.mjs`(dev 스텁)의 `ACTIVE_STATS`(this_week/this_month용 목업)에 애초부터 `anomalies` 필드가 없었다(PAST_STATS·FUTURE_STATS엔 있었는데 이것만 빠짐) — `summarizeOperationalMetrics`가 null을 반환하는 폴백 경로에서 `stats.anomalies`를 그대로 문자열에 꽂다 보니 `undefined`가 그대로 노출됨. `ACTIVE_STATS`에 `anomalies` 추가로 해결.
  2. **"체크인 0건 완료, 이상감지 0건이 있었어요"인데 배너가 빨간색**: 두 가지가 겹친 문제. (a) 위 폴백 문구 자체가 `stats.anomalies > 0` 여부를 안 가리고 무조건 "이상감지 N건이 있었어요"를 넣고 있었음(0건이어도) — `> 0`일 때만 그 문구를 쓰고 0이면 "이상 없었어요"로 분기하도록 수정. (b) 더 근본적으로, `SummaryBanner.isUrgent()`가 `'이상감지'`라는 부분 문자열만 봐서 **숫자가 몇이든** 무조건 urgent 처리하고 있었다 — 문장에 숫자가 얼마든 매칭되는 구조적 결함이라 언젠가 다시 터질 수 있는 문제. `/이상감지 [1-9]\d*건/`처럼 **1 이상일 때만** 매칭하는 정규식으로 바꿔 근본 수정(이전 "운영 문제 N건" 때도 같은 유형의 버그를 같은 방식으로 고친 적 있음 — 이번엔 '이상감지'에도 같은 원칙을 적용).
  3. **"게스트 맞이 준비 11/12건 92%인데 왜 실패 배지가 없냐"**: D-026 최초 구현 때 "요약 문장과 배지 기준을 통일해야 모순이 없다"는 이유로 배지를 "90% 미만일 때만"으로 바꿨었는데, 5단계 등급으로 바뀌면서 그 전제가 달라졌다 — "완벽해요"가 이제 평균이 아니라 **실패 총건수 0**을 직접 판정하므로, 배지를 "실패 1건이라도 있으면"으로 되돌려도 더 이상 모순이 안 생긴다(배지가 하나라도 뜨면 요약은 이미 "완벽해요"가 아님이 항상 보장됨). 사용자 지적("숫자가 비잖아")을 반영해 배지 기준을 `failCount > 0`으로 되돌림 — 결과적으로 사용자가 맨 처음 제시했던 원안("실패 있을 때만 빨간 배지")으로 돌아온 것.
  4. **"표 세로선이 안 맞아, 같은 항목끼리는 좌측에 맞춰야지"**: `SharedMetricRow`가 flex 행이라 배지·드릴다운 화살표가 "있는 행만" 요소로 추가되고, 유일한 `flex:1` 요소인 라벨이 행마다 다른 폭을 차지하면서 그 뒤의 건수·성공률 칼럼 시작 위치가 행마다 밀렸다(배지가 있으면 라벨이 좁아져 칼럼이 왼쪽으로, 없으면 라벨이 넓어져 칼럼이 오른쪽으로). flex → **CSS Grid 고정 칼럼 템플릿**(`ROW_GRID_TEMPLATE = '1fr 64px 50px 76px 16px'`)으로 교체, 각 칸에 `gridColumn` 명시(grid auto-placement가 빈 칸을 건너뛰지 않게). `EventMatrixPanel`의 헤더 행도 같은 템플릿을 import해서 써서 헤더·본문 칼럼까지 완전히 정렬.
  - **버린 대안**: 없음 — 전부 실제 버그(2,4번)이거나 사용자의 재지적을 그대로 반영(3번)한 것으로, 대안을 저울질할 사안이 아니었음.
  - **구현**: `vite.config.mjs`(ACTIVE_STATS에 anomalies 추가, 폴백 문구 0건 분기 추가), `src/components/v2/reporting/SummaryBanner.jsx`(`isUrgent` 정규식화), `src/components/v2/reporting/SharedMetricRow.jsx`(`showBadge = failCount > 0`, flex→grid 전면 재작성, `ROW_GRID_TEMPLATE` export), `src/components/v2/reporting/EventMatrixPanel.jsx`(헤더가 `ROW_GRID_TEMPLATE` 재사용), `src/domain/operationalMetricsDomain.js`(더 이상 안 쓰는 `PCT_GOOD` export 제거 — 배지가 다시 failCount 기준이 되며 사용처가 없어짐).
  - 테스트: `tests/unit/s62.operational-metrics-summary.test.js` 관련 섹션 재작성(그리드 템플릿·gridColumn 5칸 모두 확인, isUrgent 정규식 확인). 배지 조건·isUrgent 정규식 각각 뮤테이션으로 테스트가 깨지는 것까지 확인. `isUrgent()`는 실제 문장 4개(0건/양수건/등급문구 2종)로 직접 node 실행해 참/거짓 확인. 브라우저 + `/api/stats` 직접 호출(콘솔 에러 0건)로 단일 숙소(P001·P002·P005·P010·P015) this_week/last_week 응답에 더 이상 `undefined`나 무조건적 "이상감지" 문구가 없음을 확인, ListView 전체 숙소 선택 시 표의 건수·성공률·배지 칼럼이 모든 행에서 완전히 세로로 정렬됨을 스크린샷으로 확인.
- **재검토 시점**: 없음(전부 실제 버그 수정 완료).

## [D-025] 대시보드 월 네비게이터를 ListView와 같은 모양으로 맞추고 레포트 패널 위로 (2026-09-24 확정)
- **결정**: 대시보드(MonthlyView)의 "지난달/이번달/다음달" 버튼(`MonthlyViewFilter`)을 ListView(`ListViewFilter`)의 "지난주/이번주/다음주" 버튼과 **완전히 같은 치수·색**으로 바꾸고, D-024와 같은 이유로 **레포트 패널(`SelectedPropertyReport`) 위**로 옮긴다.
  - **스타일**: 기존엔 가운데 정렬된 고정폭 칩(테두리 반경 8, active 파랑 `#2563eb`)이었던 걸, ListView와 동일하게 `flex:1` 균등폭 필(테두리 반경 20), active는 진한 남색(`#1a202c`) 배경 + 흰 글자, 가운데("이번달")는 `isCenter` 강조(`#f8fafc` 배경 / `#374151` 글자, ListView의 "오늘"/"이번주"와 같은 취급)로 바꿨다. 대시보드엔 ListView의 주/일 같은 두 번째 축(바이너리 토글)이 없어 그 부분만 없고, 3버튼 자체는 동일.
  - **순서**: [상태 필터/요약] → **[네비게이터]** → **[레포트 패널]** → [숙소 선택 드롭다운] → [캘린더] 로 변경(기존은 레포트 패널이 먼저, 네비게이터가 그다음). 숙소 선택 드롭다운·캘린더 순서는 그대로 둠(사용자가 요청한 범위는 네비게이터↔레포트 패널 자리바꿈뿐).
- **이유**: 사용자가 D-024(ListView)를 보고 "대시보드도 똑같이"로 요청. 같은 근거(통제판 역할을 하는 네비게이터가 레포트 패널 바로 위에 있어야 "이 조작 → 이 레포트"가 한눈에 읽힘)가 대시보드에도 적용됨.
- **버린 대안**: 없음 — ListView 패턴을 그대로 이식.
- **구현**:
  - `src/components/v2/reporting/MonthlyViewFilter.jsx` — 버튼 스타일을 `ListViewFilter`의 "수평 네비게이터" 섹션과 동일한 리터럴로 교체 (`flex:1`, `borderRadius:20`, 색상·폰트 전부 일치). `data-testid="monthly-view-filter"`는 유지(다른 테스트가 의존).
  - `src/components/v2/MonthlyView.jsx` — `<MonthlyViewFilter/>` JSX를 `<SelectedPropertyReport/>` 보다 앞으로 이동.
  - `tests/e2e/s40.dashboard.spec.js` — E2E-004의 레이아웃 순서 단언(`tops[0] < tops[1] < tops[2] < tops[3]`)을 새 순서(`monthFilter, report, propertySelect, calendar`)에 맞게 갱신. ⚠️ 이 테스트의 **다른** 단언(80번째 줄 근처, "레포트 요약 문장의 운영 문제 건수 == 캘린더 문제 배지 합계") 은 이번 변경과 무관하게 **이미 실패 중**이었다(같은 커밋을 그대로 `git stash`해서 재현 확인 — 날짜가 지나며 목업 데이터의 오늘 기준 이슈 집계가 드리프트하는 기존 결함으로 보임). 이번 작업 범위 밖이라 손대지 않음 — 별도 확인 필요.
  - 테스트: `tests/unit/s61.monthly-nav-style-reorder.test.js` (L2 — 스타일 리터럴 일치, `isCenter` 로직, JSX 순서). 순서를 되돌리는 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인. 레이아웃 순서는 실제 브라우저(Playwright)로 좌표 계산까지 직접 재현해 확인(`monthFilter.top(118) < report.top(163) < propertySelect.top(220) < calendar.top(268)`).
  - 브라우저로 직접 확인: 네비게이터 버튼 3개가 ListView와 동일한 필 모양·색으로 늘어나 있음, "지난달"/"다음달" 클릭 시 정상 동작(레포트·캘린더 갱신), "자세히" 펼치면 네비게이터 바로 아래 레포트, 그 아래 숙소 드롭다운, 그 아래 캘린더 순으로 보임.
- **재검토 시점**: `tests/e2e/s40.dashboard.spec.js`의 사전 존재 결함(운영 문제 건수 불일치)을 언젠가 고쳐야 함 — 이번 작업과 별개.

## [D-024] ListView — 네비게이터를 레포트 패널 위로 올려 "레포트 ↔ 하이라이트 박스" 인접시킴 (2026-09-24 확정)
- **결정**: PropertyListView(ListView)의 세로 배치 순서를 [상태 필터 바] → [레포트 패널] → [네비게이터(주/일 + 지난주/이번주/다음주)] → [타임라인] 에서 [상태 필터 바] → **[네비게이터]** → **[레포트 패널]** → [타임라인(D-022 하이라이트 박스)] 로 바꾼다. 네비게이터가 더 이상 레포트 패널과 타임라인 사이에 끼지 않으므로, 레포트 패널의 아래쪽 경계가 타임라인(하이라이트 박스가 있는 간트 헤더) 위쪽 경계에 바로 이어진다.
- **이유**: D-022로 "레포트 기간 = 타임라인의 테두리 박스" 기능을 만들었지만, 사용자가 "타임라인에 표시된 구간이 레포트에 해당하는 기간이라는 게 직관적으로 와닿지 않는다"고 재지적. 색을 맞추는 것(D-022의 `TENSE_STYLE` 재사용)만으로는 사용자가 "이 테두리 색 = 저 레포트 배지 색"이라는 걸 스스로 알아채야 해서 약했다. 사용자가 직접 제안한 해법 — 네비게이터를 레포트 패널 위로 올리면, 레포트 패널과 하이라이트 박스가 물리적으로 맞닿아 "이 조작(네비게이터) → 이 레포트 → 저 구간(하이라이트 박스)"이 위에서 아래로 한 흐름으로 읽힌다. 색 매칭 같은 추론 없이 배치만으로 관계가 보인다는 게 핵심.
- **범위**: ListView만 적용. DetailView(세로 스크롤 타임라인)는 같은 방식을 적용해도 하이라이트 박스가 스크롤 위치(항상 화면 30% 지점 — "지금" 마커가 바닥에 안 붙게 하려는 기존 설계, D-023)에 있어 레포트 패널과 "딱 붙는" 효과가 안 난다는 점을 확인하고 사용자가 보류를 선택함. 나중에 디테일뷰까지 하려면 스크롤 위치를 하이라이트 박스 상단이 뷰포트 맨 위에 오도록 바꾸는 방안까지 같이 검토해야 함(과거 맥락이 안 보이게 되는 트레이드오프 있음).
- **버린 대안**: 하이라이트 박스에 기간 이름 라벨을 얹거나, 박스 밖을 흐리게(스포트라이트) 하는 방안도 제안했으나, 사용자가 그보다 먼저 이 배치 변경 아이디어를 제시해 채택 — 서로 배타적이지 않으니 이후에도 라벨/스포트라이트를 추가로 얹는 건 가능.
- **구현**: `src/components/v2/PropertyListView.jsx` — `<ListViewFilter .../>` JSX 블록을 `{noSelection ? (...) : (<SummaryBanner>...<ReportPanel/></SummaryBanner>)}` 블록보다 앞으로 이동. 로직 변경 없는 순수 JSX 순서 변경(두 블록 다 형제 관계라 상태·props 의존성 없음).
  - 테스트: `tests/unit/s60.list-nav-above-report.test.js` (L2 — 소스에서 `<ListViewFilter`, `{noSelection ? (`, `간트 헤더 + 목록 래퍼` 세 앵커의 등장 순서를 확인, 사이에 다른 블록이 안 끼었는지 확인). 원래 순서로 되돌리는 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인.
  - 브라우저로 직접 확인(Playwright): "오늘"(일 모드) — 네비게이터 바로 아래 레포트 배너, "자세히" 펼치면 레포트 패널(오늘 레포트) 바로 아래에 간트 헤더+하이라이트 박스가 곧바로 이어짐. "이번주"(주 모드)도 동일하게 확인.
- **재검토 시점**: DetailView에도 적용하기로 하면, 스크롤 위치를 30%-지점 방식에서 하이라이트 박스 상단 고정 방식으로 바꿀지 사용자와 다시 논의.

## [D-023] DetailView 세로 타임라인에도 레포트 기간 하이라이트 적용 (2026-09-24 확정)
- **결정**: D-022(ListView)와 같은 기능을 PropertyDetailView(숙소 상세, 일/시 바이너리 토글 — D-015)의 세로 타임라인에도 적용한다. "지금 보고 있는 레포트가 타임라인의 어느 구간인지" 테두리 박스로 표시 — 시제 색(과거=회색/진행중=초록/미래=파랑, `TENSE_STYLE`)과 오버레이 방식(최상단, `pointerEvents: none`)은 ListView와 동일.
  - DetailView 타임라인은 ListView와 달리 **세로 + 픽셀 좌표**다(가로 스크롤이 아니라 위아래 스크롤, 위치는 `hourPx`라는 화면 높이에서 계산되는 시간당 픽셀 값으로 정해짐). 그래서 좌표 계산 자체(퍼센트 vs 픽셀)는 재사용하지 않고, 이 컴포넌트에 이미 있던 다른 모든 요소(시간 마커, 상태 바, "지금" 마커)와 같은 방식(`(시각 - windowStart) / 3600000 * hourPx`)으로 로컬 계산한다. 대신 "그 기간이 정확히 어느 날짜/시각인지"를 구하는 부분(`periodToDateRange`)은 ListView와 완전히 같은 함수를 그대로 재사용한다.
  - 일 모드(전날/오늘/내일)는 그대로 동작. 시 모드(−1h/지금/+1h)에서 **"지금"은 하이라이트가 안 뜬다** — `ReportPanel`이 `tense==='now'`일 때 애초에 레포트 자체를 안 보여주므로(기존 동작), 보여줄 레포트가 없으면 하이라이트도 없는 게 맞다.
  - **부가 수정**: 시 모드의 "−1h"(`last_hour`)를 테스트해보니 하이라이트가 안 떴다 — `periodToDateRange`가 `next_hour`는 처리하면서 `last_hour`는 빠져 있었다(기존부터 있던 사각지대, `getPeriodRange`쪽엔 이미 있었지만 이 함수엔 없었음). `next_hour`(`[지금+1분, 지금+1시간+1분)`)와 대칭으로 `last_hour = [지금-1시간, 지금)`을 추가해서 맞췄다.
- **이유**: 사용자가 ListView 기능을 본 뒤 "디테일뷰에서도 똑같이" 요청. 같은 문제(레포트 기간과 타임라인 위치의 대응관계가 안 보임)가 DetailView에도 그대로 있었다.
- **버린 대안**: 없음 — ListView와 같은 시각 언어(색·오버레이 방식)를 그대로 따르되, 좌표 계산만 이 화면의 기존 방식(픽셀)에 맞춤.
- **구현**:
  - `src/domain/periodDomain.js` — `periodToDateRange`에 `last_hour` 분기 추가(`next_hour`와 대칭).
  - `src/components/v2/reporting/ReportPanel.jsx` — (D-022에서 이미 export한) `TENSE_STYLE` 재사용.
  - `src/components/v2/PropertyDetailView.jsx` — `periodRange = periodToDateRange(statsPeriod)`, `periodHighlightPx = {top, height}`(픽셀, `[0, containerHeight]`로 클램프, 창 밖이면 null)를 `useMemo`로 계산. "지금" 마커 바로 위(렌더 순서상 먼저 — 지금 선이 그 위에 그대로 보이도록)에 `left:0, right:0`(가로 전체 폭) 테두리 박스 렌더링, `zIndex: 40`(이 화면의 기존 최고값인 청소 배정 인디케이터 35보다 위), `pointerEvents: 'none'`.
  - 테스트: `tests/unit/s59.detail-period-highlight.test.js` (L1: `periodToDateRange('last_hour')`가 `next_hour`와 대칭인지, `'now'`는 여전히 null인지. L2: 컴포넌트 배선·zIndex·렌더 순서·창 밖 처리 확인). `last_hour` 분기를 제거하는 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인.
  - 브라우저로 직접 확인(Playwright): 오늘(초록, 정확히 그날 자정~자정 경계), 내일(파랑, 9/25 자정부터), 과거(회색), −1h(회색, 지금 기준 정확히 1시간 전부터), +1h(파랑, 지금부터 1시간), 지금(하이라이트 없음 — ReportPanel도 안 보임)을 모두 확인.
- **재검토 시점**: 없음(요청대로 구현 완료).

## [D-022] ListView 타임라인에 현재 레포트 기간을 테두리 박스로 하이라이트 (2026-09-24 확정)
- **결정**: PropertyListView(ListView)에서 주/일 모드로 타임라인을 옮기면 그 위치에 맞는 레포트(D-017: "타임라인 위치를 그대로 따른다")가 뜨는데, 정작 타임라인 위에는 그 기간이 정확히 어디부터 어디까지인지 표시가 없었다. 그 기간(주 모드=해당 주 7일, 일 모드=그 하루)을 헤더~숙소 목록 전체를 관통하는 **테두리 박스**로 하이라이트한다.
  - 색은 ReportPanel의 시제 색(`TENSE_STYLE`)을 그대로 재사용 — **과거=회색(#475569) / 진행중=초록(#065f46) / 미래=파랑(#1e40af)**. 레포트 패널 헤더 바로 위에 있는 "🔄 이번 주 레포트" 같은 배지와 같은 색이라 별도 설명 없이도 "저 박스가 저 레포트를 가리키는구나"를 바로 알 수 있다.
  - 박스는 "지금" 세로선(가장 앞에 오버레이되는 기존 마커)과 같은 방식으로 구현 — `position: absolute`, `top:0, bottom:0`으로 헤더+숙소 목록 전체를 관통, `zIndex`를 가장 높게 줘서 맨 앞에 오버레이. 안은 아주 옅은(투명도 낮은) 같은 색 tint만 깔아 간트 바가 그대로 비치게 하고, `pointerEvents: none`으로 체크박스·숙소 클릭·드래그를 가로채지 않게 함.
  - 기간이 현재 보이는 타임라인 창을 완전히 벗어나면(너무 먼 과거/미래로 드래그) 박스를 아예 그리지 않는다. 창에 일부만 걸치면 보이는 부분만큼만 잘라서 그린다.
- **이유**: 사용자가 타임라인을 드래그해서 위치를 옮기면 레포트 기간도 D-017 규칙대로 같이 바뀌는데, 그 대응관계가 시각적으로 전혀 드러나지 않아 "지금 레포트가 정확히 며칠~며칠을 말하는 건지" 직관적으로 알기 어려웠다(사용자 지시: "레포트가 가리키는 기간이 어디인지 직관적으로 타임라인에서 보이지가 않아"). 특히 주 모드는 드래그 위치가 요일과 정확히 7일 배수로 안 맞아도 "가장 가까운 주"로 스냅되므로(D-017), 그 스냅된 정확한 7일 구간을 눈으로 확인할 수 있어야 한다.
- **버린 대안**: 없음 — 사용자가 제시한 방향(레포트와 통일성 있는 색의 테두리, 최상단 오버레이)을 그대로 구현.
- **구현**:
  - `src/domain/periodDomain.js` — `periodToWindowHighlight(period, windowStart, windowMs, nowMs)` 추가. `periodToDateRange`로 기간의 실제 날짜 범위를 구해 타임라인 창 기준 퍼센트 좌표(`{left, width}`)로 변환, 창 밖이면 `null`, 걸치면 `[0,100]`으로 클램프. UI 컴포넌트 안에 좌표 계산 로직을 두지 않고(CLAUDE.md 2-3: 화면↔비즈니스 로직 분리) 순수 함수로 분리해서 테스트 가능하게 함.
  - `src/components/v2/reporting/ReportPanel.jsx` — 기존 지역 상수 `TENSE_STYLE`을 `export`로 바꿔 다른 화면이 재사용할 수 있게 함.
  - `src/components/v2/PropertyListView.jsx` — `periodHighlight = periodToWindowHighlight(statsPeriod, windowStart, windowMs)`를 `useMemo`로 계산, "지금" 세로선 바로 옆에 테두리 박스 렌더링(`periodStyle.label` 색 2px 테두리 + 같은 색 5% 투명도 배경, `zIndex: 25`, `pointerEvents: 'none'`).
  - 테스트: `tests/unit/s58.period-highlight.test.js` (L1: `periodToWindowHighlight`의 좌표 계산·클램프·null 처리, L2: 컴포넌트 배선·시제 색 재사용·pointerEvents 확인). "창 밖이면 null" 가드를 일부러 제거하는 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인.
  - 브라우저로 직접 확인(Playwright): 대시보드 캘린더에서 "체류 7"(오늘) 클릭 → ListView 일 모드, 오늘(9/24) 칸에 초록 테두리 박스가 정확히 그 하루만큼 표시됨. 주 모드로 전환 시 이번 주(9/21~9/27) 전체에 초록 박스, "다음주" 클릭 시 파란 박스가 다음 주(9/28~10/4)로 정확히 이동, "지난주"를 두 번 눌러 2주 전으로 가면 회색 박스가 그 주(9/14~9/20)를 정확히 감싸는 것을 확인. 체크박스·숙소 클릭 등 다른 인터랙션에 방해 없음을 확인.
- **재검토 시점**: 없음(요청대로 구현 완료).

## [D-021] 대시보드 "이번달" 캘린더는 칸 단위로 과거/미래 포맷이 섞인다 (2026-09-24 확정)
- **결정**: 대시보드 캘린더의 "이번달" 탭에서, **오늘 이전** 날짜 칸은 기존처럼 그날의 "문제"(이상 감지) 배지를 보여주고, **오늘(포함)부터 월말까지**는 "다음달" 탭과 완전히 같은 포맷(체류/공실/입실/퇴실, 청소 배정 완료·미배정 — D-020)을 보여준다. "지난달"/"다음달"은 지금처럼 탭 전체가 한 포맷 그대로다. 즉 "어느 탭을 보고 있는가"가 아니라 "그 칸의 날짜가 지났는가"로 포맷을 정한다.
- **이유**: 이번달 탭은 과거(이미 지난 날)와 미래(아직 안 지난 날)가 한 화면에 같이 있는 유일한 탭이다. 지난 날은 실제로 무슨 일이 있었는지(문제 유무)를 보는 게 맞고, 아직 안 지난 날(오늘 포함)은 앞으로 뭐가 예정돼 있는지(체류/공실/입실/퇴실/청소배정)를 보는 게 맞다 — 사용자가 "이번달 캘린더에서 지금 이후의 값은 다음달 캘린더의 포멧으로 보여줘야지"로 명시적으로 요청.
- **버린 대안**: 이번달 탭 전체를 문제 배지 포맷 또는 미래 포맷 하나로 통일 — 지난 날엔 "체류/공실/청소배정" 같은 예정 정보가 의미 없고, 아직 안 지난 날엔 "그날 무슨 문제가 있었는지"를 알 수 없다(아직 안 일어났으므로). 탭 단위 이분법으로는 이번달 하나로 두 요구를 동시에 만족시킬 수 없어 칸 단위로 내림.
- **구현**:
  - `src/components/v2/reporting/MonthlyCalendar.jsx` — 기존 `isFutureMonth = statsPeriod === 'next_month'`(탭 단위)를 `cellIsFuture(cell) = cell.key >= nowMarker.dateKey`(칸 단위, `YYYY-MM-DD` 문자열 사전식 비교)로 교체. 두 렌더링 분기(미래 포맷 블록 / "문제" 배지)를 각각 `cellIsFuture(cell)`·`!cellIsFuture(cell)`로 전환.
  - `needsFutureData = statsPeriod === 'this_month' || statsPeriod === 'next_month'`(데이터 요청 범위 — 지난달은 그대로 제외)로 확장. 청소 배정 조회 기간 파라미터를 고정값 `'next_month'`에서 `statsPeriod` 그대로 사용하도록 변경(이번달이면 `this_month`로 요청).
  - `futureRange`도 `periodToRemainingRange(statsPeriod)`로 일반화 — `this_month`면 기존 `periodToRemainingRange`의 계약대로 "지금(호출 시각) ~ 월말"만, `next_month`면 월 전체.
  - 숙소 하나만 선택했을 때의 간트 막대(`stateSegments`)도 `this_month`일 땐 지난 실제 이벤트(`getGanttSegments`/`data.stateSegments`) + 오늘 이후 예약 예측(`buildFutureReservationSegments`)을 이어 붙이도록 확장(기존엔 `next_month`만 예측 막대를 그렸음).
  - 로딩/에러 상태(`displayLoading`/`displayError`), 칸 최소 높이(`minHeight`)도 `needsFutureData` 기준으로 통일.
  - 테스트: `tests/unit/s57.calendar-this-month-mixed.test.js` (L1: `periodToRemainingRange('this_month')`가 "지금부터"임을 재확인 + `buildFutureCalendarDays`가 오늘만 포함하고 어제는 제외함을 확인. L2: 위 소스 계약 전체를 정규식으로 검증, `isFutureMonth` 식별자가 완전히 제거됐는지도 확인). `needsFutureData`를 `next_month`로 되돌리는 뮤테이션을 줘서 테스트가 실제로 깨지는 것까지 확인함.
  - 브라우저로 직접 확인(Playwright): 이번달 탭에서 오늘 이전 날짜는 기존 날짜 숫자 + 문제 배지, 오늘엔 "지금" 마커와 함께 미래 포맷("체류 7 · 공실 13")이 같이 뜸, 오늘 이후 날짜는 체류/공실/입실/퇴실/청소배정 완료·미배정까지 다음달과 동일하게 표시, 미래 포맷 칸에서 "체류" 클릭 시 ListView로 정확한 날짜 오프셋·OCCUPIED 필터로 이동, "청소 배정 완료" 팝업에서 담당자 이름 표시, 과거 칸의 "문제" 팝업도 그대로 동작함을 확인.
- **재검토 시점**: 없음(요청대로 구현 완료). 향후 캘린더에 세 번째 시간대 구분(예: "이번주"처럼 더 세분화된 탭)이 추가되면 `cellIsFuture`/`needsFutureData` 같은 칸 단위 판단 패턴을 그대로 재사용할 것.

## [D-020] 대시보드 캘린더 칸의 체류/공실/입실/퇴실/청소배정을 각각 누를 수 있게 (2026-09-24 확정)
- **결정**: 대시보드(현황 대시보드) "다음달" 캘린더의 각 날짜 칸에 있는 값들을 각각 클릭 가능하게 만든다.
  - **체류 N** — 누르면 **ListView로 이동**해서 그 날짜(일 단위 오프셋)로 타임라인을 열고, "체류중" 필터를 적용한다.
  - **공실 N** — 같은 방식으로 ListView 이동 + "공실" 필터.
    - ListView의 이 필터는 그 특정 날짜의 예약 기준 점유 여부다 (`currentState`가 아님 — 미래 날짜엔 현재 상태를 쓸 수 없다). 캘린더가 이미 계산해 둔 그 날의 체류/공실 숙소 ID 목록을 그대로 넘겨써서, ListView가 다시 계산하지 않는다(한 곳에서만 계산 = 캘린더와 ListView 숫자가 항상 일치).
    - 이 날짜 지정 필터는 "체류중"/"공실" 칩에서만 적용되고, 그 세션(ListView를 벗어날 때까지) 동안 유지된다. 다른 칩(전체/청소중/입실전)을 누르면 평소처럼 현재 상태 기준으로 돌아간다.
  - **입실 N / 퇴실 N** — 팝업(DrilldownSheet)으로 그날 입실/퇴실하는 숙소 이름 목록.
  - **"청소 N" 한 줄** → **"청소 배정 완료 M" (일반 텍스트, 하이라이트 없음) · "청소 미배정 K" (빨간 배경 강조)** 두 줄로 분리.
    - **청소 배정 완료** 클릭 → 팝업으로 숙소별 **청소 담당자 이름** 목록.
    - **청소 미배정** 클릭 → 팝업으로 "배정 요청중 N건 / 수동배정 필요 N건 / 청소 계획 없음 N건"(아래 참고). 각 줄을 또 누르면(0건이면 안 눌림) 그 상태의 숙소별 상세 목록으로 팝업이 전환된다(D-018 형식 — 신호등 색, 급한 순. "청소 계획 없음"은 숙소 이름만).
- **버그 수정 (2026-09-24, 같은 날 후속) — "퇴실 6건인데 배정완료 1건이면 나머지는?"**: 처음 구현은 미배정 = 배정요청중 + 수동배정필요 였는데, 이건 **청소 잡이 아예 안 만들어진 체크아웃**을 빼먹는다(그날 체크아웃하는데 `cleaning_jobs` 행 자체가 없는 경우 — 실서비스에서도 캘린더 동기화가 늦거나 MONTHLY_BATCH 발동 전이면 생길 수 있음). 그래서 그 5건이 배정완료에도 미배정에도 안 잡혀 조용히 사라져 보였다(로직 문제). 개발 목업 데이터는 청소 잡을 체크아웃과 무관하게 임의 날짜로 만들고 있어서 이 문제가 실제보다 훨씬 두드러져 보였다(데이터 문제도 같이 있었음).
  - **로직 수정**: `classifyDayCleaningItems`에 **noJob**(그날 체크아웃하는데 잡이 없는 숙소) 분류 추가. **미배정 = 배정요청중 + 수동배정필요 + noJob** — 이제 "청소 배정 완료 + 청소 미배정"이 항상 "퇴실 N"과 같다.
  - **목업 데이터 수정**: dev 스텁의 청소 잡 `checkout_at`을 임의 날짜 대신 그 숙소의 **실제 예약 체크아웃**에서 가져오도록, 그리고 한 숙소가 두 분류(예: 배정완료·배정요청중)에 동시에 뽑혀 체크아웃 1건에 잡이 2개 생기지 않도록(숙소당 잡 최대 1개) 고쳤다. 브라우저로 달력 26일 전부를 훑어 "청소 배정 완료 + 청소 미배정 == 퇴실"이 다 맞는지 직접 확인함.
  - ⚠️ **레포트 패널(FutureMatrixPanel, D-019)에도 같은 유형의 차이가 있다** — "청소배정" 헤드라인의 배정완료/미배정 합계가 "퇴실예정" 건수와 다를 수 있다고 D-019에 이미 적어뒀다. 그건 **월 전체 합계**라 이번처럼 하루 단위로 정확히 맞추기가 더 어렵고, 사용자가 이번에 지적한 건 캘린더 화면이라 레포트 패널은 그대로 뒀다. 같은 방식(noJob)으로 맞추길 원하면 별도 작업 필요.
- **목업 숙소 청소 상태 — 다양하되 대부분(80%)은 배정완료 (2026-09-24, 같은 날 두 번째·세 번째 후속)**:
  1차: "실제로 201호만 운영 중이고 나머지(P001~P020)는 화면 확인용 목업이라, 목업 숙소가 배정요청중/실패/재요청 같은 가짜 경고를 보여주면 실제 운영과 무관한 노이즈가 된다"는 지적으로 **전부 ASSIGNED**로 만들었다가,
  2차: "모든 걸 배정완료로 해달라는 말을 정정 — 상태를 다양하게 하되 거의 80%는 배정완료로"로 바뀜 → **체크아웃(숙소+날짜)마다 80% 배정완료 / 10% 배정요청중 / 5% 배정실패 / 5% 배정요청필요(취소)**로 확률 분포를 줘서 최종 확정. 매 요청마다 값이 바뀌면 화면 확인이 어려우므로 진짜 난수 대신 `property_id+체크아웃시각` 문자열 해시로 0~99 값을 만들어 **같은 조건이면 항상 같은 결과**가 나오게 했다(새로고침해도 안 바뀜).
  - 이 변경은 **`vite.config.mjs`(로컬 dev 스텁)에만 적용**했다 — 프로덕션은 실제 Postgres `cleaning_jobs`를 그대로 읽으므로 "목업"이라는 개념이 서버에 없다. ⚠️ 다만 프로덕션에 P001~P020 목업 숙소가 그대로 노출된다면, 그 숙소들은 실제 `cleaning_jobs` 행이 전혀 없어 모든 체크아웃이 "청소 계획 없음"(빨강)으로 보일 것이다 — 이것도 노이즈가 될 수 있으니, 목업 숙소를 프로덕션 화면에서 아예 빼거나 청소 배정 계산에서 제외할지는 **별도로 확인 필요** (이번 요청은 로컬 dev 확인 기준으로만 처리함).
  - 10월 3·12·13일에 "청소 배정 완료"가 안 보인다는 지적도 같이 확인했는데, 이 세 날짜는 **그날 체크아웃이 0건**이라 정상이다(3일·13일은 입실도 0, 12일은 입실 4·퇴실 0) — 청소할 게 없으니 안 보이는 게 맞다. "미배정 없으면 배정완료를 일반 텍스트로"는 이미 그렇게 돼 있고(D-020 본문), 체크아웃이 있는 날에는 전부 "청소 배정 완료 N"(또는 미배정과 함께)이 정상 표시됨을 브라우저로 확인함.
- **이유**: 캘린더가 숫자만 보여주고 그 뒤에 어떤 숙소가 있는지 알 수 없었다. 특히 체류/공실은 "그 날짜에 이 상태인 숙소들을 보고 싶다"는 요청이라 캘린더 안에서 끝내지 않고 ListView(타임라인 전체 그림)로 보내는 게 맞다고 판단. 청소 배정 완료/미배정은 하이라이트 여부로 "볼 필요 없는 정보 vs 신경 써야 하는 정보"를 구분해 달라는 요청이었고, 숫자가 퇴실 건수와 안 맞는 건 눈에 보이는 실제 버그였다. 목업 숙소의 가짜 경고는 실제 운영(파주201 1곳)을 살피는 데 방해가 되는 노이즈라 없앴다.
- **버린 대안**: 체류/공실도 캘린더 안에서 팝업으로 숙소 이름만 나열 — 사용자가 명시적으로 "Listview의 해당 날짜로 가고, 필터 적용"을 요청함(팝업이 아니라 화면 전환) / ListView 필터를 손대지 않고 새 화면을 따로 만들기 — 기존 타임라인·선택·레포트가 이미 있는 화면을 재사용하는 게 더 맞음 / noJob을 "수동배정 필요"에 합치기 — 잡이 아예 없는 건 아직 시스템이 자동으로 처리할 여지가 있어(배치 미발동 등) "지금 당장 사람이 나서야 함"과는 다르다고 판단해 별도 분류로 둠 / 목업 숙소에 배정요청중/실패 상태를 일부 남겨 두기(데모용) — 사용자가 노이즈라고 명시적으로 요청해 전부 배정 완료로 통일.
- **구현**:
  - `src/domain/monthlyCalendarDomain.js` — `buildFutureCalendarDays`가 날짜별 `occupiedPropertyIds`/`vacantPropertyIds`/`checkInPropertyIds`/`checkOutPropertyIds`도 함께 반환(기존엔 개수만). `classifyDayCleaningItems(items, checkOutPropertyIds)`(배정완료/배정요청중/수동배정필요/**noJob**), `kstDayOffsetFromToday(dateKey, now)`(캘린더 날짜 → ListView의 일 단위 오프셋) 추가.
  - `src/components/v2/reporting/MonthlyCalendar.jsx` — `DayStat`(0건이면 안 눌림, 일반 텍스트), `CleaningDaySummary`(배정완료=DayStat 재사용/하이라이트 없음, 미배정=빨간 배경 pill), `SimpleListRow`, `AssignedCleanerRow`, `StatRow` 추가. `futurePopup` 상태로 입실/퇴실/배정완료/미배정/배정요청중/수동배정필요/**청소계획없음** 7종 팝업 관리. 새 prop `onNavigateToList(dayOffset, occupancy, {occupied, vacant})`.
  - `src/components/v2/MonthlyView.jsx` → `src/components/v2/RoomStateApp.jsx` — `onNavigateToList`가 `listFilter`/`listDayOffset`/`listJumpIds` 세 state를 채우고 `view='list'`로 전환. 기존 상단 상태칩(`onSelectStatus`)은 이 둘을 `null`로 초기화해 서로 안 섞이게 함.
  - `src/components/v2/PropertyListView.jsx` — 새 prop `initialDayOffset`(mount 시 `windowOffset` 초기값 + `listMode='day'`), `initialOccupantIds`(mount 시 한 번만 고정하는 `dayOccupantIds`). `filtered`·상단 칩 개수 계산 모두 `dayOccupantIds`가 있고 필터가 OCCUPIED/VACANT일 때 그걸 우선 사용.
  - `api/cleaning/[...slug].js` — `getCleaningStats`의 items 쿼리에 `LEFT JOIN cleaners`로 `cleaner_name` 추가(배정완료 목록의 담당자 이름용).
  - `vite.config.mjs`(dev 전용) — `/api/cleaning/stats` 목업이 그 숙소의 **모든** 실제 예약 체크아웃마다 잡을 만들되, `roll100(property_id+체크아웃시각)` 해시값으로 상태를 정한다(80% ASSIGNED / 10% PENDING / 5% ESCALATED / 5% CANCELLED, `STATUS_TABLE`). base 숫자(`assigned`/`requesting`/`failed`/`needsRequest`)는 항상 `items`에서 그대로 센다.
  - 테스트: `tests/unit/s56.calendar-day-actions.test.js`.
- **재검토 시점**: 실제 운영에서도 "체크아웃엔 있는데 잡이 없는" 케이스가 자주 보이면, 레포트 패널(월 전체 합계)에도 noJob 개념을 넣을지 검토. 프로덕션에 목업 숙소가 노출된다면 청소 계획 없음(빨강) 노이즈를 어떻게 뺄지 결정 필요. ListView 진입점이 더 늘어나면(예: DetailView에서도 날짜 지정 이동) `dayOccupantIds` 계산을 공용 도메인 함수로 옮기는 걸 고려.

## [D-015] 통계 UI 시간 계층 구조 (2026-08-08 확정)
- **결정**: List View = 주/일 바이너리 토글, Detail View = 일/시 바이너리 토글
- **이유**: 각 단위가 데이터이자 필터 역할 동시 수행. 모드가 명확히 구분되어 인지 부하 최소화.
- **월 단위**: 현재 UI 범위 외. API는 구현됨(`last_month` 등). 향후 별도 월 캘린더 뷰로 구현.
- **버린 대안**: 단일 타임라인에 모든 필터 나열 → 현재/과거/미래 맥락이 섞여 혼란

## [D-016] 숙소 식별자 = ListView에 표시되는 숙소 이름 (2026-09-19 확정)
- **결정**: `property_id`는 숙소 리스트에 표시되는 이름(예: `파주 201`). 화면(`liveProperty.id`), 청소 DB(`property_cleaning_config`·`cleaning_jobs`·`property_calendar_blockers`), 이벤트(Pi 워처 `areaName`)가 같은 이름을 키로 쓴다.
  - 이름을 바꾸면 키가 바뀌므로 서버가 이력을 새 이름으로 **한 트랜잭션**에서 이전한다 (`POST /api/cleaning/properties`의 `previous_property_id` → `renamePropertyId`). 대상 이름이 이미 다른 숙소로 등록돼 있으면 409, 아무것도 옮기지 않는다.
  - 레거시 `prop_<시각>` id는 앱 첫 로드 때 같은 경로로 자동 이전 (재실행 안전). 수동 확인·실행용 SQL: `scripts/migrate-property-id-to-name.sql`.
  - 이름 규칙: 쉼표 불가(`property_ids` 구분자와 충돌), 제어문자 불가, 60자 이하, 중복 불가.
- **이유**: 이벤트가 이미 `areaName`(=이름)으로 쌓이고 HA 영역 조회도 같은 이름을 쓴다. 화면 `LIVE_001` / 청소 DB `prop_<시각>` / 이벤트 이름이 제각각이라 숙소를 선택하면 서버가 0을 돌려주던 문제(R10)를 없앤다.
- **버린 대안**: 바뀌지 않는 별도 ID(`prop_<시각>`) 유지 + 이름은 표시용 — 이름 변경에는 안전하지만 이벤트 키(areaName)·HA 연동까지 바꿔야 해서 채택하지 않음 (사용자 결정).
- **주의**: 이름 = HA 영역 이름이므로 이름을 바꾸면 HA 영역도 같은 이름이어야 한다 (기존과 동일). 목업 숙소 ID(`P001`…)는 서버에 데이터가 없어 유지.
- **구현**: `src/domain/propertyIdentityDomain.js`, `src/infrastructure/propertyRenameRepository.js`, `api/cleaning/[...slug].js`(upsertProperty), `RoomStateApp.jsx`. 테스트: `tests/unit/s47.property-identity.test.js`.
- **재검토 시점**: 실숙소가 여러 개가 되어 이름 변경·중복이 잦아질 때.

## [D-017] 레포트 기간은 타임라인 위치를 그대로 따른다 + 취소된 청소는 재배정 요청 (2026-09-19 확정)
- **결정 1 — 기간**: ListView에서 타임라인을 2주 뒤로 넘기면 "다음 주" 레포트가 아니라 **2주 뒤 주**의 정보를 보여준다. 주 모드는 가장 가까운 주(…, 2주 전, 지난주, 이번 주, 다음 주, 2주 뒤, …), 일 모드는 그 날(…, 어제, 오늘, 내일, 2일 뒤, …). 숙소 상세(일 모드)도 그 날 그대로.
  - 기존 이름(`last_week`·`next_week`·`tomorrow` 등)은 그대로 두고, 그 밖의 오프셋만 `weeks_ahead_2`·`weeks_ago_3`·`days_ahead_2`·`days_ago_5`로 표기 (`periodForOffset` / `parseOffsetPeriod`).
  - 제목은 "2주 뒤 레포트 · 9/28~10/4"처럼 날짜 범위를 함께 표시 (몇 번째 주인지 헷갈리지 않게).
- **결정 2 — 청소 취소**: 청소가 취소(CANCELLED)되면 다시 배정을 요청해야 하므로 미래 레포트의 **"배정 요청 필요"**로 센다 ("배정 요청중"·"배정 실패"와 섞지 않음).
- **이유**: 화면이 보고 있는 시점과 레포트 시점이 어긋나면(2주 뒤를 보는데 다음 주 숫자) 운영자가 잘못된 정보로 판단한다. 취소된 청소를 무시하면 청소자 없이 퇴실일을 맞게 된다.
- **버린 대안**: 지난주/이번 주/다음 주 3단계로 뭉개기(±4일 임계값) — 2주 이상 넘기면 틀린 기간이 표시됨.
- **구현**: `src/domain/periodDomain.js`(기간 규칙), `reportingDomain.getPeriodRange`, `reportingService`(요약·미래 판정), `api/stats`·`api/stats/drilldown`(기간 허용), `PropertyListView`·`PropertyDetailView`·`ReportPanel`. 테스트: `tests/unit/s49.period-offsets.test.js`.

## [D-019] 미래 레포트(FutureMatrixPanel) 8줄 접기 + 세부는 팝업, 청소배정은 별도 섹션 (2026-09-24 확정)
- **적용 화면**: `FutureMatrixPanel` 하나를 ListView("다음주"/"내일" 등)와 **대시보드(현황 대시보드) "다음달" 탭**이 함께 쓴다 (`ReportPanel`이 `describePeriod(period).tense === 'future'`일 때 분기) — 사용자가 이 요청을 한 화면은 대시보드 쪽이었다.
- **결정**: 예약/청소배정/점유예측 8줄(체크인예정·체크아웃예정·배정완료·배정요청필요·배정요청중·배정실패·공실예정·체류예정)을 5줄로 접는다. 세부는 **팝업(DrilldownSheet, 딤 배경 + 바텀시트)** 으로 본다 — 인라인 아코디언 아님.
  - **체크인 예정 N건**, **퇴실예정 N건** — 각자 한 줄씩 **순차적으로**(위아래로, 나란히 아님), 클릭 없음, 청소 배정 숫자와 절대 섞이지 않는다. (1차 구현에서 퇴실예정 안에 청소 배정을 끼워 넣었다가 분리 요청 → 그다음 나란히 한 줄로 합쳤다가 "순차적으로"로 다시 되돌림)
  - **배정완료 N건**, **미배정 N건** — 완전히 별도 섹션("청소배정"), 이것도 각자 한 줄씩. 미배정은 0보다 크면 빨간색(기존 관례 유지), 누르면 팝업이 뜬다.
    - **미배정 팝업** = **배정 요청중 / 수동배정 필요** 두 줄만 (배정완료는 위에 이미 보이므로 팝업엔 넣지 않는다 — 사용자 지시로 뺌).
    - **수동배정 필요** = 기존 "배정 실패"(ESCALATED) + "배정 요청 필요"(CANCELLED, D-017)를 하나의 숫자로 합친 것 — 운영자 입장에선 둘 다 "내가 직접 사람을 구해야 하는 것"이라 하나로 묶었다.
    - **배정 요청중**과 **수동배정 필요** 둘 다 0건이면 안 눌리고, 0건이 아니면 눌러서(팝업 전환) 숙소별 상세 목록을 본다 — 두 목록 모두 같은 방식(D-018 형식: 신호등 색 또는 회색, 급한/가까운 순 정렬).
      - 배정 요청중 상세는 **회색(info)** 뿐이다 — 아직 시스템이 정상적으로 자동 진행 중인 상태라 급하다고 표시하지 않는다. 줄 문장은 `cleaning_jobs.status`를 그대로 보여주지 않고 "담당자를 찾고 있어요" 같은 문장으로 옮긴다(`describeCleaningIssue('requesting', …)`, 내부 상태명 노출 금지 원칙).
      - 배정 요청중 상세는 서버를 더 부르지 않고 `/api/cleaning/stats?items=true`가 이미 주는 `items`(전체 잡, 상태 포함)를 진행 중 상태로 걸러서 만든다.
    - 청소배정 숫자는 예약 줄의 퇴실예정 건수와 다를 수 있다 — 체크아웃은 예약(iCal)에서, 청소배정은 실제로 `cleaning_jobs`가 만들어진 것만 세기 때문(아직 잡이 안 만들어진 체크아웃도 있음). 둘을 억지로 맞추지 않는다.
  - **공실률 NN%** — 기존 "공실 예정"/"체류 예정" 두 줄을 하나로 합친 것. 누르면 팝업으로 "체류 N건 · 공실 N건"(숙소 수)을 보여준다. % 값 자체는 기존 `vacancyRate`와 동일(바뀐 적 없음).
- **이유**: 한 화면에 8줄이 다 펼쳐져 있어 복잡함. 점진적 공개 원칙(CLAUDE.md 2-4)에 맞게 접고, 필요할 때만 팝업으로 보게 함 (사용자 지시, 같은 날 네 차례 수정 끝에 확정).
- **보류 — 기기 준비 상태**: "입실예정 클릭 → 장치문제/장치상태" 표시도 제안됐으나 **이번엔 보류**. 실제 스마트기기가 연결된 숙소가 현재 파주201 하나뿐이라 나머지 19개는 값을 지어내야 화면이 채워짐 (사용자 결정: 지금은 빼고 나머지 둘만 먼저).
  - ⚠️ 재검토 시 참고: `src/domain/futureReportDomain.js`에 이미 `assessDeviceReadiness(haStates, now)`(오프라인 > 무응답 24h초과 > 배터리 20%미만 우선순위) 함수가 **테스트까지 완료된 채로 존재하지만 어떤 화면에도 연결돼 있지 않다** (`tests/unit/s39.future-report.test.js`). `GET /api/ha/all-states` 엔드포인트도 있음. 처음부터 새로 만들 필요 없이 이미 있는 걸 연결하기만 하면 됨 — 다만 지금은 HA 인스턴스가 1개(파주201)뿐이라 다른 숙소는 여전히 목업값이 필요.
- **버린 대안**: 8줄을 그대로 두고 색만 정리 — 화면이 여전히 복잡함 / 체크인·퇴실을 한 줄에 나란히 — "순차적으로"가 더 읽기 편하다는 피드백으로 되돌림 / 퇴실예정 안에 청소 배정 요약을 끼워 넣기 — 두 가지 다른 숫자(예약 vs 실제 잡)가 한 줄에 섞여 오해를 부름 / 배정완료·미배정을 한 줄에 괄호로 합치기 — 각자 줄로 나누고 싶다는 피드백으로 분리 / 미배정 팝업에 배정완료도 같이 보여주기 — 위에 이미 보이는 값을 반복할 필요 없음 / 세부를 인라인 아코디언으로 펼치기 — 화면에 있는 다른 모든 상세보기가 팝업(DrilldownSheet)이라 이질적임 (1~3차 시도, 같은 날 모두 폐기).
- **구현**: `src/components/v2/reporting/FutureMatrixPanel.jsx`(`Row`/`StatRow`, 팝업 상태 `unassignedPopup`/`occupancyPopup`/`manualOpen`/`requestingOpen`), `src/domain/violationDetailDomain.js`(`describeCleaningIssue`에 `kind: 'requesting'` 추가, `buildMixedCleaningIssueRows`). 테스트: `tests/unit/s55.future-panel-collapse.test.js`.
- **재검토 시점**: 실숙소가 2곳 이상이 돼서 기기 상태 데이터가 의미 있어질 때 — "입실예정" 클릭 상세 추가.

## [D-018] 레포트 상세 목록의 한 줄 = 숙소 이름 · 구어체 한 줄 설명 · 시간, 심각도는 색으로만 (2026-09-21 확정)
- **결정**: 레포트에서 건수를 누르면 뜨는 목록의 각 줄은 [신호등 점] [숙소 이름] [무슨 문제가 어떻게 있었는지 구어체 한 줄] [시간 ›]. 심각도는 글자·막대·요약 칩·기준 안내 없이 **줄의 색**(빨강 = 심각 / 주황 = 주의 / 초록 = 가벼움 / 회색 = 등급 없음)으로만 알리고, 색이 심한 건이 위로 오게 정렬한다.
  - 청소 시간 초과: 기준(3시간) 초과분 — 30분 미만 초록 / 30~60분 주황 / 60분 이상 빨강. "청소가 3시간 48분 걸렸어요 (기준 3시간보다 48분 더)"
  - 공실 에너지낭비: 켜져 있던 시간 — 1시간 미만 초록 / 1~3시간 주황 / 3시간 이상 빨강. "빈 숙소인데 전기가 2시간 10분 동안 켜져 있었어요" (꺼진 기록이 없으면 "…12일째 꺼진 기록이 없어요", 지금까지 경과로 색 결정)
  - 미래 배정 실패·요청 필요: 체크아웃까지 24시간 이내 빨강 / 그 밖 주황 — **초록은 쓰지 않는다**(문제가 있는데 초록이면 괜찮아 보임). "체크아웃이 2일 뒤인데 청소할 사람을 못 구했어요 (5명 중 2명 거절, 3명 무응답)"
  - 퇴실후 절전·보안, 청소후 보안, 입실전 최적화는 **등급을 나누지 않는다**(회색) — 건마다 크기를 재는 값이 없어서. 무슨 일이 있었는지만 문장으로 ("퇴실하고 12분 뒤에 조명·냉난방이 켜진 채로 감지됐어요")
- **이유**: "숙소 이름·날짜"만 보이면 어느 건이 심한지 알 수 없다. 그렇다고 등급 글자·막대·칩을 얹으면 오히려 읽을 게 많아진다 — 신호등 색이면 설명 없이 한눈에 판단된다 (사용자 지시).
- **버린 대안**: 심각·주의·경미 글자 태그 + 수치 막대 + 요약 칩 + 기준 안내 문구 + 경미한 줄 흐리게(1차 구현, 같은 날 폐기) / 모든 지표에 억지로 등급 붙이기 — 근거 없는 등급은 오판을 부른다.
- **주의**: 기준값(분·시간)은 제안값을 그대로 채택한 것 — 운영해 보고 조정 (`src/domain/violationDetailDomain.js` 상단 상수 한 곳). 색만으로 알리므로 문장에도 시간·인원 같은 사실은 그대로 남긴다.
- **구현**: `src/domain/violationDetailDomain.js`(문장·색 근거·정렬), `src/domain/metricDrilldownDomain.js`(앞뒤 이벤트 짝짓기), `reporting/ViolationRow.jsx`, `DrilldownSheet.jsx`, `FutureMatrixPanel.jsx`, `api/cleaning/[...slug].js`. 테스트: `tests/unit/s54.violation-detail.test.js`.

## [D-004] alert() → Toast 교체
- **결정**: `window.Toast` 전역 객체로 모든 alert 대체
- **이유**: 보안 감사 지적 + UX 개선. textContent로 XSS 차단.
- **구현 위치**: `src/utils/toast.js`

## [D-005] 라이트 테마 전환
- **결정**: 전체 색상 CSS 토큰 기반 라이트 테마 (`src/styles/main.css`)
- **이유**: 사용자 요청 — "가시성과 직관성이 부족해보임"
- **폰트**: Nunito + DM Sans + DM Mono
- **다크 색상 절대 재사용 금지**: `#02080d`, `#030f18`, `#0a1f2e`, `#00d4ff`, `#00ff88`

## [D-006] Node.js 내장 테스트 러너
- **결정**: Jest/Vitest 대신 `node:test` (Node.js 22 내장)
- **이유**: 의존성 없음. CI에서 `npm test`로 바로 실행.
- **실행**: `npm test` → `node --test tests/unit/*.test.js tests/functional/*.test.js`
- **저장 폴더 격리 (2026-09-19)**: 감시 프로그램(`server/occupancyWatcher.js`)·숙소 저장소(`server/propertiesStore.js`)는 `PROPOS_DATA_DIR`로 저장 폴더를 바꾼다. 이 모듈을 쓰는 테스트는 `tests/helpers/isolateDataDir.js`를 **가장 먼저** import 한다 — 안 그러면 테스트가 실제 `data/monitoring-*.json`(운영 중 감시 기록)을 덮어쓴다. `tests/unit/s50.test-data-isolation.test.js`가 강제한다.

## [D-008] Vite + src 단일 소스 오브 트루스
- **결정**: Vite 빌드 시스템 채택. `src/`가 정본. `dist/`는 빌드 산출물.
- **이유**: ESM import/export, HMR, 정상적인 빌드 파이프라인 필요.
- **배포 흐름**: `src/` 수정 → `npm run build` → `dist/` 자동 생성
- **버린 대안**: 단일 HTML 수동 편집 → 규모 커지면서 유지 불가

## [D-009] Config 공개/비공개 분리
- **결정**: 브라우저 공개 설정(`src/config/publicConfig.js`)과 Node 비공개 설정(`src/config/privateConfig.js`)을 분리
- **이유**: 정적 프런트 번들에 HA 토큰을 포함하면 민감정보가 그대로 노출됨
- **버린 대안**: 단일 config 파일에 토큰 포함 → 번들 노출 위험

## [D-011] HA 토큰 git 제외
- **결정**: `src/config/propos.config.json`을 `.gitignore`에 추가, git untrack
- **이유**: HA Long-Lived Access Token이 평문으로 포함됨 — git 히스토리에 남으면 안 됨
- **운영**: 로컬 파일(`src/config/propos.config.json`) 또는 환경변수(`PROPOS_HA_BASE_URL`, `PROPOS_HA_WS_URL`, `PROPOS_HA_TOKEN`)로 주입, 브라우저는 `src/config/propos.public.json`만 번들에 포함
- **재검토**: Vercel 환경변수로 전환 시 이 파일 구조 전면 교체

## [D-012] 브라우저 직접 HA 호출 금지
- **결정**: 브라우저는 Home Assistant를 직접 호출하지 않고 `/api/ha/*`만 사용
- **이유**: 토큰 노출 방지, 배포 환경별 보안 경계 일관화, UI 로직과 HA 인증 분리
- **구현 위치**: `src/infrastructure/haBrowserClient.js`, `server/haProxy.js`, `api/ha/*`
- **버린 대안**: 브라우저 번들에서 Bearer 토큰으로 HA REST/WebSocket 직접 호출

## [D-014] 데이터 저장 계층 분리 (2026-08-04 확정)
- **결정**: Vercel Postgres(진실 원천) + KV(캐시) + Blob(스냅샷 첨부) 3계층 분리
- **이유**: 히스토리 추적성·무결성 확보. 각 저장소를 특성에 맞게 사용.
- **설계 정본**: `docs/data-storage-design.md`
- **핵심 규칙**:
  - 쓰기 순서 고정: Postgres → KV → Blob → Slack
  - `@vercel/*` 패키지는 `api/` 폴더에서만 import (`src/` 금지 — Vite 빌드 오류)
  - `PROPOS_SLACK_WEBHOOK` 포함 모든 저장소 자격증명은 Vercel 환경변수만
  - 이벤트 타입 정본: `src/config/eventTypes.js` (Pi + Vercel 공유)
  - device_time = 표시·비즈니스 기준 / server_time = 삽입 순서 보장용
- **버린 대안**: Supabase 별도 도입 → Vercel 내장 스토리지로 충분
- **버린 대안**: Pi JSON 파일만 → Pi 장애 시 히스토리 접근 불가

## [D-010] 시나리오 레지스트리 경량화
- **결정**: `docs/scenarios.yaml`에 `entry_function` 추가, `content_keys` 제거
- **이유**: content_keys는 다이어그램/소스와 3중 중복이었고 기계 검증 없음. entry_function은 verify:scenarios가 source + diagram 양쪽 검증.
- **버린 대안**: s0X-interface-definitions / s0X-module-boundary 10개 파일 → 삭제
- **버린 대안**: docs/scenario-index.md + generate-scenario-index.mjs → 삭제

---

## 역사 섹션 (폐기된 결정 — 재제안 금지)

## [D-001] ~~단일 HTML 배포~~ → 폐기 (D-008로 대체)
- **당시 결정**: 빌드 없이 `index.html` 1개로 배포 (Netlify Drop)
- **폐기 이유**: Vite + src 구조(D-008)로 전환하면서 더 이상 유효하지 않음
- **현재**: `npm run build`로 `dist/` 생성, Netlify/Vercel에 배포

## [D-002] ~~Babel standalone CDN~~ → 폐기 (D-008로 대체)
- **당시 결정**: `<script type="text/babel">` 방식으로 브라우저 내 트랜스파일
- **폐기 이유**: Vite + @vitejs/plugin-react 채택으로 빌드 타임 트랜스파일로 전환
- **현재**: 표준 JSX, ESM import/export 사용 가능

## [D-003] ~~CSP 메타태그 제거~~ → 역사 기록
- **당시 결정**: Netlify Drop에서 CDN 차단으로 CSP 메타태그 삭제
- **현재**: Vite 빌드 + Netlify/Vercel 배포에서는 서버 헤더로 CSP 설정 가능
- **재검토**: Vercel 프로덕션 전환 시 `vercel.json`에서 CSP 설정 추가 예정

## [D-007] ~~개발/배포 분리 수동 구조~~ → 폐기 (D-008로 대체)
- **당시 결정**: `src/` 편집 후 `dist/index.html`에 수동 인라인 반영
- **폐기 이유**: Vite 도입으로 빌드가 자동화됨

## [D-013] 뷰 페르소나 구분 (2026-07-11 확정)
- **결정**: Admin 뷰(구 v1)와 PropertyManager 뷰(구 v2/rsm)를 별도 페르소나로 분리
- **Admin 뷰**: 시스템 장애 모니터링. CommandCenter, HomeAssistant, OperationsPortal. **유지 여부 미결정.**
- **PropertyManager 뷰**: 개별 숙소 상태 파악. RoomStateApp → Dashboard/List/Detail. **현재 활성 개발.**
- **버린 대안**: v1/v2 UI 버전 토글로 같은 앱에서 전환 → 페르소나가 다른 것이라 구분이 맞음

---

## 새 결정 추가 템플릿
```
## [D-XXX] 제목
- **결정**:
- **이유**:
- **버린 대안**:
- **재검토 시점**:
```
