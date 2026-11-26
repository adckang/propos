# PROPOS 소비자 행동 분석 전략

> 작성일: 2026-08-31  
> 도구: Microsoft Clarity (주력) + Vercel Analytics 무료 (보조)  
> 대상 페이지: `www.proposonline.com` (랜딩페이지)

---

## 1. 전략 원칙

### 왜 Clarity를 주력으로 쓰는가

| 항목 | Clarity | Vercel Analytics |
|---|---|---|
| 가격 | **무료** (제한 없음) | 무료 2,500이벤트/월, 초과 시 유료 |
| 세션 녹화 | ✅ 자동, 무제한 | ❌ 없음 |
| 히트맵 | ✅ 5종 자동 생성 | ❌ 없음 |
| 이상 감지 | ✅ 분노클릭·데드클릭 자동 | ❌ 없음 |
| 커스텀 이벤트 | ✅ 가능 | ✅ 가능 |
| 페이지뷰/유입경로 | 기본 제공 | 더 상세 |

→ **정성적 분석(왜)은 Clarity, 정량적 집계(얼마나)는 Vercel 무료 기본값 활용**

### 현재 단계 분석 범위

PROPOS는 현재 **랜딩페이지(B2B 마케팅) + 관리앱(운영자 1인)** 구조.

- **랜딩페이지**: 잠재고객이 여럿 방문 → 분석 가치 높음 ✅
- **관리 앱**: 사용자가 1명(관리자 본인) → N=1이라 통계 의미 없음 ❌ (고객 확장 시 재검토)
  - 2026-11-26 참고: 이 판단은 작성 당시(2026-08) 기준이다. 그 뒤 운영자 계정·숙소별 권한 기능이 생겼다(D-034·D-035). 실제 사용자가 늘면 위 판단을 다시 본다.

> 현재 모든 분석 에너지를 **랜딩페이지 전환율 개선**에 집중한다.

---

## 2. North Star Metric

```
문의 전환율 = inquiry_mail_open 수 / 총 방문자 수
```

- 이 숫자가 올라가면 랜딩페이지가 잘 작동하는 것
- 다른 모든 이벤트는 이 숫자가 낮을 때 **원인을 찾기 위한 도구**

> ⚠️ **Clarity 데이터 보존 기간: 30일** (공식 제한)  
> 월 루틴을 월 초에 실행해야 전달 데이터를 볼 수 있음. 늦으면 데이터 소멸.

---

## 3. 퍼널 구조 (6단계)

```
[1] 방문              → Clarity 자동 / Vercel 자동
         ↓
[2] feature_section_view  → 기능 설명까지 읽었는가
         ↓
[3] price_view            → 가격 섹션까지 내려갔는가
         ↓
[4] price_cta_click       → 가격 보고 CTA를 눌렀는가
         ↓
[5] consultation_section_view → 최하단 문의 섹션 도달
         ↓
[6] inquiry_mail_open     → 실제 메일 문의 시작 ← North Star
```

### 이탈률 읽는 법

| 단계 이탈률 | 의미 | 개선 방향 |
|---|---|---|
| 1→2 이탈 큼 | 히어로 섹션에서 포기 | 헤드카피·첫인상 개선 |
| 2→3 이탈 큼 | 기능 설명이 설득 못 함 | 구체적 수치/사례 추가 |
| 3→4 이탈 큼 | 가격이 너무 비싸거나 불명확 | 가격 정책 재검토 |
| 4→5 이탈 큼 | CTA 위치/문구 문제 | CTA 개선 |
| 5→6 이탈 큼 | 문의 방법이 불편함 | 메일 대신 폼/카카오 추가 검토. 모바일에서 메일 앱 미설치 시 이탈 발생 가능 |

---

## 4. 구현된 이벤트 목록

모두 `src/lib/analytics.js`의 `trackEvent()` 함수를 통해 Clarity + Vercel Analytics 동시 발송.

| 이벤트명 | 발생 시점 | 퍼널 단계 | 구현 위치 |
|---|---|---|---|
| `feature_section_view` | Scene04(청소 모니터) 진입 — Scene01~04를 다 본 것의 신호 | 2 | LandingPageV1.jsx |
| `price_view` | 가격 섹션 35% 진입 (IntersectionObserver) | 3 | LandingPageV1.jsx |
| `hero_cta_click` | 히어로 CTA 클릭 — 즉각 관심 표현 신호 (engagement) | 보조 | LandingPageV1.jsx |
| `price_cta_click` | 가격 플랜 CTA 클릭 → 자동으로 consultation 스크롤 | 4 | LandingPageV1.jsx |
| `consultation_section_view` | 문의 섹션 30% 진입. CTA 클릭 없이 직접 스크롤로 도달한 경우 포착 | 5 | LandingPageV1.jsx |
| `faq_open` | FAQ 항목 열기 — 정보 부족/의심 신호 (engagement) | 보조 | LandingPageV1.jsx |
| `inquiry_mail_open` | 운영진단 요청 메일 버튼 클릭 | 6 (전환) | LandingPageV1.jsx |

> **4→5 관계 주의**: `price_cta_click`이 발생하면 코드가 자동으로 consultation 섹션으로 스크롤하므로  
> `consultation_section_view`도 거의 동시에 발생. 단계 5의 고유 의미는 "CTA 없이 직접 스크롤로 도달".

### analytics.js 구조

```js
// src/lib/analytics.js
export function trackEvent(eventName, properties = {}) {
  // Clarity로 전송
  window.clarity("event", eventName);
  // Vercel Analytics로 전송
  vercelTrack(eventName, properties);
}
```

### 환경변수

| 변수명 | 용도 | 설정 위치 |
|---|---|---|
| `VITE_CLARITY_PROJECT_ID` | Clarity Space Host 프로젝트 연결 | Vercel 환경변수 |

---

## 5. Clarity 대시보드 활용법

### 5-1. 히트맵 — "어디를 클릭하는가"

**경로**: Clarity → Space Host → Heatmaps → `www.proposonline.com` 선택

| 보는 것 | 판단 기준 |
|---|---|
| 빨간 영역 | 클릭 집중 → 잘 작동하는 CTA 확인 |
| 버튼인데 클릭 없음 | 눈에 안 띄거나 위치 문제 |
| 버튼 아닌 곳에 클릭 집중 | 클릭 가능한 요소인 줄 오해 → UI 혼란 |

**스크롤맵 보는 법**:
- 50% 선 = 방문자 절반이 이 아래로 내려가지 않음
- 가격 섹션이 50% 선보다 아래 있으면 대부분 가격을 못 보고 이탈

### 5-2. 세션 녹화 — "왜 안 눌렀는가"

**경로**: Clarity → Recordings

우선 필터링 순서:
1. **Dead Clicks 필터** → 반응 없는 요소를 클릭하는 사람 찾기
2. **Rage Clicks 필터** → 답답해서 연속 클릭하는 사람 찾기
3. **Quick Back 필터** → 들어오자마자 나간 사람 행동 패턴

녹화 볼 때 주목할 것:
- CTA 직전에 스크롤 올리고 나가는 패턴 → 의심/불신 신호
- 가격 섹션에서 오래 멈추는 패턴 → 가격 문제 신호
- FAQ 여러 개 연속으로 여는 패턴 → 정보 부족 신호

### 5-3. 커스텀 이벤트 확인

**경로**: Clarity → Insights → Events

`inquiry_mail_open`, `price_cta_click` 등 trackEvent로 심은 이벤트 집계 확인.
Segments 기능으로 "inquiry_mail_open을 한 사용자"의 세션만 필터링해서 녹화 보기 가능.

---

## 6. 정기 분석 루틴 (권장)

### 월 1회 (매월 1~3일 이내 실행 — 30분)

> ⚠️ Clarity는 30일 데이터만 보관. 월 초에 실행하지 않으면 전달 데이터 소멸.

```
1. Clarity Events: inquiry_mail_open 발생 횟수 (전달 데이터 우선 확인)
2. Vercel Analytics: 이번 달 방문자 수 / 지난달 대비
3. 전환율 계산: inquiry_mail_open 수 / 방문자 수
4. 전환율 낮으면 → Clarity 녹화 10개 보기 (Dead Clicks 필터 우선)
5. 개선 포인트 1개 선정 → 수정 → 다음 달 재측정
```

### 개선 사이클 원칙

> 숫자(Vercel/Clarity Events)로 문제 발견 → 영상(Clarity 녹화)으로 원인 확인 → 1가지만 수정 → 재측정

한 번에 여러 개 바꾸면 뭐 때문에 좋아졌는지 알 수 없음.

---

## 7. Phase 2 — 앱 내 분석 (고객 10인 이상 시 재검토)

현재는 관리자 1인이라 앱 내 이벤트 추적이 통계적으로 무의미.  
고객이 늘어나는 시점에 아래 이벤트 추가 설계:

```
nav_tab_switch          어느 화면을 주로 쓰는가
property_detail_open    숙소 상세 얼마나 자주 보는가
cleaning_manager_open   청소 관리 기능 사용 빈도
cleaner_add_start       청소자 관리 부담도
calendar_sync_manual    자동화 실패로 수동 개입 빈도
```

North Star (Phase 2): `자동화율 = 웹훅 자동 배정 / 전체 청소 배정`  
→ 이건 DB 쿼리(`cleaning_jobs` 테이블)로도 바로 조회 가능:

```sql
SELECT
  COUNT(*) FILTER (WHERE google_event_id IS NOT NULL) AS auto_assigned,
  COUNT(*) AS total,
  ROUND(COUNT(*) FILTER (WHERE google_event_id IS NOT NULL)::numeric / COUNT(*) * 100, 1) AS auto_rate_pct
FROM cleaning_jobs
WHERE created_at >= NOW() - INTERVAL '30 days';
```

---

## 8. 하지 않기로 한 것 (결정 기록)

| 항목 | 이유 |
|---|---|
| 앱 내 클릭 이벤트 전수 추적 | N=1 데이터, 통계 의미 없음 |
| 서버 자동화 이벤트를 Clarity로 전송 | 도구 레이어 혼동. Slack 알림/DB 로그가 올바른 채널 |
| Vercel Analytics 유료 전환 | Clarity 무료로 정성분석 충분, 비용 대비 효과 낮음 |
| 스크롤/줌/제스처 별도 이벤트 | Clarity 세션 녹화가 자동으로 시각화해줌 |
| 20~30개 이벤트 전량 구현 | 지금 단계에서 분석 마비(Analysis Paralysis) 유발 |
