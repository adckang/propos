import { useState, useEffect, useCallback } from 'react';
import Toast from '../../utils/toast';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const TIER_LABELS = {
  VIP_1: 'VIP 1순위', VIP_2: 'VIP 2순위', VIP_3: 'VIP 3순위', BULK: '일반',
};
const TIER_COLORS = {
  VIP_1: '#7c3aed', VIP_2: '#2563eb', VIP_3: '#0891b2', BULK: '#6b7280',
};
const STATUS_META = {
  PENDING:         { label: '대기',        color: '#6b7280', bg: '#f3f4f6' },
  NOTIFYING_VIP_1: { label: 'VIP1 발송',   color: '#7c3aed', bg: '#f5f0ff' },
  NOTIFYING_VIP_2: { label: 'VIP2 발송',   color: '#2563eb', bg: '#eff6ff' },
  NOTIFYING_VIP_3: { label: 'VIP3 발송',   color: '#0891b2', bg: '#e0f2fe' },
  NOTIFYING_BULK:  { label: '일반 발송',    color: '#d97706', bg: '#fffbeb' },
  BULK_REMINDED:   { label: '리마인드',     color: '#b45309', bg: '#fef3c7' },
  ESCALATED:       { label: '에스컬레이션', color: '#dc2626', bg: '#fef2f2' },
  ASSIGNED:        { label: '배정완료',     color: '#059669', bg: '#d1fae5' },
  COMPLETED:       { label: '완료',         color: '#10b981', bg: '#ecfdf5' },
};
const ALL_STATUSES = Object.keys(STATUS_META);
const TIERS = ['VIP_1', 'VIP_2', 'VIP_3', 'BULK'];

// ── 공유 스타일 ───────────────────────────────────────────────────────────────

const labelStyle = { fontSize: 12, fontWeight: 600, color: '#4a5568', marginBottom: 5 };
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
  fontSize: 13, color: '#1a202c', outline: 'none', fontFamily: 'inherit',
  background: '#fff',
};
const monoInputStyle = { ...inputStyle, fontFamily: "'DM Mono', monospace" };
const editBtnStyle = {
  border: '1.5px solid #e2e8f0', borderRadius: 7, background: '#fff',
  padding: '4px 10px', fontSize: 12, color: '#4a5568', cursor: 'pointer',
  fontFamily: 'inherit',
};
const deleteBtnStyle = {
  border: '1.5px solid #fca5a5', borderRadius: 7, background: '#fff',
  padding: '4px 10px', fontSize: 12, color: '#dc2626', cursor: 'pointer',
  fontFamily: 'inherit',
};
const saveBtnStyle = {
  flex: 2, border: '1.5px solid #2563eb', borderRadius: 8, background: '#2563eb',
  color: '#fff', padding: '8px 0', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const cancelBtnStyle = {
  flex: 1, border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff',
  color: '#4a5568', padding: '8px 0', fontSize: 13,
  cursor: 'pointer', fontFamily: 'inherit',
};

// ── API 헬퍼 ──────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const ct = r.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body?.error ?? body ?? r.statusText);
  return body;
}

// ── CleanerForm ───────────────────────────────────────────────────────────────

function CleanerForm({ form, setForm, onSave, onCancel }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={labelStyle}>이름</div>
          <input type="text" value={form.name ?? ''} onChange={e => set('name', e.target.value)}
            placeholder="홍길동" style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>전화번호</div>
          <input type="text" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)}
            placeholder="010-1234-5678" style={monoInputStyle} />
        </div>
        <div>
          <div style={labelStyle}>이메일</div>
          <input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)}
            placeholder="cleaner@example.com" style={monoInputStyle} />
        </div>
        <div>
          <div style={labelStyle}>등급</div>
          <select value={form.tier ?? 'BULK'} onChange={e => set('tier', e.target.value)}
            style={inputStyle}>
            {TIERS.map(t => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={labelStyle}>메모 (선택)</div>
        <input type="text" value={form.notes ?? ''} onChange={e => set('notes', e.target.value)}
          placeholder="특이사항" style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={cancelBtnStyle}>취소</button>
        <button onClick={onSave} style={saveBtnStyle}>저장</button>
      </div>
    </div>
  );
}

// ── CleanersPanel ─────────────────────────────────────────────────────────────

function CleanersPanel() {
  const [cleaners, setCleaners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCleaners(await apiFetch('/api/cleaning/cleaners'));
    } catch (e) {
      Toast.show('청소자 목록 로드 실패: ' + e.message, 'e');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(c) {
    setEditId(c.id);
    setForm({ name: c.name, phone: c.phone, email: c.email, tier: c.tier, notes: c.notes ?? '' });
  }

  function startAdd() {
    setEditId('new');
    setForm({ name: '', phone: '', email: '', tier: 'BULK', notes: '' });
  }

  async function save() {
    try {
      if (editId === 'new') {
        await apiFetch('/api/cleaning/cleaners', { method: 'POST', body: JSON.stringify(form) });
        Toast.show('청소자 등록 완료', 's');
      } else {
        await apiFetch(`/api/cleaning/cleaners/${editId}`, { method: 'PATCH', body: JSON.stringify(form) });
        Toast.show('청소자 수정 완료', 's');
      }
      setEditId(null);
      await load();
    } catch (e) {
      Toast.show('저장 실패: ' + e.message, 'e');
    }
  }

  async function deactivate(id) {
    try {
      await apiFetch(`/api/cleaning/cleaners/${id}`, { method: 'DELETE' });
      Toast.show('비활성화 완료', 's');
      await load();
    } catch (e) {
      Toast.show('비활성화 실패: ' + e.message, 'e');
    }
  }

  async function activate(id) {
    try {
      await apiFetch(`/api/cleaning/cleaners/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
      Toast.show('활성화 완료', 's');
      await load();
    } catch (e) {
      Toast.show('활성화 실패: ' + e.message, 'e');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a202c' }}>청소자 목록</div>
        <button onClick={startAdd} style={{
          border: '1.5px solid #2563eb', borderRadius: 8, background: '#2563eb',
          color: '#fff', padding: '7px 16px', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>+ 청소자 추가</button>
      </div>

      {editId === 'new' && (
        <div style={{
          background: '#eff6ff', borderRadius: 12, padding: 16, marginBottom: 16,
          border: '1.5px solid #bfdbfe',
        }}>
          <CleanerForm form={form} setForm={setForm} onSave={save} onCancel={() => setEditId(null)} />
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: '#6b7280', padding: 40 }}>불러오는 중...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cleaners.length === 0 && (
            <div style={{
              textAlign: 'center', color: '#6b7280', padding: 40,
              background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            }}>
              등록된 청소자가 없습니다.
            </div>
          )}
          {cleaners.map(c => (
            <div key={c.id} style={{
              background: '#fff', borderRadius: 12, padding: '12px 16px',
              border: '1px solid #e2e8f0', opacity: c.active ? 1 : 0.55,
            }}>
              {editId === c.id ? (
                <CleanerForm form={form} setForm={setForm} onSave={save} onCancel={() => setEditId(null)} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    background: (TIER_COLORS[c.tier] ?? '#6b7280') + '18',
                    color: TIER_COLORS[c.tier] ?? '#6b7280',
                    border: `1px solid ${(TIER_COLORS[c.tier] ?? '#6b7280')}40`,
                    borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700,
                    flexShrink: 0,
                  }}>{TIER_LABELS[c.tier] ?? c.tier}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1a202c' }}>{c.name}</div>
                    <div style={{
                      fontSize: 12, color: '#6b7280', fontFamily: "'DM Mono', monospace",
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{c.phone} · {c.email}</div>
                  </div>
                  <button onClick={() => startEdit(c)} style={editBtnStyle}>수정</button>
                  {c.active ? (
                    <button onClick={() => deactivate(c.id)} style={deleteBtnStyle}>비활성화</button>
                  ) : (
                    <button onClick={() => activate(c.id)} style={{
                      border: '1.5px solid #10b981', borderRadius: 7, background: '#10b981',
                      color: '#fff', padding: '5px 12px', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                    }}>활성화</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PropertyPanel ─────────────────────────────────────────────────────────────

function PropertyPanel({ syncConfig, liveProperty }) {
  const propertyId = syncConfig?.id ?? null;
  const [form, setForm] = useState({
    property_id: propertyId ?? '',
    name: syncConfig?.name ?? '',
    checkout_hour: syncConfig?.checkOutHour ?? 11,
    cleaning_duration_hours: syncConfig?.cleaningDurationHours ?? 2.5,
    google_calendar_id: '',
    google_calendar_booking_url: '',
    host_phone: '',
    ical_url: '',
  });
  const [icalAlreadySet, setIcalAlreadySet] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    apiFetch('/api/cleaning/properties').then(list => {
      const found = list.find(p => p.property_id === propertyId);
      if (found) {
        setSaved(true);
        setIcalAlreadySet(!!found.ical_url);
        setForm({
          property_id: found.property_id,
          name: found.name,
          checkout_hour: found.checkout_hour,
          cleaning_duration_hours: found.cleaning_duration_hours,
          google_calendar_id: found.google_calendar_id ?? '',
          google_calendar_booking_url: found.google_calendar_booking_url ?? '',
          host_phone: found.host_phone ?? '',
          ical_url: '',
        });
      }
    }).catch(() => {});
  }, [propertyId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setLoading(true);
    try {
      await apiFetch('/api/cleaning/properties', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          google_calendar_id: form.google_calendar_id || null,
          google_calendar_booking_url: form.google_calendar_booking_url || null,
          ical_url: form.ical_url || null,
        }),
      });
      setSaved(true);
      Toast.show('숙소 청소 설정 저장 완료', 's');
    } catch (e) {
      Toast.show('저장 실패: ' + e.message, 'e');
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!saved) {
      Toast.show('숙소 설정을 먼저 저장하세요.', 'w');
      return;
    }
    const reservations = liveProperty?.reservations ?? [];
    const today = new Date();
    const checkouts = reservations
      .filter(r => {
        const co = r.checkOut instanceof Date ? r.checkOut : r.checkOut ? new Date(r.checkOut) : null;
        return co && co > today;
      })
      .map(r => {
        const co = r.checkOut instanceof Date ? r.checkOut : new Date(r.checkOut);
        return { date: co.toISOString().slice(0, 10), uid: r.uid };
      });

    if (!checkouts.length) {
      Toast.show('동기화할 미래 체크아웃이 없습니다. 대시보드에서 iCal을 먼저 연동하세요.', 'w');
      return;
    }

    setSyncing(true);
    try {
      const result = await apiFetch('/api/cleaning/jobs', {
        method: 'POST',
        body: JSON.stringify({ property_id: form.property_id, checkouts }),
      });
      Toast.show(`청소 일정 동기화 완료 — 신규 ${result.created}건, 기존 ${result.skipped}건`, 's');
    } catch (e) {
      Toast.show('동기화 실패: ' + e.message, 'e');
    } finally {
      setSyncing(false);
    }
  }

  async function handleServerSync() {
    setSyncing(true);
    try {
      const result = await apiFetch('/api/cleaning/ical-sync', {
        method: 'POST',
        body: JSON.stringify({ property_id: propertyId }),
      });
      Toast.show(`서버 iCal 동기화 완료 — 신규 ${result.created}건 생성`, 's');
    } catch (e) {
      Toast.show('서버 동기화 실패: ' + e.message, 'e');
    } finally {
      setSyncing(false);
    }
  }

  const reservations = liveProperty?.reservations ?? [];
  const today = new Date();
  const futureCount = reservations.filter(r => {
    const co = r.checkOut instanceof Date ? r.checkOut : r.checkOut ? new Date(r.checkOut) : null;
    return co && co > today;
  }).length;

  if (!propertyId) {
    return (
      <div style={{
        textAlign: 'center', color: '#6b7280', padding: 60,
        background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
      }}>
        대시보드에서 캘린더 설정을 먼저 완료해주세요.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 설정 폼 */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a202c', marginBottom: 16 }}>
          숙소 청소 설정
          <span style={{
            marginLeft: 8, fontFamily: "'DM Mono', monospace",
            fontWeight: 400, fontSize: 12, color: '#9ca3af',
          }}>{propertyId}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <div style={labelStyle}>숙소 이름</div>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="파주 게스트하우스" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>체크아웃 시각</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" value={form.checkout_hour}
                onChange={e => set('checkout_hour', parseInt(e.target.value, 10))}
                min={8} max={14} style={{ ...inputStyle, width: 80 }} />
              <span style={{ fontSize: 13, color: '#6b7280' }}>시</span>
            </div>
          </div>
          <div>
            <div style={labelStyle}>청소 소요 시간</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" value={form.cleaning_duration_hours}
                onChange={e => set('cleaning_duration_hours', parseFloat(e.target.value))}
                min={0.5} max={8} step={0.5} style={{ ...inputStyle, width: 80 }} />
              <span style={{ fontSize: 13, color: '#6b7280' }}>시간</span>
            </div>
          </div>
          <div />
          <div>
            <div style={labelStyle}>호스트 연락처 (선택)</div>
            <input type="tel" value={form.host_phone}
              onChange={e => set('host_phone', e.target.value)}
              placeholder="010-1234-5678" style={monoInputStyle} />
          </div>
          <div />
          <div>
            <div style={labelStyle}>Google Calendar ID (선택)</div>
            <input type="text" value={form.google_calendar_id}
              onChange={e => set('google_calendar_id', e.target.value)}
              placeholder="abc@group.calendar.google.com" style={monoInputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Google 예약 URL (선택)</div>
            <input type="url" value={form.google_calendar_booking_url}
              onChange={e => set('google_calendar_booking_url', e.target.value)}
              placeholder="https://calendar.google.com/..." style={monoInputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={labelStyle}>
              Airbnb iCal URL
              {icalAlreadySet && (
                <span style={{ marginLeft: 6, color: '#059669', fontWeight: 400, fontSize: 11 }}>
                  ✓ 설정됨 (변경 시에만 입력)
                </span>
              )}
            </div>
            <input type="url" value={form.ical_url}
              onChange={e => set('ical_url', e.target.value)}
              placeholder={icalAlreadySet ? '(유지됨) 변경 시에만 입력' : 'https://www.airbnb.com/calendar/ical/...'}
              style={monoInputStyle} />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              서버 폴링용 (Gmail 예약 감지 시 자동 iCal 재폴링). 입력하지 않으면 기존 값 유지.
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={loading} style={{
          border: '1.5px solid #2563eb', borderRadius: 8, background: loading ? '#93c5fd' : '#2563eb',
          color: '#fff', padding: '9px 24px', fontSize: 13, fontWeight: 700,
          cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
        }}>{loading ? '저장 중...' : '설정 저장'}</button>
      </div>

      {/* iCal 동기화 */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a202c', marginBottom: 8 }}>
          Airbnb 체크아웃 → 청소 일정 생성
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.6 }}>
          이미 등록된 일정은 건너뜁니다.
        </div>

        {/* 방법 A: 서버 직접 iCal 폴링 (DB에 iCal URL 설정된 경우) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            방법 A — 서버 직접 폴링
            <span style={{ marginLeft: 6, fontWeight: 400, color: '#9ca3af' }}>
              (DB에 iCal URL 저장된 경우 · 권장)
            </span>
          </div>
          <button onClick={handleServerSync} disabled={syncing || !icalAlreadySet} style={{
            border: `1.5px solid ${icalAlreadySet ? '#7c3aed' : '#e2e8f0'}`,
            borderRadius: 8,
            background: icalAlreadySet ? (syncing ? '#c4b5fd' : '#7c3aed') : '#f3f4f6',
            color: icalAlreadySet ? '#fff' : '#9ca3af',
            padding: '9px 24px', fontSize: 13, fontWeight: 700,
            cursor: syncing || !icalAlreadySet ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}>
            {syncing ? '동기화 중...' : '서버 직접 동기화'}
          </button>
          {!icalAlreadySet && (
            <span style={{ marginLeft: 10, fontSize: 12, color: '#f59e0b' }}>
              위 Airbnb iCal URL을 입력 후 설정 저장 필요
            </span>
          )}
        </div>

        {/* 방법 B: 대시보드 파싱 결과 기반 (기존 방식) */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            방법 B — 대시보드 예약 기반
            <span style={{ marginLeft: 6, fontWeight: 400, color: '#9ca3af' }}>
              {futureCount > 0
                ? <span style={{ color: '#2563eb' }}>{futureCount}건 감지됨</span>
                : '(대시보드에서 iCal 연동 후 사용 가능)'}
            </span>
          </div>
          <button onClick={handleSync} disabled={syncing || !saved || !futureCount} style={{
            border: `1.5px solid ${saved && futureCount ? '#059669' : '#e2e8f0'}`,
            borderRadius: 8,
            background: saved && futureCount ? (syncing ? '#6ee7b7' : '#059669') : '#f3f4f6',
            color: saved && futureCount ? '#fff' : '#9ca3af',
            padding: '9px 24px', fontSize: 13, fontWeight: 700,
            cursor: syncing || !saved || !futureCount ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}>{syncing ? '동기화 중...' : `청소 일정 동기화 (${futureCount}건)`}</button>
        </div>
      </div>
    </div>
  );
}

// ── JobsPanel ─────────────────────────────────────────────────────────────────

function JobsPanel() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [notifCache, setNotifCache] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter
        ? `?status=${encodeURIComponent(statusFilter)}`
        : '?limit=100';
      setJobs(await apiFetch(`/api/cleaning/jobs${qs}`));
    } catch (e) {
      Toast.show('청소 일정 로드 실패: ' + e.message, 'e');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (notifCache[id]) return;
    try {
      const data = await apiFetch(`/api/cleaning/jobs/${id}`);
      setNotifCache(prev => ({ ...prev, [id]: data.notifs ?? [] }));
    } catch { /* 상세 로드 실패 시 빈 배열 표시 */ }
  }

  async function dispatch(jobId, e) {
    e.stopPropagation();
    try {
      await apiFetch('/api/cleaning/dispatch', { method: 'POST', body: JSON.stringify({ job_id: jobId }) });
      Toast.show('발송 시작됨', 's');
      await load();
    } catch (e2) {
      Toast.show('발송 실패: ' + e2.message, 'e');
    }
  }

  async function cancelJob(jobId, e) {
    e.stopPropagation();
    try {
      await apiFetch(`/api/cleaning/jobs?id=${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      Toast.show('일정 취소 완료', 's');
      await load();
    } catch (e2) {
      Toast.show('취소 실패: ' + e2.message, 'e');
    }
  }

  const CANCELLABLE = new Set(['PENDING','NOTIFYING_VIP_1','NOTIFYING_VIP_2','NOTIFYING_VIP_3','NOTIFYING_BULK','BULK_REMINDED','ESCALATED']);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', flex: 1 }}>청소 일정</div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{
          border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '7px 10px',
          fontSize: 13, color: '#4a5568', fontFamily: 'inherit', background: '#fff',
          cursor: 'pointer',
        }}>
          <option value="">전체 상태</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
          ))}
        </select>
        <button onClick={load} style={editBtnStyle}>↺ 새로고침</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#6b7280', padding: 40 }}>불러오는 중...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {jobs.length === 0 && (
            <div style={{
              textAlign: 'center', color: '#6b7280', padding: 40,
              background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            }}>청소 일정이 없습니다.</div>
          )}
          {jobs.map(j => {
            const meta = STATUS_META[j.status] ?? { label: j.status, color: '#6b7280', bg: '#f3f4f6' };
            const startDate = new Date(j.cleaning_start_at);
            const dateStr = startDate.toLocaleDateString('ko-KR', {
              month: 'numeric', day: 'numeric', weekday: 'short',
            });
            const timeStr = startDate.toLocaleTimeString('ko-KR', {
              hour: '2-digit', minute: '2-digit',
            });
            const isExpanded = expandedId === j.id;
            const jobNotifs = notifCache[j.id];

            return (
              <div key={j.id} style={{
                background: '#fff', borderRadius: 12,
                border: `1px solid ${isExpanded ? '#bfdbfe' : '#e2e8f0'}`,
                overflow: 'hidden', transition: 'border-color 0.15s',
              }}>
                {/* 요약 행 */}
                <div
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  onClick={() => toggleExpand(j.id)}
                >
                  <span style={{
                    background: meta.bg, color: meta.color,
                    border: `1px solid ${meta.color}30`,
                    borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700,
                    flexShrink: 0,
                  }}>{meta.label}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1a202c' }}>
                      {j.property_name ?? j.property_id}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'DM Mono', monospace" }}>
                      {dateStr} {timeStr}
                      {j.cleaner_name ? ` · ${j.cleaner_name}` : ''}
                    </div>
                  </div>

                  {j.status === 'PENDING' && (
                    <button onClick={e => dispatch(j.id, e)} style={{
                      border: '1.5px solid #2563eb', borderRadius: 7, background: '#fff',
                      color: '#2563eb', padding: '5px 12px', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                    }}>발송 시작</button>
                  )}
                  {CANCELLABLE.has(j.status) && (
                    <button onClick={e => cancelJob(j.id, e)} style={{
                      border: '1.5px solid #dc2626', borderRadius: 7, background: '#fff',
                      color: '#dc2626', padding: '5px 10px', fontSize: 11, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                    }}>취소</button>
                  )}

                  <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {/* 발송 내역 */}
                {isExpanded && (
                  <div style={{
                    borderTop: '1px solid #f1f5f9', padding: '12px 16px', background: '#fafafa',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 10 }}>
                      발송 내역 {jobNotifs ? `(${jobNotifs.length}건)` : '불러오는 중...'}
                    </div>
                    {(jobNotifs ?? []).map(n => {
                      const tierColor = TIER_COLORS[n.tier] ?? '#6b7280';
                      const responseColor =
                        n.response === 'DECLINED' ? '#dc2626' :
                        n.response === 'DECLINED_AFTER_ASSIGNED' ? '#d97706' :
                        n.response == null ? '#9ca3af' : '#059669';
                      const responseLabel =
                        n.response === 'DECLINED' ? '거절' :
                        n.response === 'DECLINED_AFTER_ASSIGNED' ? '배정후거절' :
                        n.response == null ? (n.reminded_at ? '리마인드됨' : '응답대기') : n.response;

                      return (
                        <div key={n.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f1f5f9',
                        }}>
                          <span style={{
                            background: tierColor + '18', color: tierColor,
                            border: `1px solid ${tierColor}40`,
                            borderRadius: 5, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                            flexShrink: 0,
                          }}>{TIER_LABELS[n.tier] ?? n.tier}</span>
                          <span style={{ flex: 1, color: '#1a202c', fontWeight: 600 }}>{n.cleaner_name}</span>
                          <span style={{ color: '#6b7280', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                            {n.phone}
                          </span>
                          <span style={{ color: responseColor, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                            {responseLabel}
                          </span>
                        </div>
                      );
                    })}
                    {jobNotifs && jobNotifs.length === 0 && (
                      <div style={{ color: '#9ca3af', fontSize: 13 }}>발송 내역 없음</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── WorkerApprovalPanel ───────────────────────────────────────────────────────

const FCM_STATUS_LABEL = {
  active:       '앱 활성',
  inactive:     '장기 미접속',
  invalid:      '토큰 오류',
  unregistered: '앱 삭제됨',
  uninstalled:  'SMS 전용',
};

function approvalStatusLabel(c) {
  if (!c.active && c.app_installed_at) return '앱 설치됨 · 승인 대기';
  if (!c.active)                        return '승인 대기';
  if (c.fcm_status === 'active')        return '활성 (앱)';
  if (c.fcm_status === 'inactive')      return '활성 (장기 미접속)';
  return '활성 (SMS)';
}

function WorkerApprovalPanel() {
  const [cleaners, setCleaners] = useState([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/cleaning/cleaners');
      setCleaners(data);
    } catch (e) {
      Toast.show(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setActive = async (id, approve) => {
    try {
      await apiFetch(`/api/cleaning/cleaners/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: approve }),
      });
      Toast.show(approve ? '승인 완료' : '비활성화 완료', 'success');
      load();
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  };

  const pending = cleaners.filter(c => !c.active);
  const active  = cleaners.filter(c => c.active);

  const cardStyle = {
    background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 10,
    padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
  };

  const renderRow = (c, isPending) => (
    <div key={c.id} style={cardStyle}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: isPending ? '#fef3c7' : '#d1fae5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 700,
        color: isPending ? '#92400e' : '#065f46',
      }}>
        {(c.name ?? c.phone ?? '?')[0]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c' }}>
          {c.name ?? '이름 없음'}
          <span style={{
            marginLeft: 8, fontSize: 11, fontWeight: 600,
            color: TIER_COLORS[c.tier] ?? '#6b7280',
          }}>{TIER_LABELS[c.tier]}</span>
        </div>
        <div style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
          {c.phone}
          {c.email && <span style={{ marginLeft: 8 }}>{c.email}</span>}
        </div>
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
            background: isPending ? '#fef3c7' : '#d1fae5',
            color: isPending ? '#92400e' : '#065f46',
            border: `1px solid ${isPending ? '#fde68a' : '#6ee7b7'}`,
          }}>{approvalStatusLabel(c)}</span>
          {!isPending && c.fcm_status && (
            <span style={{
              fontSize: 11, padding: '2px 7px', borderRadius: 10,
              background: '#f1f5f9', color: '#475569',
              border: '1px solid #e2e8f0',
            }}>{FCM_STATUS_LABEL[c.fcm_status] ?? c.fcm_status}</span>
          )}
          {c.last_seen_at && (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              최근 접속 {new Date(c.last_seen_at).toLocaleDateString('ko-KR')}
            </span>
          )}
        </div>
      </div>
      {isPending ? (
        <button
          onClick={() => setActive(c.id, true)}
          style={{
            border: '1.5px solid #059669', borderRadius: 8, background: '#059669',
            color: '#fff', padding: '7px 14px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}>승인</button>
      ) : (
        <button
          onClick={() => setActive(c.id, false)}
          style={{
            border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff',
            color: '#64748b', padding: '7px 14px', fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}>비활성화</button>
      )}
    </div>
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>불러오는 중…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 승인 대기 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10, padding: '2px 8px' }}>
            승인 대기 {pending.length}명
          </span>
        </div>
        {pending.length === 0
          ? <div style={{ color: '#94a3b8', fontSize: 13, padding: '12px 0' }}>대기 중인 직원 없음</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{pending.map(c => renderRow(c, true))}</div>
        }
      </div>

      {/* 활성 직원 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#065f46', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '2px 8px' }}>
            활성 직원 {active.length}명
          </span>
        </div>
        {active.length === 0
          ? <div style={{ color: '#94a3b8', fontSize: 13, padding: '12px 0' }}>활성 직원 없음</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{active.map(c => renderRow(c, false))}</div>
        }
      </div>
    </div>
  );
}

// ── 테스트 플로우 패널 ────────────────────────────────────────────────────────

const FLOW_STEPS = [
  { id: 1, icon: '👤', title: '청소자 등록',  sub: '본인 정보로 테스트 청소자 등록' },
  { id: 2, icon: '🔄', title: 'iCal 동기화', sub: '파주201 예약 → 청소 잡 생성' },
  { id: 3, icon: '📋', title: '잡 선택',      sub: 'PENDING 잡 목록에서 테스트할 잡 선택' },
  { id: 4, icon: '📨', title: '알림 발송',    sub: '선택한 잡에 실제 SMS/FCM 발송' },
  { id: 5, icon: '✅', title: '결과 확인',    sub: '발송 상태 + 거절 링크 테스트' },
  { id: 6, icon: '🗑️', title: '테스트 정리',  sub: '잡 취소 + 청소자 비활성화' },
];

function StepBadge({ step, current, done }) {
  const bg = done ? '#10b981' : step === current ? '#2563eb' : '#e2e8f0';
  const color = (done || step === current) ? '#fff' : '#9ca3af';
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%', background: bg, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, flexShrink: 0,
    }}>{done ? '✓' : step}</div>
  );
}

function FlowCard({ step, current, done, children, title, sub, icon }) {
  const isActive = step === current;
  const border = isActive ? '2px solid #2563eb' : done ? '1.5px solid #10b981' : '1.5px solid #e2e8f0';
  const bg = isActive ? '#fff' : done ? '#f0fdf4' : '#fafafa';
  return (
    <div style={{ border, borderRadius: 12, background: bg, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <StepBadge step={step} current={current} done={done} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a202c' }}>{icon} {title}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sub}</div>
        </div>
        {done && !isActive && <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>완료</span>}
      </div>
      {isActive && <div style={{ padding: '0 18px 18px', borderTop: '1px solid #e2e8f0' }}>{children}</div>}
    </div>
  );
}

const resultBox = {
  background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
  padding: '10px 14px', fontSize: 13, color: '#166534', marginTop: 12,
};
const errorBox = {
  background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
  padding: '10px 14px', fontSize: 13, color: '#991b1b', marginTop: 12,
};
const nextBtnStyle = {
  marginTop: 14, border: '1.5px solid #2563eb', borderRadius: 8,
  background: '#2563eb', color: '#fff', padding: '9px 20px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};
const actionBtnStyle = {
  border: '1.5px solid #4f46e5', borderRadius: 8, background: '#4f46e5',
  color: '#fff', padding: '9px 20px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', marginTop: 14,
};
const dangerBtnStyle = {
  border: '1.5px solid #dc2626', borderRadius: 8, background: '#dc2626',
  color: '#fff', padding: '9px 20px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', marginTop: 14,
};

function TestFlowPanel() {
  const [current, setCurrent] = useState(1);
  const [done, setDone] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // 단계별 데이터
  const [cleanerForm, setCleanerForm] = useState({ name: '테스트(나)', phone: '', email: 'nam5821@gmail.com', tier: 'VIP_1' });
  const [cleanerId, setCleanerId] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);
  const [cleanupDone, setCleanupDone] = useState({ job: false, cleaner: false });

  function markDone(step) { setDone(prev => new Set([...prev, step])); }
  function go(step) { setCurrent(step); setErr(''); }

  // Step 1: 청소자 등록
  async function doRegister() {
    if (!cleanerForm.phone) { setErr('전화번호를 입력하세요'); return; }
    setLoading(true); setErr('');
    try {
      const res = await apiFetch('/api/cleaning/cleaners', {
        method: 'POST', body: JSON.stringify(cleanerForm),
      });
      setCleanerId(res.id);
      markDone(1); go(2);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 2: iCal 동기화
  async function doSync() {
    setLoading(true); setErr('');
    try {
      const res = await apiFetch('/api/cleaning/ical-sync', {
        method: 'POST', body: JSON.stringify({ property_id: 'paju201' }),
      });
      setSyncResult(res);
      // PENDING 잡 조회
      const jobList = await apiFetch('/api/cleaning/jobs?status=PENDING');
      setJobs(jobList);
      markDone(2); go(3);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 3: 잡 선택
  async function loadJobs() {
    setLoading(true); setErr('');
    try {
      const jobList = await apiFetch('/api/cleaning/jobs');
      setJobs(jobList.filter(j => !['ASSIGNED','COMPLETED','CANCELLED'].includes(j.status)));
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  function selectJob(job) {
    setSelectedJob(job);
    markDone(3); go(4);
  }

  // Step 4: 알림 발송
  async function doDispatch() {
    if (!selectedJob) return;
    setLoading(true); setErr('');
    try {
      const res = await apiFetch(`/api/cleaning/dispatch`, {
        method: 'POST', body: JSON.stringify({ job_id: selectedJob.id }),
      });
      setDispatchResult(res);
      markDone(4); go(5);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 5: 결과 확인
  async function loadJobDetail() {
    if (!selectedJob) return;
    setLoading(true); setErr('');
    try {
      const res = await apiFetch(`/api/cleaning/jobs/${selectedJob.id}`);
      setJobDetail(res);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 6: 정리
  async function cancelJob() {
    if (!selectedJob) return;
    setLoading(true); setErr('');
    try {
      await apiFetch(`/api/cleaning/jobs?id=${selectedJob.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }),
      });
      setCleanupDone(p => ({ ...p, job: true }));
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  async function deactivateCleaner() {
    if (!cleanerId) return;
    setLoading(true); setErr('');
    try {
      await apiFetch(`/api/cleaning/cleaners/${cleanerId}`, { method: 'DELETE' });
      setCleanupDone(p => ({ ...p, cleaner: true }));
      if (cleanupDone.job || !selectedJob) { markDone(6); }
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  const fmtDt = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <div>
      <div style={{ marginBottom: 20, padding: '14px 18px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>청소 자동화 테스트 플로우</div>
        <div style={{ fontSize: 12, color: '#3b82f6' }}>본인 정보로 전체 시나리오를 단계별 검증합니다. 각 단계 완료 후 다음 단계가 활성화됩니다.</div>
      </div>

      {/* Step 1 */}
      <FlowCard step={1} current={current} done={done.has(1)} icon='👤' title='청소자 등록' sub='본인 정보로 테스트 청소자 등록'>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: '이름', key: 'name', placeholder: '홍길동' },
            { label: '전화번호', key: 'phone', placeholder: '010-1234-5678' },
            { label: '이메일', key: 'email', placeholder: 'you@gmail.com' },
          ].map(f => (
            <div key={f.key} style={f.key === 'email' ? { gridColumn: '1/-1' } : {}}>
              <div style={labelStyle}>{f.label}</div>
              <input value={cleanerForm[f.key]} onChange={e => setCleanerForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={inputStyle} />
            </div>
          ))}
          <div>
            <div style={labelStyle}>티어</div>
            <select value={cleanerForm.tier} onChange={e => setCleanerForm(p => ({ ...p, tier: e.target.value }))} style={inputStyle}>
              {TIERS.map(t => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
            </select>
          </div>
        </div>
        {err && current === 1 && <div style={errorBox}>{err}</div>}
        <button onClick={doRegister} disabled={loading} style={actionBtnStyle}>
          {loading ? '등록 중...' : '청소자 등록'}
        </button>
        {cleanerId && <div style={resultBox}>✅ 등록 완료 — ID: <code>{cleanerId}</code></div>}
      </FlowCard>

      {/* Step 2 */}
      <FlowCard step={2} current={current} done={done.has(2)} icon='🔄' title='iCal 동기화' sub='파주201 예약 → 청소 잡 생성'>
        <div style={{ marginTop: 14, fontSize: 13, color: '#4a5568' }}>
          Vercel 서버가 Airbnb iCal을 직접 폴링하여 <code>cleaning_jobs</code>를 생성합니다.<br/>
          <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠️ 14일 이내 예약이 있으면 등록된 청소자(VIP_1)에게 즉시 알림이 발송됩니다.</span>
        </div>
        {err && current === 2 && <div style={errorBox}>{err}</div>}
        <button onClick={doSync} disabled={loading} style={actionBtnStyle}>
          {loading ? '동기화 중...' : '서버 iCal 동기화 실행'}
        </button>
        {syncResult && (
          <div style={resultBox}>
            ✅ 동기화 완료 — 신규 {syncResult.created}건 생성<br/>
            {jobs.length > 0 && `PENDING 잡 ${jobs.length}건 조회됨 → 다음 단계에서 선택`}
          </div>
        )}
      </FlowCard>

      {/* Step 3 */}
      <FlowCard step={3} current={current} done={done.has(3)} icon='📋' title='잡 선택' sub='발송할 청소 잡 하나 선택'>
        <div style={{ marginTop: 14 }}>
          <button onClick={loadJobs} disabled={loading} style={{ ...editBtnStyle, marginBottom: 10 }}>
            {loading ? '...' : '🔄 목록 새로고침'}
          </button>
          {err && current === 3 && <div style={errorBox}>{err}</div>}
          {jobs.length === 0 && <div style={{ fontSize: 13, color: '#9ca3af' }}>잡이 없습니다. 2단계를 먼저 실행하세요.</div>}
          {jobs.map(job => {
            const meta = STATUS_META[job.status] ?? { label: job.status, color: '#6b7280', bg: '#f3f4f6' };
            const isSelected = selectedJob?.id === job.id;
            return (
              <div key={job.id} onClick={() => setSelectedJob(job)} style={{
                border: `1.5px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                borderRadius: 8, padding: '10px 14px', marginBottom: 8,
                background: isSelected ? '#eff6ff' : '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{job.property_name ?? job.property_id}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'DM Mono', monospace" }}>
                    청소 {fmtDt(job.cleaning_start_at)}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{job.source}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 6, padding: '3px 8px' }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
          {selectedJob && (
            <button onClick={() => { markDone(3); go(4); }} style={nextBtnStyle}>
              선택 확정 → 알림 발송 단계로
            </button>
          )}
        </div>
      </FlowCard>

      {/* Step 4 */}
      <FlowCard step={4} current={current} done={done.has(4)} icon='📨' title='알림 발송' sub='선택한 잡에 실제 알림 발송'>
        <div style={{ marginTop: 14 }}>
          {selectedJob && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 4 }}>
              <div><b>숙소:</b> {selectedJob.property_name ?? selectedJob.property_id}</div>
              <div><b>청소 일시:</b> {fmtDt(selectedJob.cleaning_start_at)}</div>
              <div><b>현재 상태:</b> {selectedJob.status}</div>
            </div>
          )}
          <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>
            ⚠️ 등록된 VIP_1 청소자에게 실제 SMS/FCM이 발송됩니다.
          </div>
          {err && current === 4 && <div style={errorBox}>{err}</div>}
          {selectedJob?.status !== 'PENDING'
            ? <div style={{ ...resultBox, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', marginTop: 12 }}>
                이 잡은 이미 {selectedJob?.status} 상태입니다. 이미 발송됐거나 다른 상태입니다.
                <button onClick={() => { markDone(4); go(5); }} style={{ ...nextBtnStyle, marginTop: 8, display: 'block' }}>
                  5단계(결과 확인)로 바로 이동
                </button>
              </div>
            : <button onClick={doDispatch} disabled={loading} style={actionBtnStyle}>
                {loading ? '발송 중...' : '🚀 알림 발송 시작'}
              </button>
          }
          {dispatchResult && <div style={resultBox}>✅ 발송 완료 — VIP_1 알림이 나갔습니다</div>}
        </div>
      </FlowCard>

      {/* Step 5 */}
      <FlowCard step={5} current={current} done={done.has(5)} icon='✅' title='결과 확인' sub='발송 상태 + 거절 링크 테스트'>
        <div style={{ marginTop: 14 }}>
          <button onClick={loadJobDetail} disabled={loading} style={{ ...editBtnStyle, marginBottom: 10 }}>
            {loading ? '...' : '🔄 상태 새로고침'}
          </button>
          {err && current === 5 && <div style={errorBox}>{err}</div>}
          {jobDetail && (
            <div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                <div><b>잡 상태:</b> <span style={{ color: STATUS_META[jobDetail.status]?.color ?? '#1a202c', fontWeight: 700 }}>
                  {STATUS_META[jobDetail.status]?.label ?? jobDetail.status}
                </span></div>
              </div>
              {(jobDetail.notifs ?? []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4a5568', marginBottom: 6 }}>발송 내역</div>
                  {jobDetail.notifs.map(n => (
                    <div key={n.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', marginBottom: 6, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span><b>{n.cleaner_name}</b> ({n.phone})</span>
                        <span style={{ color: '#2563eb', fontWeight: 600 }}>{n.channel ?? 'SMS'}</span>
                      </div>
                      <div style={{ color: '#6b7280', marginTop: 4 }}>발송: {fmtDt(n.sent_at)}</div>
                      {n.response && <div style={{ color: '#dc2626', marginTop: 2 }}>응답: {n.response}</div>}
                      <div style={{ marginTop: 6 }}>
                        <a href={`/api/d/${n.token}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: '#7c3aed', fontFamily: "'DM Mono', monospace" }}>
                          거절 링크 테스트 → /d/{n.token}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={() => { markDone(5); go(6); }} style={nextBtnStyle}>
            6단계(정리)로 이동
          </button>
        </div>
      </FlowCard>

      {/* Step 6 */}
      <FlowCard step={6} current={current} done={done.has(6)} icon='🗑️' title='테스트 정리' sub='잡 취소 + 청소자 비활성화'>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: '#4a5568', marginBottom: 14 }}>
            테스트 데이터를 정리합니다. 각 항목을 개별 처리할 수 있습니다.
          </div>
          {err && current === 6 && <div style={errorBox}>{err}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                잡 취소 {cleanupDone.job && <span style={{ color: '#10b981' }}>✓ 완료</span>}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
                {selectedJob ? `${selectedJob.property_name ?? 'paju201'} 청소 잡 → CANCELLED` : '선택된 잡 없음'}
              </div>
              <button onClick={cancelJob} disabled={loading || cleanupDone.job || !selectedJob} style={dangerBtnStyle}>
                잡 취소
              </button>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                청소자 비활성화 {cleanupDone.cleaner && <span style={{ color: '#10b981' }}>✓ 완료</span>}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
                {cleanerForm.name} ({cleanerForm.phone}) → active: false
              </div>
              <button onClick={deactivateCleaner} disabled={loading || cleanupDone.cleaner || !cleanerId} style={dangerBtnStyle}>
                청소자 비활성화
              </button>
            </div>
          </div>
          {cleanupDone.job && cleanupDone.cleaner && (
            <div style={resultBox}>🎉 모든 테스트 데이터 정리 완료!</div>
          )}
        </div>
      </FlowCard>
    </div>
  );
}

// ── CleaningManager (기본 내보내기) ──────────────────────────────────────────

const TABS = [
  { key: 'approval', label: '직원 승인' },
  { key: 'cleaners', label: '청소자' },
  { key: 'property', label: '숙소 설정' },
  { key: 'jobs',     label: '청소 일정' },
  { key: 'test',     label: '🧪 테스트' },
];

export default function CleaningManager({ syncConfig, liveProperty, onBack }) {
  const [tab, setTab] = useState('cleaners');

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'DM Sans', sans-serif" }}>
      {/* 헤더 */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <button onClick={onBack} style={{
          border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff',
          padding: '6px 12px', fontSize: 13, color: '#4a5568', cursor: 'pointer',
          fontFamily: 'inherit',
        }}>← 뒤로</button>

        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', flex: 1 }}>
          청소 관리
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                border: `1.5px solid ${active ? '#2563eb' : '#e2e8f0'}`,
                borderRadius: 8, padding: '6px 14px',
                background: active ? '#2563eb' : '#fff',
                fontSize: 13, fontWeight: active ? 700 : 400,
                color: active ? '#fff' : '#4a5568',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{t.label}</button>
            );
          })}
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ padding: '24px 20px', maxWidth: 800, margin: '0 auto' }}>
        {tab === 'approval' && <WorkerApprovalPanel />}
        {tab === 'cleaners' && <CleanersPanel />}
        {tab === 'property' && <PropertyPanel syncConfig={syncConfig} liveProperty={liveProperty} />}
        {tab === 'jobs'     && <JobsPanel />}
        {tab === 'test'     && <TestFlowPanel />}
      </div>
    </div>
  );
}
