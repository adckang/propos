/**
 * checkoutDomain — 체크아웃 & 청소 순수 도메인 함수
 * 외부 의존성 없음. 입력 → 출력만.
 */

/**
 * 퇴실 이벤트가 체크아웃인지 판별
 * @param {{ event: string, propId: string, time: string, context?: string }} event
 * @param {{ propId: string, checkOut: string, status: string }} booking
 * @param {string} now  - "HH:MM" (테스트 주입용)
 * @returns {boolean}
 *
 * true 조건:
 *   event.event === "door_locked" || "manual_checkout"
 *   AND booking.status === "confirmed" || "occupied"
 *   AND now가 getCheckoutWindow(booking.checkOut) 범위 내
 */
export function isCheckoutEvent(event, booking, now) {
  if (!event)   throw new Error('event is required');
  if (!booking) throw new Error('booking is required');
  if (!now)     throw new Error('now is required');

  const validEvents = ['door_locked', 'manual_checkout'];
  if (!validEvents.includes(event.event)) return false;

  const validStatuses = ['confirmed', 'occupied'];
  if (!validStatuses.includes(booking.status)) return false;

  const window = getCheckoutWindow(booking.checkOut);
  return _isInWindow(now, window.from, window.until);
}

/**
 * 체크아웃 가능 시간창 계산
 * @param {string} checkOut - ISO 8601 (예: "2026-04-07T11:00:00")
 * @returns {{ from: string, until: string }}
 * from  = checkOut - 2시간
 * until = checkOut + 3시간
 */
export function getCheckoutWindow(checkOut) {
  if (!checkOut) throw new Error('checkOut is required');

  const d = new Date(checkOut);
  if (isNaN(d.getTime())) throw new Error('checkOut is invalid date');

  const from  = new Date(d.getTime() - 2 * 60 * 60 * 1000);
  const until = new Date(d.getTime() + 3 * 60 * 60 * 1000);

  return {
    from:  _toHHMM(from),
    until: _toHHMM(until),
  };
}

/**
 * 청소팀 자동 배정 (가용 팀 중 부하 최소)
 * @param {Array<{ id: string, name: string, available: boolean, activeJobs: number, phone: string }>} cleaners
 * @param {string} propId
 * @param {string} checkoutTime  - "HH:MM"
 * @returns {{ propId, cleanerId, cleanerName, assignedAt, estimatedArrival, status }}
 * @throws {Error} 가용 청소팀 없을 시
 */
export function assignCleaner(cleaners, propId, checkoutTime) {
  if (!cleaners || cleaners.length === 0) throw new Error('cleaners is required');
  if (!propId)      throw new Error('propId is required');
  if (!checkoutTime) throw new Error('checkoutTime is required');

  const available = cleaners.filter(c => c.available);
  if (available.length === 0) throw new Error('가용 청소팀 없음');

  // activeJobs 가장 적은 팀 선택
  const selected = available.reduce((min, c) => c.activeJobs < min.activeJobs ? c : min, available[0]);

  const estimatedArrival = _addMinutes(checkoutTime, 30);

  return {
    propId,
    cleanerId:        selected.id,
    cleanerName:      selected.name,
    assignedAt:       checkoutTime,
    estimatedArrival,
    status:           'assigned',
  };
}

/**
 * 청소 체크리스트 생성 (표준 항목)
 * @param {string} propId
 * @returns {Array<{ id, label, done, priority }>}
 */
export function buildChecklist(propId) {
  if (!propId) throw new Error('propId is required');

  return [
    { id: `${propId}-cl-01`, label: '침구 교체',           done: false, priority: 'required' },
    { id: `${propId}-cl-02`, label: '화장실 청소',          done: false, priority: 'required' },
    { id: `${propId}-cl-03`, label: '주방 청소',            done: false, priority: 'required' },
    { id: `${propId}-cl-04`, label: '바닥 청소',            done: false, priority: 'required' },
    { id: `${propId}-cl-05`, label: '쓰레기 비우기',        done: false, priority: 'required' },
    { id: `${propId}-cl-06`, label: '도어락 PIN 초기화 확인', done: false, priority: 'required' },
    { id: `${propId}-cl-07`, label: '에어컨 필터 청소',      done: false, priority: 'optional' },
    { id: `${propId}-cl-08`, label: '창문 닦기',            done: false, priority: 'optional' },
  ];
}

/**
 * 체크아웃 완료 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string} propId
 * @param {string} guestName
 * @param {string} checkoutTime - "HH:MM"
 * @returns {string}
 */
export function buildCheckoutAlert(propId, guestName, checkoutTime) {
  if (!propId)       throw new Error('propId is required');
  if (!guestName)    throw new Error('guestName is required');
  if (!checkoutTime) throw new Error('checkoutTime is required');

  return `${propId} 체크아웃 완료 — ${guestName}님 퇴실 (${checkoutTime})`;
}

/**
 * 청소팀 배정 알림 텍스트 조립 (순수 문자열 반환)
 * @param {string} propId
 * @param {{ cleanerName: string, estimatedArrival: string }} assignment
 * @returns {string}
 */
export function buildCleanerAssignAlert(propId, assignment) {
  if (!propId)      throw new Error('propId is required');
  if (!assignment)  throw new Error('assignment is required');
  if (!assignment.cleanerName)      throw new Error('assignment.cleanerName is required');
  if (!assignment.estimatedArrival) throw new Error('assignment.estimatedArrival is required');

  return `${propId} 청소팀 배정 완료 — ${assignment.cleanerName} 도착예정 ${assignment.estimatedArrival}`;
}

// ─── 내부 헬퍼 ──────────────────────────────────────────

function _toHHMM(date) {
  return date.getHours().toString().padStart(2, '0') + ':' +
         date.getMinutes().toString().padStart(2, '0');
}

function _isInWindow(now, from, until) {
  const [nh, nm] = now.split(':').map(Number);
  const [fh, fm] = from.split(':').map(Number);
  const [uh, um] = until.split(':').map(Number);
  const nowMin  = nh * 60 + nm;
  const fromMin = fh * 60 + fm;
  const untilMin = uh * 60 + um;
  return nowMin >= fromMin && nowMin <= untilMin;
}

function _addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return hh.toString().padStart(2, '0') + ':' + mm.toString().padStart(2, '0');
}
