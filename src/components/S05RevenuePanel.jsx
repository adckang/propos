import React from "react";

import settlementService from "../application/settlementService.js";

// ============================================================
// S05RevenuePanel.jsx — UC-005 수익 정산 자동화 UI
// 시나리오: 월말 자동화 → 멀티플랫폼 수집 → AI 가격 최적화 → 세금 리포트
// ============================================================

// ── 도메인 함수 (인라인) ─────────────────────────────────────
const _s05 = (() => {

  function aggregateRevenue(platforms, operatingCost = 0) {
    let totalGross = 0, totalFee = 0, totalNet = 0;
    const byPlatform = {};
    for (const [platform, data] of Object.entries(platforms)) {
      totalGross += data.gross;
      totalFee   += data.platformFee;
      totalNet   += data.net;
      byPlatform[platform] = { ...data };
    }
    return { totalGross, totalFee, totalNet, byPlatform, operatingCost, operatingProfit: totalNet - operatingCost };
  }

  function calcTax(rev) {
    const { operatingProfit, totalGross, totalFee } = rev;
    const vat               = Math.round(operatingProfit * 0.10);
    const incomeTaxEstimate = Math.round(operatingProfit * 0.15);
    return {
      vat, incomeTaxEstimate,
      netAfterTax: operatingProfit - vat,
      deductions: [
        { item: '플랫폼 수수료', amount: totalFee },
        { item: '청소비',        amount: Math.round(totalGross * 0.03) },
        { item: '유지보수비',    amount: Math.round(totalGross * 0.02) },
      ],
    };
  }

  const _TREND = { spring_peak: 1.10, summer_peak: 1.15, off_season: 0.90, normal: 1.00 };

  function getPricingRecommendations(propDataList, marketTrend = 'normal') {
    const mult = _TREND[marketTrend] ?? 1.00;
    let sumCurrent = 0, sumSuggested = 0;
    const recommendations = propDataList.map(({ propId, occupancy, avgNightlyRate, competitorAvg }) => {
      let suggestedRate;
      if (occupancy > 0.85)      suggestedRate = Math.round(competitorAvg * mult);
      else if (occupancy > 0.70) suggestedRate = Math.round(Math.max(avgNightlyRate, competitorAvg) * mult);
      else                       suggestedRate = Math.round(avgNightlyRate * mult);

      let confidence = 0.60;
      if (occupancy > 0.85)                   confidence += 0.15;
      if (avgNightlyRate < competitorAvg)      confidence += 0.10;
      if (marketTrend !== 'normal')            confidence += 0.10;
      confidence = Math.min(confidence, 0.95);

      const reasonParts = [];
      if (occupancy > 0.85)               reasonParts.push('높은 점유율');
      if (avgNightlyRate < competitorAvg) reasonParts.push('경쟁사 대비 저평가');
      if (marketTrend !== 'normal') {
        const tl = { spring_peak: '봄 성수기', summer_peak: '여름 성수기', off_season: '비수기' };
        reasonParts.push(tl[marketTrend] || marketTrend);
      }

      sumCurrent   += avgNightlyRate;
      sumSuggested += suggestedRate;
      return { propId, currentRate: avgNightlyRate, suggestedRate, confidence, reason: reasonParts.join(' + ') || '성수기 보정' };
    });
    const pct = sumCurrent > 0 ? Math.round((sumSuggested - sumCurrent) / sumCurrent * 100) : 0;
    return { recommendations, projectedRevenueIncrease: `+${pct}%`, totalProjected: Math.round(sumSuggested) };
  }

  function won(n) { return n.toLocaleString('ko-KR') + '원'; }
  function hhmm() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function period(y, m) { return `${y}년 ${m}월`; }

  return { aggregateRevenue, calcTax, getPricingRecommendations, won, hhmm, period };
})();

// ── Mock 플랫폼 클라이언트 ───────────────────────────────────
const _mockPlatform = {
  async fetchAirbnb(period) {
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    return { gross: 12_400_000, platformFee: 744_000, net: 11_656_000 };
  },
  async fetchYanolja(period) {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
    return { gross: 3_200_000, platformFee: 192_000, net: 3_008_000 };
  },
  async updateAirbnbPricing(listings) {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
  },
  async updateYanoljaPricing(properties) {
    await new Promise(r => setTimeout(r, 350 + Math.random() * 200));
  },
};

// ── 목업 숙소 가격 데이터 ────────────────────────────────────
const _PROP_DATA = [
  { propId: 'P-001', name: '해운대 오션뷰',    occupancy: 0.87, avgNightlyRate: 85_000, competitorAvg: 92_000 },
  { propId: 'P-002', name: '광안리 스튜디오',  occupancy: 0.72, avgNightlyRate: 65_000, competitorAvg: 70_000 },
  { propId: 'P-003', name: '남포동 투룸',       occupancy: 0.91, avgNightlyRate: 78_000, competitorAvg: 95_000 },
  { propId: 'P-004', name: '서울 강남 아파트', occupancy: 0.68, avgNightlyRate: 120_000, competitorAvg: 118_000 },
  { propId: 'P-005', name: '제주 서귀포 펜션', occupancy: 0.55, avgNightlyRate: 95_000, competitorAvg: 110_000 },
  { propId: 'P-006', name: '인천 송도 스튜디오', occupancy: 0.80, avgNightlyRate: 58_000, competitorAvg: 62_000 },
];

// ── fetchWithRetry ───────────────────────────────────────────
async function _fetchWithRetry(fetchFn, maxRetries, platform, addAlert) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (err) {
      lastErr = err;
      const time = _s05.hhmm();
      if (attempt < maxRetries) {
        addAlert({ type: 'warn', prop: 'SYSTEM', msg: `${platform} API 응답 없음\n5분 후 재시도 예정 (${attempt}/${maxRetries})`, time });
      } else {
        addAlert({ type: 'error', prop: 'SYSTEM', msg: `${platform} API ${maxRetries}회 시도 실패 — 수동 처리 필요`, time });
      }
    }
  }
  throw new Error(`${platform} API 실패 (${maxRetries}회): ${lastErr?.message}`);
}

// ── 서브 컴포넌트 ────────────────────────────────────────────

function SettlementProgress({ steps, running }) {
  const STEPS = [
    { key: 'start',   label: '정산 시작'     },
    { key: 'data',    label: '수익 수집'     },
    { key: 'pricing', label: 'AI 최적화'     },
    { key: 'tax',     label: '세금 리포트'   },
  ];
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, marginBottom:16 }}>
      {STEPS.map((s, i) => {
        const done = steps[s.key];
        const active = running && !done && (
          (s.key === 'start'   && !steps.start) ||
          (s.key === 'data'    && steps.start && !steps.data) ||
          (s.key === 'pricing' && steps.data  && !steps.pricing) ||
          (s.key === 'tax'     && steps.pricing && !steps.tax)
        );
        return (
          <React.Fragment key={s.key}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, minWidth:80 }}>
              <div style={{
                width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                background: done ? '#059669' : active ? '#2563eb' : '#e2e8f0',
                color: done||active ? '#fff' : '#94a3b8',
                fontSize:14, fontWeight:700,
                boxShadow: active ? '0 0 0 3px #bfdbfe' : 'none',
                transition: 'all 0.3s',
              }}>
                {done ? '✓' : active ? (
                  <div style={{ width:14, height:14, border:'2px solid #fff', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
                ) : (i + 1)}
              </div>
              <span style={{ fontSize:11, color: done ? '#059669' : active ? '#2563eb' : '#94a3b8', fontWeight:600 }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex:1, height:2, background: done ? '#059669' : '#e2e8f0', transition:'background 0.4s', margin:'0 4px', marginBottom:16 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PlatformCard({ platform, data, icon, color }) {
  if (!data) return (
    <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 16px', opacity:0.5 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:18 }}>{icon}</span>
        <span style={{ fontWeight:700, fontSize:13, color:'#64748b' }}>{platform}</span>
      </div>
      <div style={{ fontSize:12, color:'#94a3b8' }}>데이터 수집 대기 중...</div>
    </div>
  );
  return (
    <div style={{ background:'#ffffff', border:`1.5px solid ${color}30`, borderTop:`3px solid ${color}`, borderRadius:10, padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ fontSize:18 }}>{icon}</span>
        <span style={{ fontWeight:700, fontSize:13, color:'#1e293b' }}>{platform}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {[
          { label: '총 매출', value: _s05.won(data.gross), color: '#1e293b' },
          { label: '플랫폼 수수료', value: `-${_s05.won(data.platformFee)}`, color: '#dc2626' },
          { label: '순수익', value: _s05.won(data.net), color: '#059669' },
        ].map(r => (
          <div key={r.label}>
            <div style={{ fontSize:10, color:'#94a3b8', marginBottom:2 }}>{r.label}</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, color:r.color }}>{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueSummaryCard({ revenueData }) {
  if (!revenueData) return null;
  const { totalGross, totalFee, totalNet, operatingCost, operatingProfit } = revenueData;
  const rows = [
    { label: '총 매출',        value: totalGross,       color: '#1e293b',  sign: '' },
    { label: '플랫폼 수수료',  value: totalFee,         color: '#dc2626',  sign: '-' },
    { label: '순수익',         value: totalNet,         color: '#2563eb',  sign: '' },
    { label: '운영비',         value: operatingCost,    color: '#d97706',  sign: '-' },
    { label: '영업이익',       value: operatingProfit,  color: '#059669',  sign: '' },
  ];
  return (
    <div style={{ background:'#ffffff', border:'1.5px solid #bbf7d0', borderTop:'3px solid #059669', borderRadius:10, padding:'16px' }}>
      <div style={{ fontWeight:700, fontSize:13, color:'#1e293b', marginBottom:12 }}>수익 집계 요약</div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'7px 10px', borderRadius:6,
            background: i === rows.length - 1 ? '#f0fdf4' : '#f8fafc',
            border: i === rows.length - 1 ? '1px solid #bbf7d0' : '1px solid #f1f5f9',
          }}>
            <span style={{ fontSize:12, color:'#64748b', fontWeight: i === rows.length-1 ? 700 : 400 }}>{r.label}</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:r.color }}>
              {r.sign}{_s05.won(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaxReportCard({ taxData }) {
  if (!taxData) return null;
  const { vat, incomeTaxEstimate, deductions, netAfterTax } = taxData;
  return (
    <div style={{ background:'#ffffff', border:'1.5px solid #fde68a', borderTop:'3px solid #d97706', borderRadius:10, padding:'16px' }}>
      <div style={{ fontWeight:700, fontSize:13, color:'#1e293b', marginBottom:12 }}>세금 리포트</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
        {[
          { label: 'VAT (부가세)',   value: vat,               color:'#d97706' },
          { label: '소득세 추정',    value: incomeTaxEstimate, color:'#dc2626' },
          { label: '실수령액',       value: netAfterTax,       color:'#059669' },
        ].map(r => (
          <div key={r.label} style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'10px 12px' }}>
            <div style={{ fontSize:10, color:'#92400e', marginBottom:4 }}>{r.label}</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:r.color }}>{_s05.won(r.value)}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize:11, color:'#64748b', fontWeight:700, marginBottom:6 }}>공제 항목</div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {deductions.map(d => (
          <div key={d.item} style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#475569', padding:'4px 8px', background:'#f8fafc', borderRadius:4 }}>
            <span>{d.item}</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontWeight:600 }}>{_s05.won(d.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingRecommendationList({ pricingData, selectedProps, onToggleProp, onApply, applying }) {
  if (!pricingData) return null;
  const { recommendations, projectedRevenueIncrease, totalProjected } = pricingData;
  return (
    <div style={{ background:'#ffffff', border:'1.5px solid #bfdbfe', borderTop:'3px solid #2563eb', borderRadius:10, padding:'16px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:13, color:'#1e293b' }}>AI 가격 최적화 추천</div>
          <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
            예상 수익 향상: <span style={{ color:'#059669', fontWeight:700 }}>{projectedRevenueIncrease}</span>
            <span style={{ marginLeft:8, fontFamily:"'DM Mono',monospace" }}>({_s05.won(totalProjected)})</span>
          </div>
        </div>
        <button
          onClick={onApply}
          disabled={applying || selectedProps.length === 0}
          style={{
            padding:'7px 14px', borderRadius:7,
            border:`1.5px solid ${applying||selectedProps.length===0?'#e2e8f0':'#2563eb'}`,
            background: applying||selectedProps.length===0?'#f8fafc':'#2563eb',
            color: applying||selectedProps.length===0?'#94a3b8':'#fff',
            fontSize:12, fontWeight:700, cursor: applying||selectedProps.length===0?'default':'pointer',
            display:'flex', alignItems:'center', gap:6, transition:'all 0.2s',
          }}
        >
          {applying
            ? <><div style={{ width:12, height:12, border:'2px solid #94a3b8', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />적용 중...</>
            : `✓ ${selectedProps.length}개 적용`
          }
        </button>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {recommendations.map(r => {
          const selected = selectedProps.includes(r.propId);
          const diff = r.suggestedRate - r.currentRate;
          const propInfo = _PROP_DATA.find(p => p.propId === r.propId);
          return (
            <div
              key={r.propId}
              onClick={() => onToggleProp(r.propId)}
              style={{
                display:'grid', gridTemplateColumns:'auto 1fr auto auto', gap:10, alignItems:'center',
                padding:'10px 12px', borderRadius:8, cursor:'pointer',
                background: selected ? '#eff6ff' : '#f8fafc',
                border: `1px solid ${selected ? '#bfdbfe' : '#e2e8f0'}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ width:18, height:18, borderRadius:4, border:`2px solid ${selected?'#2563eb':'#cbd5e1'}`, background:selected?'#2563eb':'transparent', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {selected && <span style={{ color:'#fff', fontSize:11, fontWeight:700 }}>✓</span>}
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'#1e293b' }}>{propInfo?.name || r.propId}</div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>{r.reason}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#94a3b8', textDecoration:'line-through' }}>
                  {r.currentRate.toLocaleString()}원
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:'#059669' }}>
                  {r.suggestedRate.toLocaleString()}원
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:11, fontWeight:700, color: diff>0?'#059669':'#dc2626' }}>
                  {diff > 0 ? '+' : ''}{diff.toLocaleString()}원
                </div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>
                  신뢰도 {Math.round(r.confidence * 100)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop:8, fontSize:11, color:'#94a3b8' }}>* 체크박스 클릭으로 적용 대상 선택</div>
    </div>
  );
}

function AlertFeedS05({ alerts, onAck }) {
  if (alerts.length === 0) return (
    <div style={{ textAlign:'center', padding:'24px 0', color:'#94a3b8', fontSize:12 }}>알림 없음</div>
  );
  const typeStyle = {
    info:  { bg:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8', icon:'ℹ' },
    warn:  { bg:'#fffbeb', border:'#fde68a', color:'#d97706', icon:'⚠' },
    error: { bg:'#fef2f2', border:'#fecaca', color:'#dc2626', icon:'✕' },
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {alerts.map(a => {
        const s = typeStyle[a.type] || typeStyle.info;
        return (
          <div key={a.id} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:8, padding:'10px 12px', display:'flex', gap:8 }}>
            <span style={{ fontSize:13, color:s.color, fontWeight:700, flexShrink:0 }}>{s.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, color:'#1e293b', whiteSpace:'pre-line' }}>{a.msg}</div>
              <div style={{ fontSize:10, color:'#94a3b8', marginTop:3 }}>{a.time}</div>
            </div>
            <button
              onClick={() => onAck(a.id)}
              style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:14, padding:'0 4px', flexShrink:0 }}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────

// ── 정산 스케줄 유틸 (인라인 — 단일 HTML 번들 호환) ─────────
const _schedule = {
  isSettlementDay(date) {
    const d = date instanceof Date ? date : new Date();
    return d.getDate() === 1;
  },
  getSettlementPeriod(date) {
    const d = date instanceof Date ? date : new Date();
    const year  = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    const month = d.getMonth() === 0 ? 12 : d.getMonth();
    return { year, month, label: `${year}년 ${month}월` };
  },
};

function S05RevenuePanel({ onBack }) {
  const now = new Date();
  const settlementPeriod = _schedule.getSettlementPeriod(now);
  const [year]  = React.useState(settlementPeriod.year);
  const [month] = React.useState(settlementPeriod.month);
  const [marketTrend, setMarketTrend] = React.useState('spring_peak');
  const OPERATING_COST = 2_100_000;

  // 오늘이 정산일(매월 1일)이면 자동 실행 배너 표시
  const [autoBanner, setAutoBanner] = React.useState(() => _schedule.isSettlementDay(now));

  const [running,   setRunning]   = React.useState(false);
  const [applying,  setApplying]  = React.useState(false);
  const [steps,     setSteps]     = React.useState({ start:false, data:false, pricing:false, tax:false });
  const [airbnbData,  setAirbnbData]  = React.useState(null);
  const [yanoljaData, setYanoljaData] = React.useState(null);
  const [revenueData, setRevenueData] = React.useState(null);
  const [pricingData, setPricingData] = React.useState(null);
  const [taxData,     setTaxData]     = React.useState(null);
  const [alerts,      setAlerts]      = React.useState([]);
  const [selectedProps, setSelectedProps] = React.useState([]);
  const [failMode,    setFailMode]    = React.useState(false);
  const alertIdRef = React.useRef(1);

  function addAlert(alert) {
    const id = alertIdRef.current++;
    setAlerts(prev => [{ ...alert, id, time: alert.time || _s05.hhmm() }, ...prev]);
  }
  function ackAlert(id) { setAlerts(prev => prev.filter(a => a.id !== id)); }

  function resetAll() {
    setSteps({ start:false, data:false, pricing:false, tax:false });
    setAirbnbData(null); setYanoljaData(null);
    setRevenueData(null); setPricingData(null); setTaxData(null);
    setAlerts([]); setSelectedProps([]);
    alertIdRef.current = 1;
  }

  async function runSettlement() {
    resetAll();
    setRunning(true);

    const propCount = _PROP_DATA.length;

    setSteps(s => ({ ...s, start: true }));

    try {
      await settlementService.runMonthlySettlement(
        {
          year,
          month,
          propCount,
          operatingCost: OPERATING_COST,
          marketTrend,
        },
        {
          fetchAirbnb: () => failMode ? Promise.reject(new Error("503 Service Unavailable")) : _mockPlatform.fetchAirbnb(`${month}월`),
          fetchYanolja: () => _mockPlatform.fetchYanolja(`${month}월`),
          getPropDataList: () => _PROP_DATA.map(({ propId, occupancy, avgNightlyRate, competitorAvg }) => ({
            propId,
            occupancy,
            avgNightlyRate,
            competitorAvg,
          })),
          setRevenueData: data => {
            setAirbnbData(data.byPlatform.airbnb || null);
            setYanoljaData(data.byPlatform.yanolja || null);
            setRevenueData(data);
            setSteps(s => ({ ...s, data: true }));
          },
          setPricingData: data => {
            setPricingData(data);
            setSelectedProps(_PROP_DATA.map(p => p.propId));
            setSteps(s => ({ ...s, pricing: true }));
          },
          setTaxData: data => {
            setTaxData(data);
            setSteps(s => ({ ...s, tax: true }));
          },
          addAlert,
        }
      );
    } finally {
      setRunning(false);
    }
  }

  async function applyPricing() {
    if (!pricingData || selectedProps.length === 0) return;
    setApplying(true);
    try {
      await settlementService.applyPricingRecommendations(
        selectedProps,
        pricingData.recommendations,
        {
          updateAirbnbPricing: listings => _mockPlatform.updateAirbnbPricing(listings),
          updateYanoljaPricing: listings => _mockPlatform.updateYanoljaPricing(listings),
          addAlert,
        }
      );
    } finally {
      setApplying(false);
    }
  }

  function toggleProp(propId) {
    setSelectedProps(prev =>
      prev.includes(propId) ? prev.filter(p => p !== propId) : [...prev, propId]
    );
  }

  const allDone = steps.start && steps.data && steps.pricing && steps.tax;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', fontFamily:"'DM Sans',sans-serif" }}>

      {/* 정산일 자동 트리거 배너 */}
      {autoBanner && !running && !allDone && (
        <div style={{ background:'#eff6ff', borderBottom:'2px solid #3b82f6', padding:'10px 24px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
          <span style={{ fontSize:18 }}>📅</span>
          <span style={{ flex:1, fontWeight:700, color:'#1d4ed8', fontSize:13 }}>오늘은 정산일입니다 — {settlementPeriod.label} 수익 정산을 자동 실행할까요?</span>
          <button onClick={() => { setAutoBanner(false); runSettlement(); }} style={{ padding:'6px 16px', borderRadius:7, background:'#2563eb', border:'1.5px solid #1d4ed8', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>지금 실행</button>
          <button onClick={() => setAutoBanner(false)} style={{ padding:'6px 12px', borderRadius:7, background:'#f8fafc', border:'1.5px solid #e2e8f0', color:'#64748b', fontSize:12, fontWeight:600, cursor:'pointer' }}>나중에</button>
        </div>
      )}

      {/* ── 헤더 ── */}
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e2e8f0', padding:'16px 24px', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onBack} style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 12px', fontSize:12, color:'#64748b', cursor:'pointer', fontWeight:600 }}>← 홈</button>
          <div style={{ width:1, height:22, background:'#e2e8f0' }} />
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:'#1e293b' }}>UC-005 — 수익 정산 자동화</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>멀티플랫폼 통합 · AI 가격 최적화 · 세금 리포트</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={running ? undefined : runSettlement} disabled={running}
            style={{ padding:'9px 20px', borderRadius:8, border:`1.5px solid ${running?'#e2e8f0':'#059669'}`, background: running ? '#f8fafc' : '#059669', color: running ? '#94a3b8' : '#fff', fontSize:13, fontWeight:700, cursor: running?'default':'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {running
              ? <><div style={{ width:12, height:12, border:'2px solid #94a3b8', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />정산 중...</>
              : `▶ ${month}월 정산 실행`}
          </button>
          {allDone && <button onClick={resetAll} style={{ padding:'9px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#64748b', fontSize:13, fontWeight:600, cursor:'pointer' }}>↺ 초기화</button>}
        </div>
      </div>

      {/* ── 본문 3열 ── */}
      <div style={{ flex:1, display:'grid', gridTemplateColumns:'260px 1fr 340px', gap:20, padding:20, overflow:'hidden' }}>

        {/* 좌측: 정산 설정 + 진행 상태 */}
        <div style={{ display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>

          {/* 정산 설정 */}
          <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'16px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, paddingBottom:8, borderBottom:'1.5px solid #e2e8f0' }}>
              <span style={{ width:3, height:13, background:'#059669', borderRadius:2, flexShrink:0 }} />
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>정산 설정</span>
            </div>
            <div style={{ display:'flex', gap:8, marginBottom:12 }}>
              <div style={{ flex:1, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
                <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>연도</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, fontSize:16, color:'#1e293b' }}>{year}</div>
              </div>
              <div style={{ flex:1, background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
                <div style={{ fontSize:10, color:'#059669', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>월</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, fontSize:16, color:'#059669' }}>{month}월</div>
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:'#64748b', fontWeight:600, marginBottom:4 }}>시장 트렌드</div>
              <select value={marketTrend} onChange={e => setMarketTrend(e.target.value)} disabled={running}
                style={{ width:'100%', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:7, padding:'6px 8px', background:'#f8fafc', color:'#475569', fontWeight:600, cursor:'pointer' }}>
                <option value="spring_peak">🌸 봄 성수기 (+10%)</option>
                <option value="summer_peak">☀️ 여름 성수기 (+15%)</option>
                <option value="normal">기본 (보통)</option>
                <option value="off_season">❄️ 비수기 (-10%)</option>
              </select>
            </div>
            <button onClick={() => setFailMode(f => !f)}
              style={{ width:'100%', padding:'6px 8px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background: failMode ? '#fee2e2' : '#f8fafc', border: `1.5px solid ${failMode ? '#fca5a5' : '#e2e8f0'}`, color: failMode ? '#dc2626' : '#64748b' }}>
              {failMode ? '✕ API 오류 시뮬 ON' : '○ API 오류 시뮬 OFF'}
            </button>
          </div>

          {/* 진행 상태 */}
          <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'16px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, paddingBottom:8, borderBottom:'1.5px solid #e2e8f0' }}>
              <span style={{ width:3, height:13, background:'#2563eb', borderRadius:2, flexShrink:0 }} />
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>진행 상태</span>
            </div>
            <SettlementProgress steps={steps} running={running} />
            {allDone && (
              <div style={{ marginTop:10, textAlign:'center', color:'#059669', fontSize:12, fontWeight:700, background:'#f0fdf4', border:'1px solid #86efac', borderRadius:6, padding:'6px' }}>
                ✓ {month}월 정산 완료
              </div>
            )}
          </div>
        </div>

        {/* 중앙: 플랫폼 수익 + AI 가격 최적화 */}
        <div style={{ display:'flex', flexDirection:'column', gap:12, overflowY:'auto' }}>

          <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:10, borderBottom:'1.5px solid #e2e8f0' }}>
            <span style={{ width:3, height:13, background:'#FF5A5F', borderRadius:2, flexShrink:0 }} />
            <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>플랫폼별 수익</span>
          </div>
          <PlatformCard platform="에어비앤비" data={airbnbData}  icon="🏠" color="#FF5A5F" />
          <PlatformCard platform="야놀자"     data={yanoljaData} icon="🌙" color="#0078FF" />
          {revenueData && <RevenueSummaryCard revenueData={revenueData} />}

          <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:10, borderBottom:'1.5px solid #e2e8f0', marginTop:4 }}>
            <span style={{ width:3, height:13, background:'#7c3aed', borderRadius:2, flexShrink:0 }} />
            <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>AI 가격 최적화</span>
          </div>
          {pricingData ? (
            <PricingRecommendationList pricingData={pricingData} selectedProps={selectedProps} onToggleProp={toggleProp} onApply={applyPricing} applying={applying} />
          ) : (
            <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>
              <div style={{ fontSize:28, marginBottom:8, opacity:0.4 }}>🤖</div>
              정산 실행 후 AI 분석 결과가 표시됩니다
            </div>
          )}
        </div>

        {/* 우측: 세금 리포트 + 알림 피드 */}
        <div style={{ display:'flex', flexDirection:'column', gap:12, overflow:'hidden' }}>

          <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:10, borderBottom:'1.5px solid #e2e8f0' }}>
            <span style={{ width:3, height:13, background:'#059669', borderRadius:2, flexShrink:0 }} />
            <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em' }}>세금 리포트</span>
          </div>
          {taxData ? (
            <TaxReportCard taxData={taxData} />
          ) : (
            <div style={{ background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'20px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>
              정산 실행 후 세금 리포트가 표시됩니다
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden', background:'#ffffff', border:'1.5px solid #e2e8f0', borderRadius:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', borderBottom:'1.5px solid #e2e8f0', flexShrink:0 }}>
              <span style={{ width:3, height:13, background:'#d97706', borderRadius:2, flexShrink:0 }} />
              <span style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', flex:1 }}>자동화 알림</span>
              {alerts.length > 0 && <span style={{ background:'#dc2626', color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{alerts.length}</span>}
              {alerts.length > 0 && <button onClick={() => setAlerts([])} style={{ padding:'3px 9px', borderRadius:5, background:'#f8fafc', border:'1.5px solid #e2e8f0', color:'#64748b', fontSize:10, cursor:'pointer', fontWeight:600 }}>전체 확인</button>}
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'8px 10px' }}>
              <AlertFeedS05 alerts={alerts} onAck={ackAlert} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default S05RevenuePanel;
