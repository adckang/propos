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
      const nullIfEmpty = v => (v === '' || v == null) ? null : v;
      await apiFetch('/api/cleaning/properties', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          google_calendar_id: nullIfEmpty(form.google_calendar_id),
          google_calendar_booking_url: nullIfEmpty(form.google_calendar_booking_url),
          host_phone: nullIfEmpty(form.host_phone),
          ical_url: nullIfEmpty(form.ical_url),
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

  const [watchStatus, setWatchStatus] = useState(null);
  const [watchLoading, setWatchLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/gmail/watch').then(res => {
      if (res.status === 'unknown') return;
      const exp = res.expiration ? new Date(Number(res.expiration)) : null;
      const expStr = exp ? exp.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      setWatchStatus({ ok: res.status === 'active', expiration: expStr, expired: res.status === 'expired' });
    }).catch(() => {});
  }, []);

  async function handleRegisterWatch() {
    setWatchLoading(true);
    setWatchStatus(null);
    try {
      const result = await apiFetch('/api/gmail/watch', { method: 'POST' });
      const exp = result.expiration ? new Date(Number(result.expiration)) : null;
      const expStr = exp ? exp.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '알 수 없음';
      setWatchStatus({ ok: true, expiration: expStr });
      Toast.show(`Gmail Watch 등록 완료 — ${expStr}까지 유효`, 's');
    } catch (e) {
      setWatchStatus({ ok: false, error: e.message });
      Toast.show('Gmail Watch 등록 실패: ' + e.message, 'e');
    } finally {
      setWatchLoading(false);
    }
  }

  const reservations = liveProperty?.reservations ?? [];
  const today = new Date();
  const futureCount = reservations.filter(r => {
    const co = r.checkOut instanceof Date ? r.checkOut : r.checkOut ? new Date(r.checkOut) : null;
    return co && co > today;
  }).length;

  const gmailWatchBlock = (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a202c', marginBottom: 4 }}>
        Gmail Watch 상태
      </div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14, lineHeight: 1.6 }}>
        에어비앤비 예약 이메일 감지용. 7일마다 만료되며 매주 월요일 자동 갱신됩니다.
        청소 일정이 자동 생성되지 않으면 아래에서 수동 재등록하세요.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={handleRegisterWatch} disabled={watchLoading} style={{
          border: '1.5px solid #d97706',
          borderRadius: 8,
          background: watchLoading ? '#fde68a' : '#d97706',
          color: '#fff',
          padding: '9px 24px', fontSize: 13, fontWeight: 700,
          cursor: watchLoading ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
        }}>
          {watchLoading ? '등록 중...' : 'Gmail Watch 재등록'}
        </button>
        {watchStatus && (
          <span style={{
            fontSize: 13,
            color: watchStatus.expired ? '#dc2626' : watchStatus.ok ? '#059669' : '#dc2626',
            fontWeight: 600,
          }}>
            {watchStatus.expired
              ? '❌ 만료됨 — 재등록이 필요해요'
              : watchStatus.ok
                ? `✅ 정상 — ${watchStatus.expiration}까지 유효`
                : `❌ 실패: ${watchStatus.error}`}
          </span>
        )}
      </div>
    </div>
  );

  if (!propertyId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {gmailWatchBlock}
        <div style={{
          textAlign: 'center', color: '#6b7280', padding: 60,
          background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
        }}>
          대시보드에서 캘린더 설정을 먼저 완료해주세요.
        </div>
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

      {gmailWatchBlock}
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
      const raw = await apiFetch(`/api/cleaning/jobs${qs}`);
      setJobs([...raw].sort((a, b) => new Date(a.cleaning_start_at) - new Date(b.cleaning_start_at)));
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
              year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
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
  { id: 2, icon: '🗓️', title: '잡 생성',     sub: '체크아웃 날짜 직접 입력 → PENDING 잡 생성' },
  { id: 3, icon: '📋', title: '잡 선택',      sub: 'PENDING 잡 목록에서 테스트할 잡 선택' },
  { id: 4, icon: '📨', title: '알림 발송',    sub: '선택한 잡에 실제 SMS/FCM 수동 발송' },
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
  const [step1Mode, setStep1Mode] = useState('existing'); // 'existing' | 'new'
  const [existingCleaners, setExistingCleaners] = useState([]);
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [cleanerForm, setCleanerForm] = useState({ name: '', phone: '', email: 'nam5821@gmail.com', tier: 'VIP_1' });
  const [cleanerId, setCleanerId] = useState(null);
  const [cleanerName, setCleanerName] = useState('');

  // Step 2: 수동 잡 생성
  const defaultTestDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  };
  const minTestDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const [testDate, setTestDate] = useState(defaultTestDate);
  const [testPropertyId, setTestPropertyId] = useState('prop_1786259455129');
  const [properties, setProperties] = useState([]);
  const [createResult, setCreateResult] = useState(null);

  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);
  const [cleanupDone, setCleanupDone] = useState({ job: false, cleaner: false });

  // 숙소 목록 + 기존 청소자 초기 로드
  useEffect(() => {
    apiFetch('/api/cleaning/properties').then(setProperties).catch(() => {});
    apiFetch('/api/cleaning/cleaners').then(list => {
      setExistingCleaners(list.filter(c => c.active));
      if (list.length > 0) {
        const first = list.find(c => c.active) ?? list[0];
        setSelectedExistingId(first.id);
      }
    }).catch(() => {});
  }, []);

  function markDone(step) { setDone(prev => new Set([...prev, step])); }
  function go(step) { setCurrent(step); setErr(''); }

  // Step 1: 기존 청소자 선택
  function doSelectExisting() {
    const c = existingCleaners.find(x => x.id === selectedExistingId);
    if (!c) { setErr('청소자를 선택해주세요'); return; }
    setCleanerId(c.id);
    setCleanerName(c.name ?? c.phone);
    setErr('');
    markDone(1); go(2);
  }

  // Step 1: 신규 청소자 등록
  async function doRegister() {
    if (!cleanerForm.phone) { setErr('전화번호를 입력하세요'); return; }
    if (!cleanerForm.name)  { setErr('이름을 입력하세요'); return; }
    setLoading(true); setErr('');
    try {
      const res = await apiFetch('/api/cleaning/cleaners', {
        method: 'POST', body: JSON.stringify(cleanerForm),
      });
      setCleanerId(res.id);
      setCleanerName(cleanerForm.name);
      markDone(1); go(2);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 2: 수동 잡 생성 (iCal 불필요, SHORT_NOTICE 즉시발송 방지)
  async function doCreateJob() {
    setLoading(true); setErr(''); setCreateResult(null);
    try {
      const res = await apiFetch('/api/cleaning/jobs', {
        method: 'POST',
        body: JSON.stringify({
          property_id: testPropertyId,
          checkouts: [{ date: testDate, uid: `test-${Date.now()}` }],
        }),
      });
      setCreateResult(res);
      if (res.created === 0) {
        setErr(`해당 날짜(${testDate})에 잡이 이미 존재합니다. 다른 날짜를 선택하세요.`);
        return;
      }
      const jobList = await apiFetch('/api/cleaning/jobs?status=PENDING');
      setJobs([...jobList].sort((a, b) => new Date(a.cleaning_start_at) - new Date(b.cleaning_start_at)));
      markDone(2); go(3);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 3: 잡 선택
  async function loadJobs() {
    setLoading(true); setErr('');
    try {
      const jobList = await apiFetch('/api/cleaning/jobs');
      setJobs([...jobList].filter(j => !['ASSIGNED','COMPLETED','CANCELLED'].includes(j.status)).sort((a, b) => new Date(a.cleaning_start_at) - new Date(b.cleaning_start_at)));
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 4: 잡 상태 초기화 (테스트 재발송용)
  async function doResetJob() {
    if (!selectedJob) return;
    setLoading(true); setErr('');
    try {
      await apiFetch(`/api/cleaning/jobs/${selectedJob.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'PENDING', _test_reset: true }),
      });
      // 선택된 잡 상태 갱신
      const updated = await apiFetch(`/api/cleaning/jobs/${selectedJob.id}`);
      setSelectedJob(updated);
      setDispatchResult(null);
      setJobDetail(null);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 4: 알림 발송
  async function doDispatch() {
    if (!selectedJob) return;
    setLoading(true); setErr('');
    try {
      const res = await apiFetch('/api/cleaning/dispatch', {
        method: 'POST', body: JSON.stringify({ job_id: selectedJob.id }),
      });
      setDispatchResult(res);
      // 발송 후 잡 상세 즉시 로드 (5단계 미리보기)
      const detail = await apiFetch(`/api/cleaning/jobs/${selectedJob.id}`);
      setJobDetail(detail);
      markDone(4); go(5);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Step 5: 결과 확인 (새로고침)
  async function refreshJobDetail() {
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
      if (cleanupDone.job || !selectedJob) markDone(6);
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
        <div style={{ fontSize: 12, color: '#3b82f6' }}>6단계로 청소 배정 전체 시나리오를 실데이터로 검증합니다. 각 단계 완료 후 다음 단계가 활성화됩니다.</div>
      </div>

      {/* Step 1 */}
      <FlowCard step={1} current={current} done={done.has(1)} icon='👤' title='청소자 선택' sub='테스트에 사용할 청소자를 선택하거나 신규 등록하세요'>
        {/* 모드 토글 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 16 }}>
          {[{ v: 'existing', label: '기존 청소자 선택' }, { v: 'new', label: '신규 등록' }].map(({ v, label }) => (
            <button key={v} onClick={() => { setStep1Mode(v); setErr(''); }}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                background: step1Mode === v ? '#2563eb' : '#fff',
                color: step1Mode === v ? '#fff' : '#374151',
                border: `1.5px solid ${step1Mode === v ? '#1d4ed8' : '#d1d5db'}` }}>
              {label}
            </button>
          ))}
        </div>

        {step1Mode === 'existing' ? (
          <div>
            {existingCleaners.length === 0
              ? <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>활성 청소자가 없습니다. 신규 등록 탭을 사용하세요.</div>
              : <>
                  <div style={labelStyle}>청소자</div>
                  <select value={selectedExistingId} onChange={e => setSelectedExistingId(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
                    {existingCleaners.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? '(이름없음)'} · {c.phone} · {TIER_LABELS[c.tier] ?? c.tier}
                      </option>
                    ))}
                  </select>
                  {selectedExistingId && (() => {
                    const c = existingCleaners.find(x => x.id === selectedExistingId);
                    return c ? (
                      <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534', marginBottom: 10 }}>
                        이메일: {c.email ?? '미설정'} · 상태: {c.active ? '활성' : '비활성'}
                      </div>
                    ) : null;
                  })()}
                  {err && current === 1 && <div style={errorBox}>{err}</div>}
                  <button onClick={doSelectExisting} style={actionBtnStyle}>이 청소자로 테스트 시작</button>
                </>
            }
          </div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
              💡 같은 티어에 기존 청소자가 있으면 <b>먼저 등록된 청소자</b>에게 우선 발송됩니다.
              {cleanerForm.tier !== 'BULK' && ' 비활성화 → 재활성화로 임시 제외 가능.'}
            </div>
            {err && current === 1 && <div style={errorBox}>{err}</div>}
            <button onClick={doRegister} disabled={loading} style={actionBtnStyle}>
              {loading ? '등록 중...' : '청소자 등록'}
            </button>
          </div>
        )}
        {cleanerId && <div style={resultBox}>✅ 선택 완료 — {cleanerName} <code style={{ fontSize: 11, color: '#6b7280' }}>({cleanerId})</code></div>}
      </FlowCard>

      {/* Step 2 */}
      <FlowCard step={2} current={current} done={done.has(2)} icon='🗓️' title='잡 생성' sub='체크아웃 날짜 직접 입력 → PENDING 청소 잡 생성'>
        <div style={{ marginTop: 14 }}>
          <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534', marginBottom: 14 }}>
            ✅ iCal 동기화 대신 날짜를 직접 입력합니다. <b>15일 이후 날짜만 선택 가능</b>
            (MONTHLY_BATCH → 즉시 알림 발송 없음, 4단계에서 수동 발송).
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={labelStyle}>숙소</div>
              <select value={testPropertyId} onChange={e => setTestPropertyId(e.target.value)} style={inputStyle}>
                {properties.length === 0
                  ? <option value="prop_1786259455129">파주201</option>
                  : properties.map(p => <option key={p.property_id} value={p.property_id}>{p.name ?? p.property_id}</option>)
                }
              </select>
            </div>
            <div>
              <div style={labelStyle}>체크아웃 날짜</div>
              <input type="date" value={testDate} min={minTestDate}
                onChange={e => setTestDate(e.target.value)} style={inputStyle} />
            </div>
          </div>
          {err && current === 2 && <div style={errorBox}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={doCreateJob} disabled={loading} style={{ ...actionBtnStyle, flex: 1, marginTop: 0 }}>
              {loading ? '생성 중...' : '🗓️ 테스트 잡 생성'}
            </button>
            <button onClick={() => { markDone(2); go(3); }}
              style={{ padding: '10px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                background: '#fff', color: '#6b7280', border: '1.5px solid #d1d5db', whiteSpace: 'nowrap' }}>
              기존 잡 사용 →
            </button>
          </div>
          {createResult && createResult.created > 0 && (
            <div style={resultBox}>
              ✅ PENDING 잡 생성 완료 — {createResult.created}건 (MONTHLY_BATCH)<br/>
              <span style={{ fontSize: 11 }}>4단계 '알림 발송' 버튼 전까지 자동 발송 안 됩니다.</span>
            </div>
          )}
        </div>
      </FlowCard>

      {/* Step 3 */}
      <FlowCard step={3} current={current} done={done.has(3)} icon='📋' title='잡 선택' sub='발송할 청소 잡 하나 선택'>
        <div style={{ marginTop: 14 }}>
          <button onClick={loadJobs} disabled={loading} style={{ ...editBtnStyle, marginBottom: 10 }}>
            {loading ? '...' : '🔄 목록 새로고침'}
          </button>
          {err && current === 3 && <div style={errorBox}>{err}</div>}
          {jobs.length === 0 && <div style={{ fontSize: 13, color: '#9ca3af' }}>잡이 없습니다. 2단계에서 잡을 먼저 생성하세요.</div>}
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
      <FlowCard step={4} current={current} done={done.has(4)} icon='📨' title='알림 발송' sub='선택한 잡에 수동으로 SMS/FCM 발송'>
        <div style={{ marginTop: 14 }}>
          {selectedJob && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 8 }}>
              <div><b>숙소:</b> {selectedJob.property_name ?? selectedJob.property_id}</div>
              <div><b>청소 일시:</b> {fmtDt(selectedJob.cleaning_start_at)}</div>
              <div><b>현재 상태:</b> <span style={{ fontWeight: 700, color: STATUS_META[selectedJob.status]?.color }}>{STATUS_META[selectedJob.status]?.label ?? selectedJob.status}</span></div>
            </div>
          )}
          {err && current === 4 && <div style={errorBox}>{err}</div>}
          {selectedJob?.status !== 'PENDING'
            ? <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', marginTop: 4 }}>
                현재 <b>{STATUS_META[selectedJob?.status]?.label ?? selectedJob?.status}</b> 상태입니다.
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={doResetJob} disabled={loading}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                      background: '#fff', color: '#dc2626', border: '1.5px solid #fca5a5' }}>
                    {loading ? '초기화 중...' : '🔄 PENDING 초기화 후 재발송'}
                  </button>
                  <button onClick={() => { markDone(4); go(5); }} style={{ ...nextBtnStyle, marginTop: 0, flex: 1 }}>
                    결과만 확인 →
                  </button>
                </div>
              </div>
            : <>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  VIP_1 → VIP_2 → VIP_3 → BULK 순서로 우선순위 조회 후 첫 번째 가용 청소자에게 발송합니다.
                </div>
                <button onClick={doDispatch} disabled={loading} style={actionBtnStyle}>
                  {loading ? '발송 중...' : '🚀 알림 발송 시작'}
                </button>
              </>
          }
        </div>
      </FlowCard>

      {/* Step 5 */}
      <FlowCard step={5} current={current} done={done.has(5)} icon='✅' title='결과 확인' sub='발송 채널 · 상태 · 거절 링크 확인'>
        <div style={{ marginTop: 14 }}>
          <button onClick={refreshJobDetail} disabled={loading} style={{ ...editBtnStyle, marginBottom: 10 }}>
            {loading ? '...' : '🔄 상태 새로고침'}
          </button>
          {err && current === 5 && <div style={errorBox}>{err}</div>}
          {jobDetail && (
            <div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 10 }}>
                <b>잡 상태:</b>{' '}
                <span style={{ color: STATUS_META[jobDetail.status]?.color ?? '#1a202c', fontWeight: 700 }}>
                  {STATUS_META[jobDetail.status]?.label ?? jobDetail.status}
                </span>
              </div>
              {(jobDetail.notifs ?? []).length === 0
                ? <div style={{ fontSize: 13, color: '#9ca3af' }}>발송 내역 없음 — 4단계에서 발송 후 새로고침하세요.</div>
                : <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#4a5568', marginBottom: 6 }}>발송 내역</div>
                    {jobDetail.notifs.map(n => (
                      <div key={n.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700 }}>{n.cleaner_name} <span style={{ color: '#6b7280', fontWeight: 400 }}>({n.phone})</span></span>
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: n.channel === 'FCM' ? '#eff6ff' : '#f0fdf4',
                            color: n.channel === 'FCM' ? '#1d4ed8' : '#15803d',
                            border: `1px solid ${n.channel === 'FCM' ? '#bfdbfe' : '#bbf7d0'}`,
                          }}>{n.channel ?? 'SMS'}</span>
                        </div>
                        <div style={{ color: '#6b7280', marginTop: 4 }}>발송: {fmtDt(n.sent_at)}</div>
                        {n.response
                          ? <div style={{ color: '#dc2626', marginTop: 4, fontWeight: 600 }}>응답: {n.response}</div>
                          : <div style={{ color: '#6b7280', marginTop: 4 }}>응답 대기 중</div>}
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>거절 링크 테스트:</div>
                          <a href={`/api/d/${n.token}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: '#7c3aed', fontFamily: "'DM Mono', monospace", wordBreak: 'break-all' }}>
                            /api/d/{n.token}
                          </a>
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>(실제 SMS는 /d/{n.token})</span>
                        </div>
                      </div>
                    ))}
                  </>
              }
            </div>
          )}
          <button onClick={() => { markDone(5); go(6); }} style={{ ...nextBtnStyle, marginTop: 14 }}>
            6단계(정리)로 이동
          </button>
        </div>
      </FlowCard>

      {/* Step 6 */}
      <FlowCard step={6} current={current} done={done.has(6)} icon='🗑️' title='테스트 정리' sub='잡 취소 + 청소자 비활성화'>
        <div style={{ marginTop: 14 }}>
          {err && current === 6 && <div style={errorBox}>{err}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                잡 취소 {cleanupDone.job && <span style={{ color: '#10b981' }}>✓ 완료</span>}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
                {selectedJob
                  ? `${selectedJob.property_name ?? testPropertyId} ${fmtDt(selectedJob.cleaning_start_at)} → CANCELLED`
                  : '선택된 잡 없음 (3단계 건너뜀)'}
              </div>
              {cleanupDone.job
                ? <div style={{ fontSize: 12, color: '#10b981' }}>✓ 취소 완료</div>
                : <button onClick={cancelJob} disabled={loading || !selectedJob} style={dangerBtnStyle}>잡 취소</button>
              }
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                청소자 비활성화 {cleanupDone.cleaner && <span style={{ color: '#10b981' }}>✓ 완료</span>}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
                {cleanerName || cleanerForm.name} → active: false
              </div>
              {cleanupDone.cleaner
                ? <div style={{ fontSize: 12, color: '#10b981' }}>✓ 비활성화 완료</div>
                : <button onClick={deactivateCleaner} disabled={loading || !cleanerId} style={dangerBtnStyle}>청소자 비활성화</button>
              }
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
              💡 잡 취소 시 Google Calendar 슬롯 재잠금은 <code>GOOGLE_REFRESH_TOKEN</code> 환경변수 설정 시 자동 처리됩니다. 미설정이면 잡만 DB에서 취소됩니다.
            </div>
          </div>
          {cleanupDone.job && cleanupDone.cleaner && (
            <div style={{ ...resultBox, marginTop: 14 }}>🎉 모든 테스트 데이터 정리 완료!</div>
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
