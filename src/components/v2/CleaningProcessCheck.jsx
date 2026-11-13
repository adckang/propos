/**
 * 청소 관리 › 절차 점검 — 실제 청소 절차를 순서대로 따라가며 확인하는 화면(RF-18, 2026-11-13). 관리자 전용.
 *
 * 실제 절차: 호스트가 만든 구글 예약 캘린더의 매일 반복 청소 칸 → 매월 15일 다음 달 칸 막기 → 매일 아침·밤 Airbnb 예약 가져오기 →
 * 퇴실마다 청소 일정(요청 = 청소 2주 전) → 요청 날 그날 칸 열기 + 1순위 담당자부터 요청 → 담당자가 칸 예약 → 자동 배정.
 * 1~3단계는 새로 보내는 것이 없다(일정 목록을 불러오면 청소 관리 화면이 늘 그렇듯 시간이 된 요청의 다음 순서가 진행될 수 있다).
 * 4단계만 새 요청을 보낸다(원래 절차의 "수동 발송"과 같은 경로, 확인 체크 뒤에만). 가짜 일정·취소·담당자 비활성화는 없다.
 * 판단 규칙은 src/domain/cleaningProcessCheckDomain.js(화면은 표시만).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  connectionChecks, dayLabel, jobDaySlot, jobStatusLabel, kstDay, requestProgressRows, requestScheduleCheck, slotDayRows,
} from '../../domain/cleaningProcessCheckDomain.js';

const CHECK_DAYS = 42;
const LEVEL_STYLE = {
  ok:   { bg: '#f8fafc', border: '#e2e8f0', color: '#334155', mark: '✓' },
  info: { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', mark: 'i' },
  warn: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', mark: '!' },
  bad:  { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b', mark: '✕' },
};
const button = tone => ({
  primary:   { background: '#2563eb', border: '1.5px solid #1d4ed8', color: '#fff' },
  secondary: { background: '#fff', border: '1.5px solid #cbd5e1', color: '#334155' },
  danger:    { background: '#dc2626', border: '1.5px solid #b91c1c', color: '#fff' },
}[tone]);
const buttonBase = { borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const STEPS = [
  { id: 1, title: '연결 확인', sub: '예약 가져오기·칸 막기·예약 링크·자동 배정이 연결돼 있는지' },
  { id: 2, title: '날짜별 칸 상태', sub: '앞으로 6주, 칸이 절차대로 막히고 열려 있는지' },
  { id: 3, title: '청소 일정과 요청 예정일', sub: '퇴실마다 청소 일정이 있고 요청이 청소 2주 전으로 잡혀 있는지' },
  { id: 4, title: '실제 일정으로 진행', sub: '칸 열기 → 1순위 담당자 요청 → 담당자 예약 → 자동 배정 (실제 요청이 나가요)' },
];

function Step({ step, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={onToggle} aria-expanded={open}
        style={{ width: '100%', textAlign: 'left', padding: '14px 18px', background: open ? '#eff6ff' : '#fff',
          border: open ? '2px solid #2563eb' : '1.5px solid #e2e8f0', borderRadius: open ? '12px 12px 0 0' : 12,
          cursor: 'pointer', fontFamily: 'inherit', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: open ? '#2563eb' : '#e2e8f0', color: open ? '#fff' : '#64748b',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{step.id}</span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#1a202c' }}>{step.title}</span>
          <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>{step.sub}</span>
        </span>
        <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 700 }}>{open ? '접기' : '보기'}</span>
      </button>
      {open && (
        <div style={{ padding: '14px 18px 18px', background: '#fff', border: '2px solid #2563eb', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Line({ level = 'ok', title, detail, right }) {
  const style = LEVEL_STYLE[level];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px', marginTop: 6, borderRadius: 8,
      background: style.bg, border: `1px solid ${style.border}`, color: style.color, fontSize: 13 }}>
      <span style={{ fontWeight: 800, width: 14, textAlign: 'center' }}>{style.mark}</span>
      <span style={{ flex: 1 }}>
        <b>{title}</b>{detail ? <span style={{ marginLeft: 8, fontWeight: 400 }}>{detail}</span> : null}
      </span>
      {right}
    </div>
  );
}

export default function CleaningProcessCheck({ apiFetch }) {
  const [adminOnly, setAdminOnly] = useState(false); // 운영자 계정이면 이 점검은 관리자 전용 안내만
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [openStep, setOpenStep] = useState(1);
  const [watch, setWatch] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [blockedDays, setBlockedDays] = useState([]);
  const [showAllDays, setShowAllDays] = useState(false);
  const [googleCheck, setGoogleCheck] = useState({}); // day → 결과 문장
  const [selectedJobId, setSelectedJobId] = useState('');
  const [jobDetail, setJobDetail] = useState(null);
  const [selectedDayBlocked, setSelectedDayBlocked] = useState([]); // 고른 일정 그날의 막힌 칸 조회 결과
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { level, text }
  const loadSeq = useRef(0); // 숙소를 빠르게 바꿀 때 늦게 온 옛 숙소 응답이 덮어쓰지 않게
  const selectSeq = useRef(0); // 일정을 빠르게 바꿀 때 늦게 온 옛 일정 응답이 덮어쓰지 않게

  const today = kstDay(Date.now());
  const until = kstDay(Date.now() + (CHECK_DAYS - 1) * 86_400_000);
  const property = properties.find(p => p.property_id === propertyId) ?? null;

  useEffect(() => {
    (async () => {
      const me = await apiFetch('/api/auth/me').catch(() => null);
      if (me?.required && me?.role === 'operator') { setAdminOnly(true); return; }
      try {
        const real = (await apiFetch('/api/cleaning/properties') ?? []).filter(p => p.data_origin !== 'SIMULATED');
        setProperties(real);
        if (real[0]) setPropertyId(real[0].property_id);
      } catch (e) {
        if (/관리자만/.test(e.message)) setAdminOnly(true); // 로그인 확인이 실패해도 서버가 막으면 관리자 전용 안내로
        else setMessage({ level: 'bad', text: `숙소를 불러오지 못했어요: ${e.message}` });
      }
    })();
  }, [apiFetch]);

  async function reload(target = propertyId, { keepMessage = false } = {}) {
    if (!target) return;
    const seq = ++loadSeq.current;
    const targetProperty = properties.find(p => p.property_id === target);
    setBusy(true);
    if (!keepMessage) setMessage(null);
    try {
      const calendarId = targetProperty?.google_calendar_id;
      const [watchResult, jobList, blockers] = await Promise.all([
        calendarId ? apiFetch(`/api/cleaning/calendar-watch?calendar_id=${encodeURIComponent(calendarId)}`).catch(() => null) : null,
        apiFetch(`/api/cleaning/jobs?property_id=${encodeURIComponent(target)}&from=${today}&limit=200`),
        apiFetch(`/api/cleaning/blockers?property_id=${encodeURIComponent(target)}&from=${today}&to=${until}`),
      ]);
      if (seq !== loadSeq.current) return;
      setWatch(watchResult);
      setJobs((jobList ?? []).filter(job => job.property_id === target).sort((a, b) => new Date(a.checkout_at) - new Date(b.checkout_at)));
      setBlockedDays(blockers?.days ?? []);
    } catch (e) {
      if (seq === loadSeq.current) setMessage({ level: 'bad', text: `불러오지 못했어요: ${e.message}` });
    } finally { if (seq === loadSeq.current) setBusy(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(propertyId); }, [propertyId, properties]);

  const checks = useMemo(() => connectionChecks(property, watch), [property, watch]);
  const slots = useMemo(() => slotDayRows({ today, now: Date.now(), days: CHECK_DAYS, jobs, blockedDays }), [today, jobs, blockedDays]);
  const visibleSlotRows = showAllDays ? slots.rows : slots.rows.filter(row => row.checkout || row.level === 'warn' || row.level === 'bad');
  const selectableJobs = jobs.filter(job => job.status !== 'CANCELLED' && job.status !== 'COMPLETED');
  const selectedJob = jobs.find(job => job.id === selectedJobId) ?? null;
  const selectedSlot = selectedJob ? jobDaySlot({ today, now: Date.now(), job: selectedJob, blockedDays: selectedDayBlocked }) : null;

  async function checkGoogle(day) {
    if (!property?.google_calendar_id) return;
    setGoogleCheck(prev => ({ ...prev, [day]: '확인 중…' }));
    try {
      const result = await apiFetch(`/api/cleaning/calendar-scan?calendar_id=${encodeURIComponent(property.google_calendar_id)}&date=${day}&property_id=${encodeURIComponent(property.property_id)}`);
      setGoogleCheck(prev => ({ ...prev, [day]: `구글 캘린더: 칸 막힘 ${result.blockers ?? 0}개 · 담당자 예약 ${result.bookings?.length ?? 0}건` }));
    } catch (e) {
      setGoogleCheck(prev => ({ ...prev, [day]: `확인 실패: ${e.message}` }));
    }
  }

  // 고른 일정 — 요청 기록과 그날 칸(6주 밖 일정도 그날만 따로 조회)
  async function loadSelected(jobId = selectedJobId) {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const seq = ++selectSeq.current;
    const day = kstDay(job.checkout_at);
    try {
      const [detail, dayBlockers] = await Promise.all([
        apiFetch(`/api/cleaning/jobs/${jobId}`),
        apiFetch(`/api/cleaning/blockers?property_id=${encodeURIComponent(job.property_id)}&from=${day}&to=${day}`),
      ]);
      if (seq !== selectSeq.current) return;
      setJobDetail(detail);
      setSelectedDayBlocked(dayBlockers?.days ?? []);
      if (detail?.status) setJobs(prev => prev.map(j => (j.id === jobId ? { ...j, ...detail, notifs: undefined } : j)));
    } catch (e) { setMessage({ level: 'bad', text: `일정을 불러오지 못했어요: ${e.message}` }); }
  }

  async function sendRequestNow() {
    if (!selectedJob || selectedJob.status !== 'PENDING' || !confirmed) return;
    setBusy(true); setMessage(null);
    try {
      await apiFetch('/api/cleaning/dispatch', { method: 'POST', body: JSON.stringify({ job_id: selectedJob.id }) });
      setMessage({ level: 'ok', text: '요청을 보냈어요 — 그날 칸이 열리고 1순위 담당자에게 요청이 갔어요' });
      setConfirmed(false);
      await Promise.all([loadSelected(selectedJob.id), reload(propertyId, { keepMessage: true })]);
    } catch (e) {
      setMessage({ level: 'bad', text: `요청을 보내지 못했어요: ${e.message}` });
    } finally { setBusy(false); }
  }

  // 담당자가 예약했는데 자동 배정이 안 됐을 때의 원래 복구 절차(캘린더 다시 읽어 배정)
  async function rescanCalendar() {
    if (!selectedJob || !property?.google_calendar_id) return;
    setBusy(true); setMessage(null);
    try {
      await apiFetch('/api/cleaning/calendar-scan', { method: 'POST',
        body: JSON.stringify({ calendar_id: property.google_calendar_id, date: kstDay(selectedJob.checkout_at) }) });
      setMessage({ level: 'ok', text: '캘린더를 다시 확인했어요 — 담당자 예약이 있으면 배정됐어요' });
      await Promise.all([loadSelected(selectedJob.id), reload(propertyId, { keepMessage: true })]);
    } catch (e) {
      setMessage({ level: 'bad', text: `캘린더 확인 실패: ${e.message}` });
    } finally { setBusy(false); }
  }

  if (adminOnly) {
    return <Line level="info" title="청소 절차 점검은 관리자만 쓸 수 있어요" detail="숙소 설정·캘린더·발송 권한이 필요해요" />;
  }

  const progress = requestProgressRows(jobDetail?.notifs ?? []);
  const unblocked = slots.summary.unblockedMonths;

  return (
    <div>
      <div style={{ marginBottom: 16, padding: '14px 18px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e40af' }}>청소 절차 점검</div>
        <div style={{ fontSize: 12, color: '#1e40af', marginTop: 4, lineHeight: 1.6 }}>
          예약 → 청소 일정 → 칸 막기·열기 → 담당자 요청 → 담당자 예약 → 자동 배정이 제대로 도는지 순서대로 확인해요.
          1~3단계는 새로 보내는 것이 없고, 4단계에서만 새 요청을 보내요.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>숙소</span>
        <select value={propertyId} onChange={e => { setPropertyId(e.target.value); setSelectedJobId(''); setJobDetail(null); setGoogleCheck({}); }}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
          {properties.map(p => <option key={p.property_id} value={p.property_id}>{p.name ?? p.property_id}</option>)}
        </select>
        <button onClick={() => reload()} disabled={busy} style={{ ...buttonBase, ...button('secondary') }}>{busy ? '불러오는 중…' : '새로고침'}</button>
      </div>

      {message && <Line level={message.level} title={message.text} />}

      <Step step={STEPS[0]} open={openStep === 1} onToggle={() => setOpenStep(openStep === 1 ? 0 : 1)}>
        {checks.map(check => <Line key={check.key} level={check.level} title={check.label} detail={check.detail} />)}
      </Step>

      <Step step={STEPS[1]} open={openStep === 2} onToggle={() => setOpenStep(openStep === 2 ? 0 : 2)}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          {dayLabel(today)}~{dayLabel(until)} · 퇴실 <b>{slots.summary.checkoutDays}일</b> · 확인 필요 <b style={{ color: slots.summary.problems ? '#b91c1c' : '#334155' }}>{slots.summary.problems}일</b>
          {slots.summary.notYetBlockedDays ? ` · 아직 칸 막기 전 ${slots.summary.notYetBlockedDays}일` : ''}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          원래 절차: 퇴실이 없는 날과 요청 전인 날은 막혀 있고, 요청을 보낸 날에만 열려요. 시스템 기록 기준이며, 궁금한 날은 구글 캘린더에서 직접 확인해요.
        </div>
        {unblocked.map(month => (
          <Line key={month} level="bad" title={`${Number(month.slice(5, 7))}월 칸 막기가 안 돼 있어요`}
            detail="15일 칸 막기 작업이 실패했을 수 있어요 — 담당자가 아무 날이나 예약할 수 있어요" />
        ))}
        {visibleSlotRows.map(row => (
          <Line key={row.day} level={row.level} title={row.label} detail={googleCheck[row.day] ? `${row.note} · ${googleCheck[row.day]}` : row.note}
            right={property?.google_calendar_id ? (
              <button onClick={() => checkGoogle(row.day)} style={{ ...buttonBase, ...button('secondary'), padding: '4px 10px', fontSize: 12 }}>구글에서 확인</button>
            ) : null} />
        ))}
        <button onClick={() => setShowAllDays(!showAllDays)} style={{ ...buttonBase, ...button('secondary'), marginTop: 10 }}>
          {showAllDays ? '퇴실·확인 필요한 날만 보기' : `모든 날 보기(${slots.rows.length}일)`}
        </button>
      </Step>

      <Step step={STEPS[2]} open={openStep === 3} onToggle={() => setOpenStep(openStep === 3 ? 0 : 3)}>
        {jobs.length === 0 && <div style={{ fontSize: 13, color: '#64748b' }}>앞으로의 청소 일정이 없어요.</div>}
        {jobs.map(job => {
          const schedule = requestScheduleCheck(job, Date.now());
          return (
            <Line key={job.id} level={job.status === 'ESCALATED' ? 'warn' : schedule.ok ? 'ok' : 'warn'}
              title={`${dayLabel(kstDay(job.checkout_at))} 퇴실`} detail={`${jobStatusLabel(job)}${schedule.note ? ` · ${schedule.note}` : ''}`} />
          );
        })}
      </Step>

      <Step step={STEPS[3]} open={openStep === 4} onToggle={() => setOpenStep(openStep === 4 ? 0 : 4)}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>청소 일정</span>
          <select value={selectedJobId}
            onChange={e => { setSelectedJobId(e.target.value); setJobDetail(null); setSelectedDayBlocked([]); setConfirmed(false); loadSelected(e.target.value); }}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="">고르세요</option>
            {selectableJobs.map(job => <option key={job.id} value={job.id}>{dayLabel(kstDay(job.checkout_at))} 퇴실 — {jobStatusLabel(job)}</option>)}
          </select>
        </div>

        {selectedJob && selectedSlot && (
          <div style={{ marginTop: 12 }}>
            <Line level={selectedSlot.level} title="① 그날 칸" detail={selectedSlot.note} />
            <Line level={selectedJob.status === 'PENDING' ? 'info' : 'ok'} title="② 요청" detail={jobStatusLabel(selectedJob)} />
            {progress.map(row => <Line key={`${row.who}-${row.sentAt}`} level="info" title={row.who} detail={`${new Date(row.sentAt).toLocaleString('ko-KR')} 보냄 · ${row.answer}`} />)}
            <Line level={selectedJob.status === 'ASSIGNED' ? 'ok' : 'info'} title="③ 배정"
              detail={selectedJob.status === 'ASSIGNED' ? jobStatusLabel(selectedJob) : '담당자가 예약 링크에서 그날 칸을 예약하면 자동으로 배정돼요'} />

            {selectedJob.status === 'PENDING' && (
              <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', fontSize: 13 }}>
                실제 담당자에게 실제 요청이 가요. 원래 요청 예정일은 <b>{dayLabel(kstDay(selectedJob.dispatch_after))}</b>이에요 — 지금 보내면 그보다 일찍 요청돼요.
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                  실제 담당자에게 요청이 가는 것을 확인했어요
                </label>
                <button onClick={sendRequestNow} disabled={!confirmed || busy}
                  style={{ ...buttonBase, ...button(confirmed ? 'danger' : 'secondary'), marginTop: 10, opacity: confirmed ? 1 : 0.6 }}>
                  지금 요청 보내기
                </button>
              </div>
            )}

            {selectedJob.status !== 'PENDING' && selectedJob.status !== 'ASSIGNED' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => loadSelected()} disabled={busy} style={{ ...buttonBase, ...button('secondary') }}>진행 상황 새로고침</button>
                <button onClick={rescanCalendar} disabled={busy || !property?.google_calendar_id} style={{ ...buttonBase, ...button('primary') }}>
                  캘린더 다시 확인(예약했는데 배정이 안 될 때)
                </button>
              </div>
            )}
          </div>
        )}
      </Step>
    </div>
  );
}
