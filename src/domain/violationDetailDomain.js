/**
 * violationDetailDomain — 레포트 "위반·문제 건" 목록의 한 줄 (순수 함수)
 *
 * 레포트에서 건수를 누르면 뜨는 목록의 한 줄 = [숙소 이름] [무슨 문제가 어떻게 있었는지 구어체 한 줄] [시간].
 * 심각도는 글자·막대로 설명하지 않는다 — 줄의 색(빨강 / 주황 / 초록)만으로 알 수 있게 하고,
 * 이 파일은 "어떤 색으로 그릴지"의 근거(severity)와 문장, 정렬 순서(심한 건이 위)만 계산한다.
 *
 * 과거 레포트(위반 6지표)와 미래 레포트(청소 배정 실패 / 배정 요청 필요)를 모두 다룬다.
 * 화면 코드와 분리된 순수 함수라 서버·화면·테스트가 같은 규칙을 쓴다.
 *
 * 심각도를 수치로 나누는 지표: 청소 시간 초과, 공실 에너지낭비, (미래) 배정 실패·요청 필요
 * 나머지 지표(퇴실후 절전·보안, 청소후 보안, 입실전 최적화)는 건마다 크기를 재는 값이 없으므로
 * 등급을 나누지 않고(info → 중립색) 무슨 일이 있었는지만 문장으로 알려준다 — 근거 없는 등급을 만들지 않는다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIN_MS  = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS  = 24 * HOUR_MS;

// ── 심각도 (색 결정용) ────────────────────────────────────────────────────────
// severe → 빨강 / caution → 주황 / minor → 초록 / info → 중립(등급 없음)
export const SEVERITY = Object.freeze({
  SEVERE:  'severe',
  CAUTION: 'caution',
  MINOR:   'minor',
  INFO:    'info',
});

// 정렬 순서 — 작을수록 위 (심한 건이 위, 등급 없는 건은 맨 아래)
const SEVERITY_RANK = Object.freeze({ severe: 0, caution: 1, minor: 2, info: 3 });

// ── 기준값 (사용자가 바꾸고 싶을 때 이 한 곳만 고친다) ─────────────────────────
/** 청소: 기준 시간(3시간)을 넘긴 "초과 분" — 미만이면 경미, 이상이면 주의/심각 */
export const CLEANING_OVER_MIN = Object.freeze({ caution: 30, severe: 60 });
/** 공실 에너지 낭비: 켜져 있던 "분" */
export const VACANT_ENERGY_MIN = Object.freeze({ caution: 60, severe: 180 });
/**
 * 청소 배정 문제: 체크아웃까지 남은 "시간" — 이 안이면 빨강, 그 밖은 주황.
 * 배정 실패·요청 필요는 남은 시간과 상관없이 해결해야 할 일이라 "괜찮음"을 뜻하는 초록은 쓰지 않는다.
 */
export const CHECKOUT_URGENCY_HOURS = Object.freeze({ severe: 24 });

const DEFAULT_CLEANING_LIMIT_HOURS = 3;

// ── 시간 표시 도우미 (KST 고정 — 실행 환경 시간대와 무관) ───────────────────────
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function toMs(raw) {
  if (raw == null) return null;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function kstParts(ms) {
  const d = new Date(ms + KST_OFFSET_MS);
  return {
    month: d.getUTCMonth() + 1,
    day:   d.getUTCDate(),
    wd:    WEEKDAYS[d.getUTCDay()],
    hh:    String(d.getUTCHours()).padStart(2, '0'),
    mm:    String(d.getUTCMinutes()).padStart(2, '0'),
  };
}

/** "09/18 14:20" — 행 오른쪽의 발생 시각 */
export function formatKstDateTime(raw) {
  const ms = toMs(raw);
  if (ms == null) return '—';
  const { month, day, hh, mm } = kstParts(ms);
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${hh}:${mm}`;
}

/** "14:20" */
export function formatKstTime(raw) {
  const ms = toMs(raw);
  if (ms == null) return '—';
  const { hh, mm } = kstParts(ms);
  return `${hh}:${mm}`;
}

/** "9/28(일) 11:00" — 미래 청소 목록의 체크아웃 시각 */
export function formatKstDayTime(raw) {
  const ms = toMs(raw);
  if (ms == null) return '—';
  const { month, day, wd, hh, mm } = kstParts(ms);
  return `${month}/${day}(${wd}) ${hh}:${mm}`;
}

/**
 * 분 → 사람이 읽는 길이. 48 → "48분", 65 → "1시간 5분", 180 → "3시간", 1600 → "1일 2시간"
 * 1분 미만은 "1분 미만".
 */
export function formatDuration(totalMinutes) {
  const total = Math.round(totalMinutes);
  if (!Number.isFinite(total) || total < 1) return '1분 미만';
  if (total < 60) return `${total}분`;
  if (total < 24 * 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
  }
  const d = Math.floor(total / (24 * 60));
  const h = Math.floor((total % (24 * 60)) / 60);
  return h === 0 ? `${d}일` : `${d}일 ${h}시간`;
}

function severityByMinutes(minutes, { caution, severe }) {
  if (minutes >= severe)  return SEVERITY.SEVERE;
  if (minutes >= caution) return SEVERITY.CAUTION;
  return SEVERITY.MINOR;
}

/** 등급 없는 건 (중립색) */
function plainView(text) {
  return { severity: SEVERITY.INFO, text, sortKey: 0 };
}

// ══════════════════════════════════════════════════════════════════════════════
// 과거 레포트 — 위반 6지표
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 위반 한 건의 화면 표시 값.
 *
 * @param {string} metric  cleaning_time | post_checkout_energy | post_checkout_security |
 *                         vacant_energy | post_cleaning_security | pre_stay_optimization
 * @param {{ occurred_at: any, detail?: object }} item  /api/stats/drilldown 의 항목
 * @param {number} [now]   진행 중인 건(아직 안 꺼진 전기 등)의 경과 시간 계산 기준
 * @returns {{
 *   severity: 'severe'|'caution'|'minor'|'info',  줄 색을 고르는 근거 (빨강/주황/초록/중립)
 *   text: string,      무슨 문제가 어떻게 있었는지 구어체 한 줄
 *   sortKey: number,   클수록 심함 (같은 심각도 안에서의 순서)
 * }}
 */
export function describeViolation(metric, item, now = Date.now()) {
  const detail = item?.detail ?? {};
  const occurredMs = toMs(item?.occurred_at);

  switch (metric) {
    case 'cleaning_time': {
      const durationH = Number(detail.duration_hours);
      if (!Number.isFinite(durationH)) return plainView('청소 시간이 기준을 넘었어요');
      const limitH = Number.isFinite(Number(detail.limit_hours)) ? Number(detail.limit_hours) : DEFAULT_CLEANING_LIMIT_HOURS;
      const durationMin = durationH * 60;
      // 초과분이 반올림으로 0분이 되어 "0분 더"로 보이지 않게 최소 1분
      const overMin = Math.max(1, Math.round(durationMin - limitH * 60));
      return {
        severity: severityByMinutes(overMin, CLEANING_OVER_MIN),
        text: `청소가 ${formatDuration(durationMin)} 걸렸어요 (기준 ${limitH}시간보다 ${formatDuration(overMin)} 더)`,
        sortKey: overMin,
      };
    }

    case 'vacant_energy': {
      const resolvedMs = toMs(detail.resolved_at);
      if (occurredMs != null && resolvedMs != null && resolvedMs > occurredMs) {
        const minutes = (resolvedMs - occurredMs) / MIN_MS;
        return {
          severity: severityByMinutes(minutes, VACANT_ENERGY_MIN),
          text: `빈 숙소인데 전기가 ${formatDuration(minutes)} 동안 켜져 있었어요`,
          sortKey: minutes,
        };
      }
      // 꺼졌다는 기록이 없다 — 지금까지 켜져 있는 것으로 보고 경과 시간으로 판단
      const elapsedMin = occurredMs != null ? Math.max(0, (now - occurredMs) / MIN_MS) : 0;
      return {
        severity: severityByMinutes(elapsedMin, VACANT_ENERGY_MIN),
        text: `빈 숙소인데 전기가 켜진 채로 ${formatDuration(elapsedMin)}째 꺼진 기록이 없어요`,
        sortKey: elapsedMin,
      };
    }

    case 'post_checkout_energy':
      return plainView(withReason(
        `${afterAnchor(detail, occurredMs, '퇴실하고', '퇴실 후에')} 조명·냉난방이 켜진 채로 감지됐어요`,
        detail,
      ));

    case 'post_checkout_security':
      return plainView(withReason(
        `${afterAnchor(detail, occurredMs, '퇴실하고', '퇴실 후에')} 문·창문·재실 센서에 반응이 잡혔어요`,
        detail,
      ));

    case 'post_cleaning_security':
      return plainView(withReason(
        `${afterAnchor(detail, occurredMs, '청소가 끝나고', '청소가 끝난 뒤에')} 문·창문·재실 센서에 반응이 잡혔어요`,
        detail,
      ));

    case 'pre_stay_optimization':
      return plainView(
        occurredMs != null
          ? `입실 준비 시간(${formatKstTime(occurredMs)})이 지났는데 숙소 준비가 끝났다는 기록이 없어요`
          : '입실 준비 시간이 지났는데 숙소 준비가 끝났다는 기록이 없어요',
      );

    default:
      return plainView('');
  }
}

/** "퇴실하고 12분 뒤에" — 기준 이벤트가 있으면 얼마 뒤였는지, 없으면 시간 없이 ("퇴실 후에") */
function afterAnchor(detail, occurredMs, withTime, withoutTime) {
  const anchorMs = toMs(detail.anchor_at);
  if (anchorMs != null && occurredMs != null && occurredMs >= anchorMs) {
    return `${withTime} ${formatDuration((occurredMs - anchorMs) / MIN_MS)} 뒤에`;
  }
  return withoutTime;
}

/** 이벤트에 기록된 사유가 있으면 문장 끝에 그대로 덧붙인다 */
function withReason(sentence, detail) {
  const reason = typeof detail.reason === 'string' ? detail.reason.trim() : '';
  return reason ? `${sentence} (${reason})` : sentence;
}

/**
 * 목록 화면에 그릴 행 = 항목 + 표시 값. 심한 순 → 같은 심각도는 수치가 큰 순 → 최근 순.
 * 등급을 나누지 않는 지표는 최근 발생 순으로만 정렬한다.
 * 입력 배열은 바꾸지 않는다.
 */
export function buildViolationRows(metric, items, now = Date.now()) {
  const rows = (items ?? []).map(item => ({ item, view: describeViolation(metric, item, now) }));
  return rows.sort((a, b) => compareRows(a, b, item => toMs(item.occurred_at) ?? 0));
}

function compareRows(a, b, recencyOf) {
  const rankDiff = SEVERITY_RANK[a.view.severity] - SEVERITY_RANK[b.view.severity];
  if (rankDiff !== 0) return rankDiff;
  if (b.view.sortKey !== a.view.sortKey) return b.view.sortKey - a.view.sortKey;
  return recencyOf(b.item) - recencyOf(a.item);
}

// ══════════════════════════════════════════════════════════════════════════════
// 미래 레포트 — 청소 배정 실패 / 배정 요청 필요
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 청소 배정 문제(또는 진행 상태) 한 건의 화면 표시 값.
 * failed/needsRequest 는 운영자가 직접 나서야 하는 건이라 체크아웃이 24시간 이내면 빨강, 그 밖은 주황(초록 없음).
 * requesting 은 시스템이 아직 자동으로 진행 중인 정상 상태라 색을 매기지 않는다(회색·info) — 볼 건 있지만 급하진 않음.
 *
 * @param {'failed'|'needsRequest'|'requesting'} kind
 *   failed=배정 실패(청소자를 못 구함) · needsRequest=취소돼 다시 요청 필요 · requesting=자동 배정 요청 진행 중
 * @param {{ checkout_at: any, updated_at?: any, notified_count?: number, declined_count?: number, status?: string }} item
 * @param {number} [now]
 * @returns {{ severity, text: string, when: string, sortKey: number }}  when = 체크아웃 시각 ("9/23(수) 11:00")
 */
export function describeCleaningIssue(kind, item, now = Date.now()) {
  const checkoutMs = toMs(item?.checkout_at);
  const hoursLeft = checkoutMs != null ? (checkoutMs - now) / HOUR_MS : null;
  const when = checkoutMs != null ? formatKstDayTime(checkoutMs) : '—';
  const lead = hoursLeft != null ? `${describeCheckoutLead(hoursLeft, checkoutMs, now)} ` : '';
  const sortKey = hoursLeft != null ? -hoursLeft : -Infinity; // 남은 시간이 짧을수록 큰 값 (급한 게 위로)

  if (kind === 'requesting') {
    return { severity: SEVERITY.INFO, text: `${lead}${describeRequesting(item)}`, when, sortKey };
  }

  let severity = SEVERITY.CAUTION;
  // 이미 지난 체크아웃(음수)도 가장 급하다
  if (hoursLeft != null && hoursLeft <= CHECKOUT_URGENCY_HOURS.severe) severity = SEVERITY.SEVERE;

  const problem = kind === 'failed' ? describeFailed(item) : describeCancelled(item, now);
  return { severity, text: `${lead}${problem}`, when, sortKey };
}

/** "체크아웃이 5시간 뒤인데" / "체크아웃이 내일인데" / "체크아웃이 3일 뒤인데" / "체크아웃 시간이 3시간 지났는데" */
function describeCheckoutLead(hoursLeft, checkoutMs, now) {
  if (hoursLeft < 0) return `체크아웃 시간이 ${formatDuration(-hoursLeft * 60)} 지났는데`;
  if (hoursLeft < 24) return `체크아웃이 ${formatDuration(hoursLeft * 60)} 뒤인데`;
  // 달력상 며칠 뒤인지 (KST 날짜 차이) — "내일"/"N일 뒤"
  const days = Math.floor((checkoutMs + KST_OFFSET_MS) / DAY_MS) - Math.floor((now + KST_OFFSET_MS) / DAY_MS);
  return days <= 1 ? '체크아웃이 내일인데' : `체크아웃이 ${days}일 뒤인데`;
}

function describeFailed(item) {
  const asked = Number(item?.notified_count);
  if (!Number.isFinite(asked) || asked <= 0) return '청소할 사람을 아직 못 구했어요';
  const declined = Math.min(asked, Math.max(0, Number(item?.declined_count) || 0));
  const silent = asked - declined;
  let detail;
  if (declined === asked)      detail = `${asked}명 모두 거절`;
  else if (declined === 0)     detail = `${asked}명 모두 무응답`;
  else                         detail = `${asked}명 중 ${declined}명 거절, ${silent}명 무응답`;
  return `청소할 사람을 못 구했어요 (${detail})`;
}

function describeCancelled(item, now) {
  const cancelledMs = toMs(item?.updated_at);
  if (cancelledMs == null || cancelledMs > now) return '취소된 청소를 다시 요청해야 해요';
  return `취소된 청소를 다시 요청해야 해요 (${formatDuration((now - cancelledMs) / MIN_MS)} 전에 취소됨)`;
}

// cleaning_jobs.status 내부 코드를 그대로 보여주지 않고 단계를 문장으로 옮긴다 (content-guide 원칙: 내부 상태명 노출 금지)
const REQUESTING_STAGE_TEXT = Object.freeze({
  PENDING:          '담당자를 찾고 있어요',
  NOTIFYING_VIP_1:  '우선순위 청소자에게 요청했어요',
  NOTIFYING_VIP_2:  '우선순위 청소자에게 다시 요청했어요',
  NOTIFYING_VIP_3:  '우선순위 청소자에게 재차 요청했어요',
  NOTIFYING_BULK:   '전체 청소자에게 요청을 넓혔어요',
  BULK_REMINDED:    '전체 청소자에게 다시 알렸어요',
});

function describeRequesting(item) {
  return REQUESTING_STAGE_TEXT[item?.status] ?? '청소 배정을 요청하고 응답을 기다리고 있어요';
}

/** 청소 배정 문제 목록 행 — 체크아웃이 가까운 순 */
export function buildCleaningIssueRows(kind, items, now = Date.now()) {
  const rows = (items ?? []).map(item => ({ item, view: describeCleaningIssue(kind, item, now) }));
  return rows.sort((a, b) => compareRows(a, b, () => 0)); // 남은 시간이 같으면 원래 순서 유지
}

/**
 * "수동배정 필요" 목록 — 배정 실패(failed)와 배정 요청 필요(needsRequest)를 한 목록으로 합쳐
 * 체크아웃이 가까운 순으로 정렬한다. 둘 다 "운영자가 직접 나서야 하는 건"이라 화면에서는 한 덩어리로
 * 보여주고, 줄마다는 각자의 사정("사람을 못 구했어요" / "취소돼서 다시 요청해야 해요")을 그대로 보여준다.
 *
 * @param {Array<{ kind: 'failed'|'needsRequest', item: object }>} entries
 */
export function buildMixedCleaningIssueRows(entries, now = Date.now()) {
  const rows = (entries ?? []).map(({ kind, item }) => ({ item, view: describeCleaningIssue(kind, item, now) }));
  return rows.sort((a, b) => compareRows(a, b, () => 0));
}
