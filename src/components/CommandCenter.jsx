import { useEffect, useState } from "react";

import { ALL_PROPS, CLEANERS, INIT_ALERTS, PC, SC, rand, randN } from "../data/mockData";
import Toast from "../utils/toast";

// ============================================================
// CommandCenter.jsx — 전체 숙소 지휘 센터
// 시나리오 1~5를 기준으로 100개 숙소를 한눈에 보는 운영 화면
// ============================================================

const CC_STAGES = [
  {
    id:"d1",
    code:"S01",
    emoji:"📅",
    label:"D-1 준비",
    color:"#2563eb",
    bg:"#eff6ff",
    border:"#bfdbfe",
    filter: prop => prop.status === "예약됨" && prop.priority === "OK" && prop.unreadMsg === 0,
    desc:"내일 체크인 전에 준비를 끝내는 단계입니다. PIN, 웰컴 메시지, 스마트홈 준비가 미리 끝났는지 확인합니다.",
    action:"⚡ D-1 자동화 전체 실행",
  },
  {
    id:"checkin",
    code:"S02",
    emoji:"🚪",
    label:"체크인 당일",
    color:"#059669",
    bg:"#ecfdf5",
    border:"#a7f3d0",
    filter: prop => prop.status === "예약됨" && (prop.priority !== "OK" || prop.unreadMsg > 0),
    desc:"입실 직전 또는 당일 개입이 필요한 예약 숙소를 모읍니다. 도어락 이벤트, 채널 오픈, 첫 메시지 대응을 놓치지 않는 단계입니다.",
    action:"🚪 체크인 확인 큐 열기",
  },
  {
    id:"stay",
    code:"S03",
    emoji:"📡",
    label:"체류 중",
    color:"#7c3aed",
    bg:"#f5f3ff",
    border:"#ddd6fe",
    filter: prop => prop.status === "입실중",
    desc:"체류 중 숙소를 관리하는 단계입니다. 센서 이상, 게스트 메시지, 현장 제어가 필요한 숙소를 먼저 찾습니다.",
    action:"📡 전체 폴링 시작",
  },
  {
    id:"checkout",
    code:"S04",
    emoji:"🚪",
    label:"퇴실·청소",
    color:"#d97706",
    bg:"#fffbeb",
    border:"#fde68a",
    filter: prop => prop.status === "청소중" || prop.status === "점검중",
    desc:"퇴실 이후 다음 예약 준비를 끝내는 단계입니다. 청소 배정, 유지보수, 준비 완료 전환이 여기서 관리됩니다.",
    action:"🧹 청소팀 전체 소집",
  },
  {
    id:"settlement",
    code:"S05",
    emoji:"💰",
    label:"수익 정산",
    color:"#0891b2",
    bg:"#ecfeff",
    border:"#a5f3fc",
    filter: prop => true,
    desc:"운영 흐름의 마지막 단계입니다. 월간 수익을 모으고 가격 추천과 정산 검토가 필요한 숙소를 봅니다.",
    action:"💰 월 정산 실행",
  },
];

function CommandCenter({onBack, onOpenScenario, onOpenHomeAssistant, initialStage = "stay"}) {
  const [stage, setStage] = useState("stay");
  const [props, setProps] = useState(ALL_PROPS);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [selProp, setSelProp] = useState(null);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(new Date());
  const [showGcmd, setShowGcmd] = useState(false);
  const [dTab, setDTab] = useState("info");
  const [bulkSel, setBulkSel] = useState([]);
  const [gMode, setGMode] = useState("grid");
  const [msgIn, setMsgIn] = useState("");
  const [chat, setChat] = useState([]);
  const [cleanerAss, setCleanerAss] = useState({});
  const [globalMsg, setGlobalMsg] = useState("");

  useEffect(()=>{
    const clock = setInterval(()=>setNow(new Date()),1000);
    const alertFeed = setInterval(()=>{
      if(Math.random() < 0.12){
        const prop = props[randN(0, props.length - 1)];
        setAlerts(list=>[
          {
            id: Date.now(),
            type: rand(["warn","info"]),
            prop: prop.name,
            msg: rand(["게스트 메시지 수신","청소 완료 보고","체크인 완료","Wi-Fi 신호 약화"]),
            time: new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}),
            ack: false,
          },
          ...list.slice(0,28),
        ]);
      }
    }, 9000);
    return ()=>{
      clearInterval(clock);
      clearInterval(alertFeed);
    };
  },[props]);

  useEffect(()=>{
    setStage(initialStage || "stay");
  },[initialStage]);

  const toggleDev = (id, dev) => setProps(list=>list.map(item=>item.id!==id ? item : {...item, [dev]:!item[dev]}));
  const adjAc = (id, delta) => setProps(list=>list.map(item=>item.id!==id ? item : {...item, acTemp:Math.max(16, Math.min(30, item.acTemp + delta))}));
  const ackAlert = id => setAlerts(list=>list.map(item=>item.id===id ? {...item, ack:true} : item));
  const ackAll = () => setAlerts(list=>list.map(item=>({...item, ack:true})));
  const bulkToggle = (dev, value) => setProps(list=>list.map(item=>bulkSel.includes(item.id) ? {...item, [dev]:value} : item));

  const currentStage = CC_STAGES.find(item=>item.id===stage) || CC_STAGES[0];
  const focusProperty = (prop, tab = "info") => {
    setSelProp(prop);
    setDTab(tab);
    setChat([]);
  };

  const filtered = props
    .filter(prop=>{
      if(!currentStage.filter(prop)) return false;
      if(search && !prop.name.toLowerCase().includes(search.toLowerCase()) && !(prop.guest || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b)=>{
      const order = {HIGH:0, MED:1, OK:2};
      return order[a.priority] - order[b.priority];
    });
  const occupied = props.filter(prop=>prop.status==="입실중").length;
  const unack = alerts.filter(alert=>!alert.ack).length;
  const stageInsights = CC_STAGES.map(item=>{
    const count = props.filter(item.filter).length;
    const urgent = props.filter(item.filter).filter(prop=>prop.priority==="HIGH" || prop.issues.length > 0).length;
    const unread = props.filter(item.filter).reduce((sum, prop)=>sum + prop.unreadMsg, 0);
    return {
      id: item.id,
      code: item.code,
      label: item.label,
      count,
      urgent,
      unread,
      score: urgent * 3 + unread + count,
    };
  });
  const bottleneckStage = [...stageInsights].sort((a, b)=>b.score - a.score)[0];
  const stageDrilldownMap = {
    d1: { screen: "d1", label: "D-1 상세 열기" },
    checkin: { screen: "s02", label: "체크인 상세 열기" },
    stay: { screen: "s03", label: "체류 중 상세 열기" },
    checkout: { screen: "s04", label: "퇴실·청소 상세 열기" },
    settlement: { screen: "s05", label: "수익 정산 상세 열기" },
  };
  const currentDrilldown = stageDrilldownMap[stage] || null;
  const currentInsight = stageInsights.find(item=>item.id===stage) || stageInsights[0];
  const stageManualCount = filtered.filter(prop => prop.priority !== "OK" || prop.issues.length > 0).length;
  const stageUnreadCount = filtered.reduce((sum, prop)=>sum + prop.unreadMsg, 0);
  const stageLeadProp = filtered[0] || null;
  const stageUrgentCount = filtered.filter(prop => prop.priority === "HIGH" || prop.issues.length > 0).length;

  const getPrimaryAction = prop => {
    if(prop.priority==="HIGH" || prop.issues.length > 0){
      return {
        label:"이슈 확인",
        detail: prop.issues[0] || "긴급 센서 상태를 바로 확인하세요.",
        tab:"info",
        color:"#dc2626",
        bg:"#fef2f2",
        border:"#fecaca",
        toast:"긴급 이슈 상세를 열었습니다.",
        tone:"e",
      };
    }
    if(prop.unreadMsg > 0){
      return {
        label:"메시지 답장",
        detail:`미읽음 ${prop.unreadMsg}건이 남아 있어요.`,
        tab:"msg",
        color:"#7c3aed",
        bg:"#f5f3ff",
        border:"#ddd6fe",
        toast:"메시지 탭으로 이동했습니다.",
        tone:"i",
      };
    }
    if(prop.status==="예약됨"){
      return {
        label:"D-1 준비",
        detail:`${prop.checkIn || "내일"} 체크인을 준비하세요.`,
        tab:"info",
        color:"#2563eb",
        bg:"#eff6ff",
        border:"#bfdbfe",
        toast:"D-1 준비 상태를 확인합니다.",
        tone:"i",
      };
    }
    if(prop.status==="청소중"){
      return {
        label:"청소 배정",
        detail:"다음 예약 전 청소 상태를 마무리하세요.",
        tab:"clean",
        color:"#d97706",
        bg:"#fffbeb",
        border:"#fde68a",
        toast:"청소 배정 탭으로 이동했습니다.",
        tone:"w",
      };
    }
    return {
      label:"IoT 확인",
      detail:"현재 체류 상태와 장치 상태를 빠르게 점검하세요.",
      tab:"iot",
      color:"#059669",
      bg:"#ecfdf5",
      border:"#a7f3d0",
      toast:"숙소 상태 확인 화면을 열었습니다.",
      tone:"s",
    };
  };

  const stageFocusTitle = stageLeadProp
    ? `${stageLeadProp.name}부터 처리하면 됩니다`
    : `${currentStage.label} 단계는 지금 안정적입니다`;
  const stageFocusDesc = stageLeadProp
    ? getPrimaryAction(stageLeadProp).detail
    : currentStage.desc;
  const stageFocusMetrics = {
    d1: [
      `준비 대상 ${currentInsight?.count || 0}곳`,
      `자동 진행 가능 ${filtered.filter(prop => prop.priority === "OK" && prop.unreadMsg === 0).length}곳`,
      `예외 ${stageManualCount}곳`,
    ],
    checkin: [
      `당일 확인 ${currentInsight?.count || 0}곳`,
      `메시지 미응답 ${stageUnreadCount}건`,
      `긴급 ${stageUrgentCount}곳`,
    ],
    stay: [
      `체류 중 ${currentInsight?.count || 0}곳`,
      `긴급 ${stageUrgentCount}곳`,
      `미읽음 ${stageUnreadCount}건`,
    ],
    checkout: [
      `퇴실 후 처리 ${currentInsight?.count || 0}곳`,
      `청소 진행 ${filtered.filter(prop => prop.status === "청소중").length}곳`,
      `점검 필요 ${filtered.filter(prop => prop.status === "점검중" || prop.issues.length > 0).length}곳`,
    ],
    settlement: [
      `정산 대상 ${currentInsight?.count || 0}곳`,
      `고수익 ${(filtered.filter(prop => prop.revenue >= 500000)).length}곳`,
      `평점 주의 ${(filtered.filter(prop => Number(prop.rating) < 4.3)).length}곳`,
    ],
  }[stage] || [
    `전체 ${currentInsight?.count || 0}곳`,
    `수동 개입 ${stageManualCount}곳`,
    `미응답 ${stageUnreadCount}건`,
  ];

  const runPrimaryAction = prop => {
    const action = getPrimaryAction(prop);
    focusProperty(prop, action.tab);
    Toast.show(`${prop.name.split("#")[0].trim()} · ${action.toast}`, action.tone);
  };

  const openAlertsPanel = () => {
    Toast.show("오른쪽 실시간 알림 패널에서 바로 확인할 수 있습니다.", "i");
  };

  const stageActionQueue = filtered.slice(0, 5).map(prop=>({
    prop,
    action: getPrimaryAction(prop),
  }));

  const renderStageKPI = (prop, stageId) => {
    if(stageId==="d1"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:prop.priority!=="HIGH"?"#059669":"#dc2626"}}>{prop.priority!=="HIGH"?"✓ PIN준비":"✗ PIN미발급"}</span>
          <span className="pcard-kpi-item" style={{color:"#718096"}}>체크인 {prop.checkIn || "내일"}</span>
        </div>
      );
    }
    if(stageId==="checkin"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:"#059669"}}>🚪 입실 대응</span>
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>체크인 {prop.checkIn || "오늘"}</span>
        </div>
      );
    }
    if(stageId==="stay"){
      return (
        <div className="pcard-kpi">
          {prop.unreadMsg > 0 && <span className="pcard-kpi-item" style={{color:"#7c3aed",fontWeight:700}}>💬 미읽 {prop.unreadMsg}</span>}
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>퇴실 {prop.checkOut || "—"}</span>
        </div>
      );
    }
    if(stageId==="checkout"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:"#d97706"}}>🧹 청소중</span>
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>퇴실완료</span>
        </div>
      );
    }
    if(stageId==="settlement"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:"#059669",fontWeight:700}}>{(prop.revenue / 10000).toFixed(0)}만원</span>
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>★ {prop.rating}</span>
        </div>
      );
    }
    return (
      <div className="pcard-kpi">
        <span className="pcard-kpi-item" style={{color:"#718096"}}>🌡 {prop.temp}°</span>
        <span className="pcard-kpi-item" style={{color:"#059669",fontWeight:600}}>{(prop.revenue / 10000).toFixed(0)}만</span>
        <span className="pcard-kpi-item" style={{color:"#718096"}}>★{prop.rating}</span>
      </div>
    );
  };

  const PCard = ({p}) => {
    const isSel = selProp?.id === p.id;
    const isBulk = bulkSel.includes(p.id);
    const primaryAction = getPrimaryAction(p);
    const stageColor =
      stage==="d1" ? "#2563eb" :
      stage==="checkin" ? "#059669" :
      stage==="stay" ? "#7c3aed" :
      stage==="checkout" ? "#d97706" :
      stage==="settlement" ? "#0891b2" :
      "transparent";

    return (
      <div className={`pcard ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p, "info")} style={{borderTopColor: stageColor}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
            <div
              style={{width:"16px",height:"16px",borderRadius:"4px",border:`1.5px solid ${isBulk?"#2563eb":"#e2e8f0"}`,background:isBulk?"#eff6ff":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#2563eb",cursor:"pointer",flexShrink:0}}
              onClick={e=>{e.stopPropagation(); setBulkSel(list=>isBulk ? list.filter(id=>id!==p.id) : [...list, p.id]);}}
            >
              {isBulk?"✓":""}
            </div>
            <div style={{width:"8px",height:"8px",borderRadius:"50%",background:SC[p.status]}} />
          </div>
          <div style={{display:"flex",gap:"4px"}}>
            {p.unreadMsg > 0 && <span style={{fontSize:"10px",background:"#7c3aed",color:"#fff",borderRadius:"10px",padding:"1px 6px",fontWeight:"700",fontFamily:"'DM Mono',monospace"}}>💬{p.unreadMsg}</span>}
            {p.issues.length > 0 && <span style={{fontSize:"10px",background:"#dc2626",color:"#fff",borderRadius:"10px",padding:"1px 6px",fontWeight:"700"}}>⚠</span>}
          </div>
        </div>
        <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",lineHeight:"1.4",marginBottom:"5px"}}>{p.name}</div>
        <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
          <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1px solid ${SC[p.status]}44`}}>{p.status}</span>
          {p.guest && <span style={{fontSize:"10px",color:"#718096",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:80}}>{p.guest}</span>}
        </div>
        {renderStageKPI(p, stage)}
        {p.issues.length > 0 && <div style={{fontSize:"10px",color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",padding:"3px 8px",borderRadius:"4px",marginTop:"5px",display:"inline-block",fontWeight:"600"}}>⚠ {p.issues[0]}</div>}
        <div className="pcard-action">
          <div className="pcard-action-text">
            <span className="pcard-action-label">{primaryAction.label}</span>
            <span className="pcard-action-detail">{primaryAction.detail}</span>
          </div>
          <button
            className="pcard-action-btn"
            style={{background:primaryAction.bg,borderColor:primaryAction.border,color:primaryAction.color}}
            onClick={event=>{
              event.stopPropagation();
              runPrimaryAction(p);
            }}
          >
            바로 처리
          </button>
        </div>
      </div>
    );
  };

  const LRow = ({p}) => {
    const isSel = selProp?.id === p.id;
    const isBulk = bulkSel.includes(p.id);
    const primaryAction = getPrimaryAction(p);
    return (
      <div className={`lrow ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p, "info")}>
        <div
          style={{width:"16px",height:"16px",borderRadius:"4px",border:`1.5px solid ${isBulk?"#2563eb":"#e2e8f0"}`,background:isBulk?"#eff6ff":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#2563eb",cursor:"pointer",flexShrink:0}}
          onClick={e=>{e.stopPropagation(); setBulkSel(list=>isBulk ? list.filter(id=>id!==p.id) : [...list, p.id]);}}
        >
          {isBulk?"✓":""}
        </div>
        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:SC[p.status],flexShrink:0}} />
        <div style={{flex:2,minWidth:0}}>
          <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
          <div style={{fontSize:"10px",color:"#a0aec0"}}>{p.type}</div>
        </div>
        <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1px solid ${SC[p.status]}44`,whiteSpace:"nowrap"}}>{p.status}</span>
        <div style={{flex:1,fontSize:"11px",color:"#4a5568",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.guest || "—"}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#718096",whiteSpace:"nowrap"}}>🌡{p.temp}° ★{p.rating}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#059669",fontWeight:"600",whiteSpace:"nowrap",minWidth:"45px"}}>{(p.revenue / 10000).toFixed(0)}만</div>
        <div style={{display:"flex",gap:"3px"}}>{p.issues.length>0 && <span style={{fontSize:"11px"}}>⚠️</span>}{p.unreadMsg>0 && <span style={{fontSize:"10px",background:"#2563eb",color:"#fff",borderRadius:"8px",padding:"0 5px",fontWeight:"700",fontFamily:"'DM Mono',monospace"}}>{p.unreadMsg}</span>}</div>
        <button
          className="cc-inline-action"
          style={{background:primaryAction.bg,borderColor:primaryAction.border,color:primaryAction.color}}
          onClick={event=>{
            event.stopPropagation();
            runPrimaryAction(p);
          }}
        >
          {primaryAction.label}
        </button>
      </div>
    );
  };

  const DetailPanel = () => {
    if(!selProp){
      return (
        <div className="no-sel">
          <div style={{fontSize:"36px",opacity:0.2}}>🏠</div>
          <div>숙소를 선택하세요</div>
          <div style={{fontSize:"11px",color:"#cbd5e0"}}>목록에서 숙소를 클릭하면<br />상세 정보가 표시됩니다</div>
        </div>
      );
    }

    const p = props.find(item=>item.id===selProp.id) || selProp;

    return (
      <>
        <div style={{padding:"16px 18px",borderBottom:"1.5px solid #e2e8f0",flexShrink:0,background:"#ffffff"}}>
          <div style={{fontSize:"11px",color:"#94a3b8",fontFamily:"'DM Mono',monospace",marginBottom:"4px",fontWeight:500}}>#{String(p.id).padStart(3,"0")} · {p.type}</div>
          <div style={{fontSize:"14px",fontWeight:"800",color:"#1e293b",lineHeight:"1.3"}}>{p.name}</div>
          <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
            <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1.5px solid ${SC[p.status]}44`}}>{p.status}</span>
            <span className="badge-sm" style={{background:p.priority==="HIGH"?"#fef2f2":p.priority==="MED"?"#fffbeb":"#ecfdf5",color:PC[p.priority],border:`1.5px solid ${PC[p.priority]}44`}}>{p.priority==="HIGH"?"🚨 긴급":p.priority==="MED"?"⚠ 주의":"✓ 정상"}</span>
          </div>
        </div>

        <div className="dtabs">
          {[["info","정보"],["iot","IoT"],["msg","메시지"],["clean","청소"]].map(([id, label])=>(
            <div key={id} className={`dtab ${dTab===id ? "active" : ""}`} onClick={()=>setDTab(id)}>{label}</div>
          ))}
        </div>

        {dTab==="info" && (
          <div className="dbody">
            <div className="d-label">숙소 정보</div>
            {[["위치",p.city],["유형",p.type],["상태",p.status],["플랫폼",p.platform],["평점",`★ ${p.rating}`],["수익",`${p.revenue.toLocaleString()}원`]].map(([key, value])=>(
              <div className="d-row" key={key}><span className="d-k">{key}</span><span className="d-v">{value}</span></div>
            ))}
            {p.guest && (
              <>
                <div className="d-label" style={{marginTop:"14px"}}>현재 게스트</div>
                {[["이름",p.guest],["체크인",p.checkIn],["체크아웃",p.checkOut]].map(([key, value])=>(
                  <div className="d-row" key={key}><span className="d-k">{key}</span><span className="d-v">{value}</span></div>
                ))}
              </>
            )}
            {p.issues.length>0 && (
              <div style={{marginTop:"14px",padding:"12px 14px",borderRadius:"8px",background:"#fef2f2",border:"1.5px solid #fecaca"}}>
                <div style={{fontSize:"11px",color:"#dc2626",fontWeight:"700",marginBottom:"6px"}}>🚨 이슈</div>
                {p.issues.map((issue, index)=>(
                  <div key={index} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:"12px",color:"#dc2626",fontWeight:"600"}}>{issue}</span>
                    <button className="act-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fff",fontSize:"10px",padding:"4px 9px"}} onClick={()=>setProps(list=>list.map(item=>item.id===p.id ? {...item, issues:[], priority:"OK"} : item))}>처리</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"14px"}}>
              <button className="act-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb",fontSize:"11px"}} onClick={()=>setDTab("clean")}>🧹 청소 배정</button>
              <button className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff",fontSize:"11px"}} onClick={()=>setDTab("msg")}>💬 메시지</button>
              <button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5",fontSize:"11px"}} onClick={()=>setDTab("iot")}>🔌 IoT 제어</button>
            </div>
          </div>
        )}

        {dTab==="iot" && (
          <div className="dbody">
            <div className="d-label">IoT 디바이스</div>
            {[
              {icon:"🔒",name:"현관 도어락",dev:"lockOpen",val:p.lockOpen?"열림":"잠김",valC:p.lockOpen?"#dc2626":"#059669"},
              {icon:"❄️",name:"에어컨",dev:"acOn",val:p.acOn?`${p.acTemp}°C`:"OFF",valC:p.acOn?"#2563eb":"#a0aec0"},
              {icon:"💡",name:"조명",dev:"lightsOn",val:p.lightsOn?"ON":"OFF",valC:p.lightsOn?"#d97706":"#a0aec0"},
            ].map(device=>(
              <div key={device.dev} className="dev-row">
                <span style={{fontSize:"18px",width:"26px",textAlign:"center"}}>{device.icon}</span>
                <span style={{fontSize:"12px",color:"#4a5568",flex:1,fontWeight:"500"}}>{device.name}</span>
                {device.dev==="acOn" && p.acOn && <button className="adj" onClick={()=>adjAc(p.id,-1)}>−</button>}
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:"12px",color:device.valC,minWidth:"42px",textAlign:"center",fontWeight:"600"}}>{device.val}</span>
                {device.dev==="acOn" && p.acOn && <button className="adj" onClick={()=>adjAc(p.id,1)}>+</button>}
                <button className={`tog ${p[device.dev] ? "on" : ""}`} onClick={()=>toggleDev(p.id, device.dev)}><div className="tog-d" /></button>
              </div>
            ))}
            <div className="d-label" style={{marginTop:"14px"}}>센서 데이터</div>
            {[["실내 온도",`${p.temp}°C`,"#2563eb"],["습도",`${p.humidity}%`,"#4a5568"],["스마트락",p.smartLock?"연결됨":"미설치","#718096"]].map(([key, value, color])=>(
              <div className="d-row" key={key}><span className="d-k">{key}</span><span className="d-v" style={{color}}>{value}</span></div>
            ))}
            <div className="d-label" style={{marginTop:"14px"}}>씬 프리셋</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
              {[["취침 모드","🌙"],["외출 모드","🚪"],["환영 모드","👋"],["청소 모드","🧹"]].map(([label, icon])=>(
                <button key={label} className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff",fontSize:"11px"}}>{icon} {label}</button>
              ))}
            </div>
          </div>
        )}

        {dTab==="msg" && (
          <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
            <div style={{flex:1,overflow:"auto",padding:"12px",display:"flex",flexDirection:"column",minHeight:0,background:"#f7f9fc"}}>
              {p.guest ? (
                <>
                  <div className="chat-b chat-g">안녕하세요! 체크인은 몇 시인가요?</div>
                  <div style={{fontSize:"10px",color:"#a0aec0",marginBottom:"8px"}}>09:21</div>
                  <div className="chat-b chat-h" style={{alignSelf:"flex-end"}}>오후 3시부터 입실 가능합니다 😊</div>
                  <div style={{fontSize:"10px",color:"#a0aec0",textAlign:"right",marginBottom:"8px"}}>09:23</div>
                  {chat.map((item, index)=>(
                    <div key={index} style={{display:"flex",flexDirection:"column",alignItems:item.from==="host"?"flex-end":"flex-start"}}>
                      <div className={`chat-b chat-${item.from}`} style={{alignSelf:item.from==="host"?"flex-end":"flex-start"}}>{item.text}</div>
                      <div style={{fontSize:"10px",color:"#a0aec0",marginBottom:"6px",textAlign:item.from==="host"?"right":"left"}}>{item.time}</div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{color:"#a0aec0",fontSize:"13px",textAlign:"center",marginTop:"30px"}}>현재 게스트 없음</div>
              )}
            </div>
            <div style={{padding:"10px 12px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#fff"}}>
              <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                {["체크아웃 안내","와이파이 정보","불편사항 접수"].map(quick=>(
                  <button key={quick} onClick={()=>setMsgIn(quick)} style={{fontSize:"10px",padding:"4px 9px",borderRadius:"20px",background:"#f7f9fc",border:"1.5px solid #e2e8f0",color:"#4a5568",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"500"}}>{quick}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:"6px"}}>
                <input className="msg-in" placeholder="메시지..." value={msgIn} onChange={e=>setMsgIn(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&msgIn.trim()){setChat(list=>[...list,{from:"host",text:msgIn,time:now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}]);setMsgIn("");}}} />
                <button className="act-btn" style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontSize:"11px"}} onClick={()=>{if(msgIn.trim()){setChat(list=>[...list,{from:"host",text:msgIn,time:now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}]);setMsgIn("");}}}>전송</button>
              </div>
            </div>
          </div>
        )}

        {dTab==="clean" && (
          <div className="dbody">
            <div className="d-label">청소 배정</div>
            {CLEANERS.map(cleaner=>(
              <div className="cleaner-card" key={cleaner.id}>
                <div style={{width:"10px",height:"10px",borderRadius:"50%",background:cleaner.status==="가용"?"#059669":cleaner.status==="작업중"?"#d97706":"#cbd5e0",flexShrink:0}} />
                <div style={{flex:1}}>
                  <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{cleaner.name}</div>
                  <div style={{fontSize:"10px",color:"#718096",marginTop:"2px"}}>{cleaner.zone} · <span style={{color:cleaner.status==="가용"?"#059669":cleaner.status==="작업중"?"#d97706":"#94a3b8",fontWeight:"600"}}>{cleaner.status}</span></div>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#d97706",fontWeight:"600"}}>★{cleaner.rating}</div>
                {cleaner.status==="가용" && (
                  <button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5",fontSize:"10px",padding:"4px 9px"}} onClick={()=>{setCleanerAss(prev=>({...prev,[p.id]:cleaner.name})); Toast.show(`${cleaner.name}님을 ${p.name.split("#")[0].trim()}에 배정했습니다!`, "s");}}>
                    배정
                  </button>
                )}
              </div>
            ))}
            {cleanerAss[p.id] && <div style={{marginTop:"10px",padding:"11px 14px",borderRadius:"8px",background:"#ecfdf5",border:"1.5px solid #a7f3d0",fontSize:"13px",color:"#059669",fontWeight:"700"}}>✓ {cleanerAss[p.id]} 배정 완료</div>}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",padding:"0 18px",gap:"10px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",minHeight:54}}>
        <button onClick={onBack} style={{padding:"6px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#f8fafc",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}>← 뒤로</button>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"17px",fontWeight:"800",color:"#2563eb",whiteSpace:"nowrap",letterSpacing:"-0.5px"}}>PROP<span style={{color:"#dc2626"}}>OS</span></div>
        <div style={{fontSize:"11px",color:"#94a3b8",fontWeight:500,whiteSpace:"nowrap",paddingTop:1}}>전체 관제 센터 · 5단계 흐름에서 막힌 숙소부터 처리</div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",color:"#475569",fontWeight:"600",flexShrink:0}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
        <div style={{display:"flex",gap:"8px",alignItems:"center",marginLeft:"auto",flexShrink:0}}>
          <button onClick={()=>onOpenHomeAssistant?.()} style={{padding:"7px 14px",borderRadius:8,background:"#ffffff",border:"1.5px solid #e2e8f0",color:"#475569",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>🏠 대표 숙소 보기</button>
          {bulkSel.length>0 && (
            <div style={{fontSize:"11px",color:"#2563eb",fontFamily:"'DM Mono',monospace",border:"1px solid #bfdbfe",padding:"4px 10px",borderRadius:"20px",background:"#eff6ff",fontWeight:"600"}}>
              {bulkSel.length}개 선택 <span style={{cursor:"pointer",color:"#dc2626",marginLeft:"4px"}} onClick={()=>setBulkSel([])}>×</span>
            </div>
          )}
          <div style={{position:"relative",cursor:"pointer",padding:"6px 12px",borderRadius:"20px",background:unack>0?"#fef2f2":"#f7f9fc",border:`1.5px solid ${unack>0?"#fecaca":"#e2e8f0"}`,display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:unack>0?"#dc2626":"#718096",fontWeight:"700"}} onClick={openAlertsPanel}>
            🔔 {unack}
            {unack>0 && <div style={{position:"absolute",top:"-2px",right:"-2px",width:"8px",height:"8px",background:"#dc2626",borderRadius:"50%",animation:"pulse 1.5s infinite"}} />}
          </div>
          <button onClick={()=>setShowGcmd(true)} style={{padding:"7px 16px",borderRadius:8,background:"#2563eb",border:"1.5px solid #1d4ed8",color:"#fff",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>⚡ 전체 제어</button>
        </div>
      </div>

      <div className="cc-body">
        <div className="cc-main">
          <div className="prop-panel">
                <div className="pipeline-wrap">
                  {CC_STAGES.map(item=>{
                    const count = props.filter(item.filter).length;
                    const urgentCount = props.filter(item.filter).filter(prop=>prop.priority==="HIGH" || prop.issues.length > 0).length;
                    const active = stage===item.id;
                    return (
                      <div key={item.id} className={`pipeline-card ${active ? "active" : ""}`} style={{borderColor:active?item.color:item.border,background:active?item.bg:"#fff",color:item.color}} onClick={()=>setStage(item.id)}>
                        {urgentCount>0 && <div className="pipeline-urgent">🔴 {urgentCount}</div>}
                        <div style={{fontSize:"16px",marginBottom:"2px"}}>{item.emoji}</div>
                        <div className="pipeline-count" style={{color:item.color}}>{count}</div>
                        <div className="pipeline-code">{item.code}</div>
                        <div className="pipeline-label" style={{color:active?item.color:"#475569"}}>{item.label}</div>
                        <div className="pipeline-meta">{urgentCount > 0 ? `긴급 ${urgentCount}` : `${count}곳 운영 중`}</div>
                      </div>
                    );
                  })}
                </div>

                {currentStage.desc && (
                  <div className="cc-focus-strip" style={{background:currentStage.bg,borderBottom:`1px solid ${currentStage.border}`}}>
                    <div className="cc-focus-copy">
                      <div className="cc-focus-eyebrow">{currentStage.code} · {currentStage.label}</div>
                      <div className="cc-focus-title">{stageFocusTitle}</div>
                      <div className="cc-focus-desc">{stageFocusDesc}</div>
                      <div className="cc-focus-metrics">
                        {stageFocusMetrics.map(metric=>(
                          <span key={metric}>{metric}</span>
                        ))}
                        {bottleneckStage && <span>현재 병목 {bottleneckStage.code} · {bottleneckStage.label}</span>}
                      </div>
                    </div>
                    <div className="stage-bar-actions">
                      {currentDrilldown && (
                        <button className="stage-action-btn" style={{background:"#ffffff",borderColor:"#cbd5e0",color:"#475569"}} onClick={()=>onOpenScenario?.(currentDrilldown.screen)}>
                          {currentDrilldown.label}
                        </button>
                      )}
                      <button className="stage-action-btn" style={{background:"#ffffff",borderColor:"#e2e8f0",color:"#475569"}} onClick={openAlertsPanel}>
                        실시간 알림 보기
                      </button>
                      {currentStage.action && filtered.length > 0 && (
                        <button className="stage-action-btn" style={{background:currentStage.bg,borderColor:currentStage.color,color:currentStage.color}} onClick={()=>Toast.show(`${currentStage.action} 실행 중...`, "s")}>
                          {currentStage.action}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="cc-action-queue">
                  <div className="cc-section-header">
                    <div>
                      <div className="cc-section-eyebrow">지금 바로 처리할 숙소</div>
                      <div className="cc-section-title">우선순위 상위 {stageActionQueue.length}곳</div>
                    </div>
                    <div className="cc-section-meta">{currentStage.code} · {currentStage.label} 단계에서 바로 열 숙소만 먼저 추렸습니다. 나머지는 아래 전체 목록에서 확인합니다.</div>
                  </div>
                  {stageActionQueue.length > 0 ? (
                    <div className="cc-queue-grid">
                      {stageActionQueue.map(({prop, action})=>(
                        <button key={prop.id} className="cc-queue-card" onClick={()=>focusProperty(prop, action.tab)}>
                          <div className="cc-queue-top">
                            <span className="badge-sm" style={{background:SC[prop.status]+"18",color:SC[prop.status],border:`1px solid ${SC[prop.status]}44`}}>{prop.status}</span>
                            <span className="cc-queue-priority" style={{color:action.color}}>{action.label}</span>
                          </div>
                          <div className="cc-queue-name">{prop.name}</div>
                          <div className="cc-queue-detail">{action.detail}</div>
                          <div className="cc-queue-meta">
                            <span>{prop.guest || "게스트 없음"}</span>
                            <span>미읽음 {prop.unreadMsg}</span>
                            <span>이슈 {prop.issues.length}</span>
                          </div>
                          <div className="cc-queue-footer">
                            <span>상세 열기</span>
                            <span>→</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="cc-empty-state">
                      <div className="cc-empty-title">{currentStage.label} 단계는 지금 안정적입니다</div>
                      <div className="cc-empty-desc">아래 전체 목록에서 예외 숙소를 다시 확인하거나, 다른 단계를 눌러 병목이 있는지 확인하세요.</div>
                    </div>
                  )}
                </div>

                <div className="toolbar">
                  <input className="srch" placeholder={`${currentStage.label} 숙소 검색...`} value={search} onChange={e=>setSearch(e.target.value)} />
                  <div style={{flex:1}} />
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#a0aec0",fontWeight:"500"}}>전체 목록 {filtered.length}개</span>
                  <div style={{display:"flex",border:"1.5px solid #e2e8f0",borderRadius:"20px",overflow:"hidden"}}>
                    {[["grid","▦"],["list","≡"]].map(([mode, icon])=>(
                      <button key={mode} onClick={()=>setGMode(mode)} style={{padding:"5px 10px",fontSize:"14px",cursor:"pointer",border:"none",background:gMode===mode?"#2563eb":"transparent",color:gMode===mode?"#fff":"#a0aec0",transition:"all 0.15s"}}>{icon}</button>
                    ))}
                  </div>
                </div>

                {gMode==="grid" ? (
                  <div className="prop-grid">{filtered.map(prop=><PCard key={prop.id} p={prop} />)}</div>
                ) : (
                  <div className="prop-list">
                    <div className="lrow" style={{cursor:"default",background:"transparent",border:"none",borderBottom:"1px solid #e2e8f0",borderRadius:0,padding:"3px 12px"}}>
                      {[["14px",""],["8px",""],["flex-2","숙소"],["50px","상태"],["flex-1","게스트"],["auto","센서"],["40px","수익"],["30px",""]].map(([width, label], index)=>(
                        <div key={index} style={{[width.includes("flex") ? "flex" : "width"]: width.replace("flex-",""),fontSize:"10px",color:"#a0aec0",fontWeight:"600"}}>{label}</div>
                      ))}
                    </div>
                    {filtered.map(prop=><LRow key={prop.id} p={prop} />)}
                  </div>
                )}
          </div>

          <div className="detail-panel">
            <DetailPanel />
          </div>

          <div className="alert-panel">
            <div className="alert-hdr">
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:3,height:13,background:"#dc2626",borderRadius:2,display:"inline-block",flexShrink:0}} />
                <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",color:"#475569",textTransform:"uppercase"}}>실시간 알림</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:20,padding:"1px 7px",fontWeight:700,marginLeft:4}}>LIVE</span>
              </div>
              <button onClick={ackAll} style={{fontSize:"10px",color:"#718096",background:"none",border:"1.5px solid #e2e8f0",borderRadius:"20px",padding:"3px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"600"}}>전체 확인</button>
            </div>
            <div className="alert-list-wrap">
              {alerts.map(alert=>(
                <div key={alert.id} className={`aitem ${alert.acked ? "acked" : ""}`} style={{borderLeftColor:{error:"#dc2626",warn:"#d97706",info:"#2563eb"}[alert.type],background:{error:"#fef2f2",warn:"#fffbeb",info:"#eff6ff"}[alert.type]}}>
                  <div style={{fontSize:"10px",fontWeight:"700",color:{error:"#dc2626",warn:"#d97706",info:"#2563eb"}[alert.type],marginBottom:"3px"}}>{alert.prop}</div>
                  <div style={{fontSize:"12px",color:"#4a5568",fontWeight:"500"}}>{alert.msg}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#a0aec0",marginTop:"3px"}}>{alert.time}</div>
                  {!alert.acked && <button style={{fontSize:"10px",padding:"3px 9px",borderRadius:"20px",border:`1.5px solid ${{error:"#fecaca",warn:"#fde68a",info:"#bfdbfe"}[alert.type]}`,cursor:"pointer",background:"#fff",color:{error:"#dc2626",warn:"#d97706",info:"#2563eb"}[alert.type],fontFamily:"'DM Sans',sans-serif",marginTop:"5px",fontWeight:"600"}} onClick={()=>ackAlert(alert.id)}>확인</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showGcmd && (
        <div className="modal-bg" onClick={()=>setShowGcmd(false)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"18px",fontWeight:"800",color:"#1a202c",marginBottom:"6px"}}>⚡ 글로벌 지휘 센터</div>
            <div style={{fontSize:"12px",color:"#718096",marginBottom:"20px"}}>{bulkSel.length>0?`선택된 ${bulkSel.length}개 숙소에 적용`:`전체 ${props.length}개 숙소에 적용`}</div>
            <div className="d-label">일괄 IoT 제어</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"20px"}}>
              {[["🔒 전체 도어락 잠금",()=>bulkToggle("lockOpen",false),"#059669","#ecfdf5","#a7f3d0"],["🔓 전체 도어락 해제",()=>bulkToggle("lockOpen",true),"#dc2626","#fef2f2","#fecaca"],["❄️ 에어컨 전체 ON",()=>bulkToggle("acOn",true),"#2563eb","#eff6ff","#bfdbfe"],["❄️ 에어컨 전체 OFF",()=>bulkToggle("acOn",false),"#718096","#f7f9fc","#e2e8f0"],["💡 조명 전체 ON",()=>bulkToggle("lightsOn",true),"#d97706","#fffbeb","#fde68a"],["💡 조명 전체 OFF",()=>bulkToggle("lightsOn",false),"#718096","#f7f9fc","#e2e8f0"]].map(([label, fn, color, bg, border])=>(
                <button key={label} className="cmd-btn" style={{color,borderColor:border,background:bg}} onClick={()=>{fn(); setShowGcmd(false);}}>
                  {label} <span style={{fontSize:"14px"}}>→</span>
                </button>
              ))}
            </div>
            <div className="d-label">전체 메시지 발송</div>
            <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
              <input className="msg-in" placeholder={`입실 중 ${occupied}개 숙소 게스트에게...`} value={globalMsg} onChange={e=>setGlobalMsg(e.target.value)} style={{flex:1}} />
              <button className="act-btn" style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontWeight:"700"}} onClick={()=>{if(globalMsg.trim()){Toast.show(`${occupied}개 숙소 게스트에게 발송: "${globalMsg}"`, "s"); setGlobalMsg(""); setShowGcmd(false);}}}>전송</button>
            </div>
            <div className="d-label" style={{marginTop:"16px"}}>긴급 액션</div>
            <div style={{display:"flex",gap:"8px"}}>
              <button className="cmd-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fef2f2",flex:1}} onClick={()=>{Toast.show("전체 긴급 알림 발송!", "e"); setShowGcmd(false);}}>🚨 전체 긴급 알림</button>
              <button className="cmd-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb",flex:1}} onClick={()=>{Toast.show("청소팀 전체 소집!", "s"); setShowGcmd(false);}}>🧹 청소팀 전체 소집</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommandCenter;
