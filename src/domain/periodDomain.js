/**
 * periodDomain — 기간 문자열 → { from, to } (KST 달력 경계, UTC 시각으로 표현)
 *
 * 경계는 reportingDomain.getPeriodRange 와 같은 KST 자정이다 (한국 호스트의 "월요일 00:00").
 * 이벤트 집계(getPeriodRange)는 to 를 23:59:59.999 로 포함하고, 여기서는 to 를 다음 경계로 두는
 * [from, to) 배타 구간이다 — 둘은 to - 1ms 로 정확히 일치한다.
 *
 * 주·일 기간은 "지금 기준 몇 주/며칠 뒤·전"으로 일반화한다 (레포트가 타임라인 위치를 그대로 따르도록).
 * 자주 쓰는 0·±1 은 이름이 있고, 그 밖은 weeks_ahead_2 · weeks_ago_3 · days_ahead_2 · days_ago_5 로 쓴다.
 */

const HOUR = 3_600_000;
const KST_OFFSET_MS = 9 * HOUR;

/** KST 달력 날짜 (y, m, d) 자정의 UTC 시각. d 가 범위를 넘어도 Date.UTC 가 정규화한다. */
function kstMidnight(y, m, d) {
  return new Date(Date.UTC(y, m, d) - KST_OFFSET_MS);
}

// ── 기간 이름 ↔ 오프셋 ─────────────────────────────────────────────────────────

const NAMED_OFFSETS = {
  last_week: { unit: 'week', offset: -1 }, this_week: { unit: 'week', offset: 0 }, next_week: { unit: 'week', offset: 1 },
  yesterday: { unit: 'day',  offset: -1 }, today:     { unit: 'day',  offset: 0 }, tomorrow:  { unit: 'day',  offset: 1 },
};
const NAME_OF_OFFSET = {
  week: { '-1': 'last_week', '0': 'this_week', '1': 'next_week' },
  day:  { '-1': 'yesterday', '0': 'today',     '1': 'tomorrow'  },
};
const GENERIC_RE = /^(weeks|days)_(ahead|ago)_([1-9]\d{0,3})$/;
const MAX_OFFSET = { week: 520, day: 3650 }; // 약 10년 — 터무니없는 요청 방지

/**
 * 주/일 기간 문자열 → { unit: 'week'|'day', offset }. 양수=미래, 음수=과거, 0=이번.
 * 주/일 기간이 아니면 null.
 * @param {string} period
 */
export function parseOffsetPeriod(period) {
  if (typeof period !== 'string') return null;
  const named = NAMED_OFFSETS[period];
  if (named) return { ...named };
  const m = GENERIC_RE.exec(period);
  if (!m) return null;
  const unit = m[1] === 'weeks' ? 'week' : 'day';
  const n = Number(m[3]);
  if (n > MAX_OFFSET[unit]) return null;
  return { unit, offset: m[2] === 'ahead' ? n : -n };
}

/**
 * 오프셋 → 기간 문자열. 0·±1 은 표준 이름(this_week, next_week, tomorrow …), 그 밖은 weeks_ahead_N 등.
 * 범위를 넘는 값은 허용 최대치로 맞춘다.
 * @param {'week'|'day'} unit
 * @param {number} offset
 */
export function periodForOffset(unit, offset) {
  if (unit !== 'week' && unit !== 'day') throw new Error(`unknown unit: "${unit}"`);
  const max = MAX_OFFSET[unit];
  let n = Math.max(-max, Math.min(max, Math.trunc(Number(offset) || 0)));
  if (n === 0) n = 0; // -0 → 0
  const named = NAME_OF_OFFSET[unit][String(n)];
  if (named) return named;
  return `${unit === 'week' ? 'weeks' : 'days'}_${n > 0 ? 'ahead' : 'ago'}_${Math.abs(n)}`;
}

// ── 기간 설명 (시제 + 표시 이름) ────────────────────────────────────────────────

const NAMED_DESCRIPTIONS = {
  now:        { tense: 'now',    unit: 'now',   offset: 0,  label: '지금' },
  today:      { tense: 'active', unit: 'day',   offset: 0,  label: '오늘' },
  this_week:  { tense: 'active', unit: 'week',  offset: 0,  label: '이번 주' },
  this_month: { tense: 'active', unit: 'month', offset: 0,  label: '이번 달' },
  yesterday:  { tense: 'past',   unit: 'day',   offset: -1, label: '어제' },
  last_week:  { tense: 'past',   unit: 'week',  offset: -1, label: '지난주' },
  last_hour:  { tense: 'past',   unit: 'hour',  offset: -1, label: '지난 1시간' },
  last_month: { tense: 'past',   unit: 'month', offset: -1, label: '지난달' },
  tomorrow:   { tense: 'future', unit: 'day',   offset: 1,  label: '내일' },
  next_week:  { tense: 'future', unit: 'week',  offset: 1,  label: '다음 주' },
  next_hour:  { tense: 'future', unit: 'hour',  offset: 1,  label: '다음 예정' },
  next_month: { tense: 'future', unit: 'month', offset: 1,  label: '다음 달' },
};

/**
 * 기간의 시제(now/past/active/future)와 표시 이름. 알 수 없는 기간이면 null.
 * 일반화된 기간은 "2주 뒤", "3일 전" 처럼 표시한다.
 * @param {string} period
 * @returns {{ tense: 'now'|'past'|'active'|'future', unit: string, offset: number, label: string }|null}
 */
export function describePeriod(period) {
  const named = NAMED_DESCRIPTIONS[period];
  if (named) return { ...named };
  const off = parseOffsetPeriod(period);
  if (!off) return null;
  const unitKo = off.unit === 'week' ? '주' : '일';
  return {
    tense: off.offset > 0 ? 'future' : 'past',
    unit: off.unit,
    offset: off.offset,
    label: `${Math.abs(off.offset)}${unitKo} ${off.offset > 0 ? '뒤' : '전'}`,
  };
}

// ── 기간 → 범위 ───────────────────────────────────────────────────────────────

/**
 * @param {string} period  — 주/일 기간(last_week … weeks_ahead_2 … tomorrow … days_ago_3),
 *                           'this_month' | 'next_month' | 'next_hour'
 * @param {number} [nowMs] — 테스트용 고정 타임스탬프 (ms). 생략 시 Date.now()
 * @returns {{ from: Date, to: Date } | null}
 */
export function periodToDateRange(period, nowMs) {
  const now = new Date(nowMs != null ? nowMs : Date.now());
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();

  const off = parseOffsetPeriod(period);
  if (off?.unit === 'day') {
    return { from: kstMidnight(y, m, d + off.offset), to: kstMidnight(y, m, d + off.offset + 1) };
  }
  if (off?.unit === 'week') {
    const dow   = kst.getUTCDay(); // KST 기준 요일: 0=Sun, 1=Mon … 6=Sat
    const toMon = dow === 0 ? -6 : 1 - dow; // 이번 주 월요일까지의 일 오프셋
    const start = d + toMon + 7 * off.offset;
    return { from: kstMidnight(y, m, start), to: kstMidnight(y, m, start + 7) };
  }

  if (period === 'this_month') {
    return { from: kstMidnight(y, m, 1), to: kstMidnight(y, m + 1, 1) };
  }

  if (period === 'next_month') {
    return { from: kstMidnight(y, m + 1, 1), to: kstMidnight(y, m + 2, 1) };
  }

  if (period === 'next_hour') {
    return {
      from: new Date(now.getTime() + 60_000),
      to:   new Date(now.getTime() + HOUR + 60_000),
    };
  }

  if (period === 'last_hour') {
    return { from: new Date(now.getTime() - HOUR), to: new Date(now.getTime()) };
  }

  return null;
}

/**
 * "예정" 섹션이 다루는 구간 (report-architecture Template-A: [완료] 기간 시작~지금 / [예정] 지금~기간 끝).
 *   진행 중 기간(오늘·이번 주·이번 달) → [max(기간 시작, 지금), 기간 끝)
 *   그 밖(미래·과거 기간)             → 기간 전체 (periodToDateRange 와 동일)
 * 완료 구간은 이벤트 집계(getPeriodRange)가 담당하므로 예정 수치와 겹치지 않는다.
 *
 * @param {string} period
 * @param {number} [nowMs]
 * @returns {{ from: Date, to: Date } | null}
 */
export function periodToRemainingRange(period, nowMs) {
  const range = periodToDateRange(period, nowMs);
  if (!range || describePeriod(period)?.tense !== 'active') return range;
  const now = nowMs != null ? nowMs : Date.now();
  return { from: new Date(Math.max(range.from.getTime(), now)), to: range.to };
}

/**
 * 기간(period)이 ListView 타임라인 창(windowStart ~ windowStart+windowMs) 안에서 차지하는
 * 위치를 퍼센트로 계산한다 — "지금 보고 있는 레포트가 타임라인의 어느 구간을 가리키는지"를
 * 하이라이트 박스로 그리기 위한 좌표. 기간이 창을 완전히 벗어나면 null(안 그림).
 * 창에 걸치는 경우 보이는 부분만큼만 [0, 100] 범위로 잘라낸다.
 * @param {string} period
 * @param {Date} windowStart
 * @param {number} windowMs
 * @param {number} [nowMs] — 테스트용 고정 타임스탬프 (ms). 생략 시 Date.now()
 * @returns {{ left: number, width: number } | null}
 */
export function periodToWindowHighlight(period, windowStart, windowMs, nowMs) {
  const range = periodToDateRange(period, nowMs);
  if (!range || !windowMs) return null;
  const rawLeft  = ((range.from.getTime() - windowStart.getTime()) / windowMs) * 100;
  const rawRight = ((range.to.getTime()   - windowStart.getTime()) / windowMs) * 100;
  const left  = Math.max(0, Math.min(100, rawLeft));
  const right = Math.max(0, Math.min(100, rawRight));
  if (right <= left) return null;
  return { left, width: right - left };
}

/**
 * 주/일 기간의 날짜 범위를 사람이 읽는 문자열로 (KST). 예: 주 "9/28~10/4", 하루 "9/24".
 * 주·일 기간이 아니면 ''.
 * @param {string} period
 * @param {number} [nowMs]
 */
export function periodRangeLabel(period, nowMs) {
  if (!parseOffsetPeriod(period)) return '';
  const range = periodToDateRange(period, nowMs);
  if (!range) return '';
  const md = (ms) => {
    const k = new Date(ms + KST_OFFSET_MS);
    return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
  };
  const first = md(range.from.getTime());
  const last  = md(range.to.getTime() - 1);
  return first === last ? first : `${first}~${last}`;
}
