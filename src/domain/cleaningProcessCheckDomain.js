/**
 * 청소 절차 점검(청소 관리 › 절차 점검 화면)의 판단 규칙 — 순수 함수.
 *
 * 실제 청소 절차(docs/cleaning-automation-design.md · cleaning-scenario-matrix.md · refactoring.md DEC-07/RF-20):
 *   호스트가 구글 예약 캘린더에 매일 반복 청소 칸을 만들어 둔다 → 매월 15일 다음 달 모든 날을 블로커로 막는다 →
 *   매일 아침·밤 Airbnb 예약을 가져와 퇴실마다 청소 일정을 만든다(요청 = 청소 2주 전) → 요청 날 그날 칸을 열고 1순위 담당자부터 요청 →
 *   담당자가 열린 칸을 예약하면 캘린더 알림으로 자동 배정.
 * 이 파일은 "지금 상태가 그 절차대로인지"를 판단해 사람 말로 돌려준다. 화면은 표시만 한다.
 */
import { planJobDispatch } from './cleaningDispatchRule.js';
import { toKstDateKey } from './monthlyCalendarDomain.js';

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;
const REQUESTING = new Set(['NOTIFYING_VIP_1', 'NOTIFYING_VIP_2', 'NOTIFYING_VIP_3', 'NOTIFYING_BULK', 'BULK_REMINDED', 'ESCALATED']);
const DONE = new Set(['ASSIGNED', 'COMPLETED']);

/** Date/ISO → 한국 날짜 'YYYY-MM-DD' — 서버의 칸(블로커) 날짜와 같은 함수 */
export const kstDay = toKstDateKey;

// 요청 시각이 된 일정은 하루 두 번(아침 8시·밤 10시) 요청 작업이 보낸다 — 이보다 오래 "요청 전"이면 요청이 멈춘 것
const DISPATCH_OVERDUE_MS = 14 * 3_600_000;

/** 한국 날짜 'YYYY-MM-DD' 를 사람이 읽는 'M/D(요일)' 로 */
export function dayLabel(day) {
  if (!day) return '-';
  const date = new Date(`${day}T00:00:00+09:00`);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(date.getTime() + KST_MS).getUTCDay()];
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${weekday})`;
}

/**
 * ① 연결 확인 — 숙소 설정과 캘린더 알림 구독 상태로 "절차가 돌 수 있는지"를 본다.
 * @param {object} property  /api/cleaning/properties 의 한 행
 * @param {{status?: string, expiration?: string|number}|null} watch  /api/cleaning/calendar-watch GET 결과
 */
export function connectionChecks(property, watch, now = Date.now()) {
  const level = ok => (ok ? 'ok' : 'bad');
  const expiresAt = watch?.expiration ? Number(watch.expiration) || Date.parse(watch.expiration) : null;
  const daysLeft = expiresAt ? Math.floor((expiresAt - now) / DAY_MS) : null;
  return [
    { key: 'feed', label: 'Airbnb 예약 가져오기', ok: !!property?.ical_configured, level: level(!!property?.ical_configured),
      detail: property?.ical_configured ? '예약 피드가 연결돼 있어요' : '예약 피드 주소가 없어 예약을 가져올 수 없어요' },
    { key: 'calendar', label: '구글 캘린더(칸 막기·열기)', ok: !!property?.google_calendar_id, level: level(!!property?.google_calendar_id),
      detail: property?.google_calendar_id ? '청소 칸을 막고 열 캘린더가 연결돼 있어요' : '캘린더가 없어 칸을 막거나 열 수 없어요' },
    { key: 'booking', label: '담당자 예약 링크', ok: !!property?.google_calendar_booking_url, level: level(!!property?.google_calendar_booking_url),
      detail: property?.google_calendar_booking_url ? '요청 알림에 예약 링크가 들어가요' : '예약 링크가 없어 담당자가 칸을 예약할 수 없어요' },
    { key: 'watch', label: '예약하면 자동 배정(캘린더 알림)', ok: watch?.status === 'active',
      // 기록이 없으면(예: 자동 갱신이 만료 시각을 남기기 전) 고장으로 단정하지 않는다 — 안내로만
      level: watch?.status === 'active' ? 'ok' : watch?.status === 'expired' ? 'bad' : 'info',
      detail: watch?.status === 'active'
        ? `담당자가 칸을 예약하면 바로 배정돼요${daysLeft != null ? ` (알림 구독 ${daysLeft}일 남음, 6일마다 아침 작업이 자동 갱신)` : ''}`
        : watch?.status === 'expired' ? '캘린더 알림 구독이 끝나 예약해도 자동 배정이 안 돼요(아침 작업이 갱신)'
          : '구독 만료 기록이 아직 없어요 — 다음 자동 갱신(6일마다 아침 작업) 때 남아요. 예약했는데 배정이 안 되면 4단계 "캘린더 다시 확인"' },
  ];
}

/**
 * 그 달 칸 막기가 이미 됐어야 하는지 — 매월 15일 작업이 다음 달 모든 날을 막는다. 이번 달·지난 달은 이미 막혔어야 하고,
 * 다음 달은 이번 달 15일부터. (막힌 기록 유무로 판단하면 15일 작업이 실패한 달이 "아직 막기 전"으로 숨는다)
 */
export function monthShouldBeBlocked(month, today) {
  const thisMonth = today.slice(0, 7);
  if (month <= thisMonth) return true;
  const [y, m] = thisMonth.split('-').map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  return month === next && Number(today.slice(8, 10)) >= 15;
}

const SEVERITY = { ok: 0, info: 1, warn: 2, bad: 3 };

/** 하루의 칸 판단 — 일정 하나 기준(원래 절차 DEC-07: 요청 전·퇴실 없음은 막힘, 요청 보낸 날만 열림) */
function judgeDay({ job, isBlocked, monthDue, now }) {
  if (!job) {
    if (!monthDue) return { level: 'info', note: '이 달 칸은 아직 막기 전이에요(전달 15일에 막혀요)' };
    if (isBlocked) return { level: 'ok', note: '퇴실 없음 · 칸 막힘' };
    return { level: 'warn', note: '퇴실이 없는데 칸이 열려 있어요 — 담당자가 이 날 예약할 수 있어요' };
  }
  if (job.status === 'PENDING') {
    const requestDay = dayLabel(kstDay(job.dispatch_after));
    if (job.dispatch_after && new Date(job.dispatch_after).getTime() < now - DISPATCH_OVERDUE_MS) {
      return { level: 'bad', note: `퇴실 · 요청 예정일(${requestDay})이 지났는데 아직 요청 전이에요 — 요청 작업이 멈췄을 수 있어요` };
    }
    if (isBlocked) return { level: 'ok', note: `퇴실 · 요청 전 · 칸 막힘(${requestDay} 요청할 때 열려요)` };
    if (!monthDue) return { level: 'info', note: `퇴실 · 요청 전(${requestDay} 요청 예정) · 이 달 칸은 아직 막기 전` };
    return { level: 'warn', note: '퇴실 · 요청 전인데 칸이 이미 열려 있어요 — 요청 순서와 상관없이 먼저 예약될 수 있어요' };
  }
  if (REQUESTING.has(job.status)) {
    return isBlocked
      ? { level: 'bad', note: '요청이 나갔는데 칸이 막혀 있어요 — 담당자가 예약할 수 없어요(다음 요청 작업 때 다시 열어요)' }
      : { level: 'ok', note: '퇴실 · 요청 중 · 칸 열림' };
  }
  if (DONE.has(job.status)) {
    return isBlocked
      ? { level: 'warn', note: '배정됐는데 칸 막힘 기록이 남아 있어요(다음 요청 작업 때 정리돼요)' }
      : { level: 'ok', note: `퇴실 · 배정 완료${job.cleaner_name ? ` (${job.cleaner_name})` : ''}` };
  }
  return { level: 'ok', note: '퇴실' };
}

/**
 * ② 날짜별 칸 상태 — start 부터 days 일 동안 날마다 "원래 절차라면 칸이 어때야 하는지"와 실제(시스템 기록)를 맞춰 본다.
 *
 * @param {{ today?: string, now?: number, start?: string, days?: number, jobs: object[], blockedDays: Iterable<string> }} input
 *   today = 오늘(한국 날짜, 달 막기 기준), now = 지금(요청이 밀렸는지 판단, 기본 오늘 낮 12시), start = 보기 시작일(기본 오늘),
 *   jobs = 이 숙소의 청소 일정, blockedDays = 시스템이 막아 둔 날
 * @returns {{ rows: object[], summary: { checkoutDays, problems, notYetBlockedDays, unblockedMonths: string[] } }}
 *   rows[i] = { day, label, checkout, status, blocked, level: 'ok'|'info'|'warn'|'bad', note }
 */
export function slotDayRows({ today = kstDay(Date.now()), now = Date.parse(`${today}T12:00:00+09:00`), start = today, days = 42, jobs = [], blockedDays = [] }) {
  const blocked = new Set(blockedDays);
  const liveJobsByDay = new Map();
  for (const job of jobs) {
    if (job.status === 'CANCELLED') continue; // 운영자가 취소하며 칸을 다시 막은 날은 퇴실로 보지 않는다
    const day = kstDay(job.checkout_at);
    liveJobsByDay.set(day, [...(liveJobsByDay.get(day) ?? []), job]);
  }
  const startMs = new Date(`${start}T00:00:00+09:00`).getTime();
  const rows = [];
  for (let i = 0; i < days; i++) {
    const day = kstDay(startMs + i * DAY_MS);
    const dayJobs = liveJobsByDay.get(day) ?? [];
    const isBlocked = blocked.has(day);
    const monthDue = monthShouldBeBlocked(day.slice(0, 7), today);
    // 같은 날 일정이 여럿이면(DEC-05 상 1개여야 함) 가장 심한 판단을 보이고 따로 알린다
    const judged = (dayJobs.length ? dayJobs : [null]).map(job => judgeDay({ job, isBlocked, monthDue, now }))
      .sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])[0];
    let { level, note } = judged;
    if (dayJobs.length > 1) {
      note = `${note} · 같은 날 청소 일정이 ${dayJobs.length}개예요(퇴실 하나에 일정 하나여야 해요)`;
      if (SEVERITY[level] < SEVERITY.warn) level = 'warn';
    }
    const job = dayJobs[0] ?? null;
    // 막혀 있어야 하는 날 = 퇴실이 없거나 아직 요청 전인 날(요청이 나갔거나 배정된 날은 열려 있는 게 맞다)
    const shouldBeBlocked = dayJobs.length === 0 || dayJobs.every(j => j.status === 'PENDING');
    rows.push({ day, label: dayLabel(day), checkout: dayJobs.length > 0, status: job?.status ?? null, blocked: isBlocked, shouldBeBlocked, level, note });
  }
  // 막혔어야 하는 달인데, 막혀 있어야 하는 날이 보이는데도 그중 막힌 날이 하나도 없으면 — 15일 칸 막기 작업이 실패한 것으로 본다
  const months = [...new Set(rows.map(row => row.day.slice(0, 7)))];
  const unblockedMonths = months.filter(month => {
    if (!monthShouldBeBlocked(month, today)) return false;
    const expected = rows.filter(row => row.day.startsWith(month) && row.shouldBeBlocked);
    return expected.length > 0 && !expected.some(row => row.blocked);
  });
  return {
    rows,
    summary: {
      checkoutDays: rows.filter(row => row.checkout).length,
      problems: rows.filter(row => row.level === 'warn' || row.level === 'bad').length,
      notYetBlockedDays: rows.filter(row => row.level === 'info').length,
      unblockedMonths,
    },
  };
}

/** ④ 고른 청소 일정 하루의 칸 판단(②와 같은 규칙) — blockedDays 는 그날을 조회한 결과 */
export function jobDaySlot({ today = kstDay(Date.now()), now, job, blockedDays = [] }) {
  return slotDayRows({ today, now, start: kstDay(job.checkout_at), days: 1, jobs: [job], blockedDays }).rows[0];
}

/** 청소 일정 상태를 사람 말로 */
export function jobStatusLabel(job) {
  switch (job?.status) {
    case 'PENDING': return `요청 전 — ${dayLabel(kstDay(job.dispatch_after))} 요청 예정`;
    case 'NOTIFYING_VIP_1': return '1순위 담당자에게 요청 중';
    case 'NOTIFYING_VIP_2': return '2순위 담당자에게 요청 중';
    case 'NOTIFYING_VIP_3': return '3순위 담당자에게 요청 중';
    case 'NOTIFYING_BULK': return '전체 담당자에게 요청 중';
    case 'BULK_REMINDED': return '전체 담당자에게 다시 알림 보냄';
    case 'ESCALATED': return '배정 실패 — 직접 배정이 필요해요';
    case 'ASSIGNED': return `배정 완료${job.cleaner_name ? ` — ${job.cleaner_name}` : ''}`;
    case 'COMPLETED': return '청소 완료';
    case 'CANCELLED': return '취소됨';
    default: return job?.status ?? '-';
  }
}

/**
 * ③ 요청 예정일 확인 — 요청 전 일정의 요청 시각이 원래 규칙(청소 2주 전, 만들 때 2주 안이었으면 바로)과 맞는지.
 * 월간 작업은 같은 날 여러 건을 10분 간격으로 띄우므로 하루 늦은 것까지는 같은 것으로 본다. 예정일이 지났는데 요청 전이면 멈춤으로 본다.
 */
export function requestScheduleCheck(job, now = Date.now()) {
  if (job?.status !== 'PENDING') return { ok: true, note: null };
  if (!job.dispatch_after) return { ok: false, note: '요청 예정일이 없어요' };
  if (new Date(job.dispatch_after).getTime() < now - DISPATCH_OVERDUE_MS) {
    return { ok: false, note: `요청 예정일(${dayLabel(kstDay(job.dispatch_after))})이 지났는데 아직 요청 전이에요 — 요청 작업이 멈췄을 수 있어요` };
  }
  const expected = planJobDispatch(job.cleaning_start_at, job.created_at ?? Date.now()).dispatchAfter.getTime();
  const actual = new Date(job.dispatch_after).getTime();
  if (!Number.isFinite(actual)) return { ok: false, note: '요청 예정일이 없어요' };
  // 월간 작업은 같은 날(모든 숙소 합쳐) 여러 건을 10분 간격으로 늦추므로 하루 늦은 것까지 같은 것으로 본다
  if (actual >= expected - 3_600_000 && actual <= expected + 24 * 3_600_000) return { ok: true, note: '청소 2주 전 규칙대로예요' };
  return actual < expected
    ? { ok: false, note: `규칙(${dayLabel(kstDay(expected))})보다 일찍 요청하게 돼 있어요` }
    : { ok: false, note: `규칙(${dayLabel(kstDay(expected))})보다 늦게 요청하게 돼 있어요` };
}

/** ④ 요청 진행 — 요청 기록(cleaning_notifs)을 사람 말로. 연락처는 싣지 않는다 */
export function requestProgressRows(notifs = []) {
  const tierLabel = { VIP_1: '1순위', VIP_2: '2순위', VIP_3: '3순위', BULK: '전체' };
  return [...notifs]
    .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
    .map(notif => ({
      who: `${tierLabel[notif.tier] ?? notif.tier} ${notif.cleaner_name ?? '담당자'}`,
      sentAt: notif.sent_at,
      answer: notif.response === 'DECLINED' ? '거절' : notif.response === 'DECLINED_AFTER_ASSIGNED' ? '배정 뒤 거절' : '응답 없음(예약하면 배정돼요)',
    }));
}
