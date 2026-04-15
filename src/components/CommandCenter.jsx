import { useEffect, useState } from "react";

import { ALL_PROPS, INIT_ALERTS, SC, rand, randN } from "../data/mockData";
import { OPERATIONS_STAGES, getStageById } from "../config/operationsModel.js";
import Toast from "../utils/toast";

// ============================================================
// CommandCenter.jsx — 전체 숙소 지휘 센터
// 시나리오 1~5를 기준으로 100개 숙소를 한눈에 보는 운영 화면
// ============================================================

const CC_STAGES = OPERATIONS_STAGES;

function hasUrgentSignal(prop) {
  return prop.priority === "HIGH" || prop.issues.length > 0;
}

function isActionableForStage(stageId, prop) {
  if(stageId === "d1"){
    return prop.status === "예약됨";
  }
  if(stageId === "checkin"){
    return prop.status === "예약됨" && (hasUrgentSignal(prop) || prop.unreadMsg > 0);
  }
  if(stageId === "stay"){
    return prop.status === "입실중" && (hasUrgentSignal(prop) || prop.unreadMsg > 0);
  }
  if(stageId === "checkout"){
    return prop.status === "청소중" || prop.status === "점검중" || prop.issues.length > 0;
  }
  if(stageId === "settlement"){
    return Number(prop.rating) < 4.3 || prop.revenue >= 500000;
  }
  return false;
}

function CommandCenter({onBack, onOpenScenario, onOpenHomeAssistant, initialStage = "stay"}) {
  const [stage, setStage] = useState("stay");
  const [props] = useState(ALL_PROPS);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [selProp, setSelProp] = useState(null);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(new Date());
  const [gMode, setGMode] = useState("grid");

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

  useEffect(()=>{
    setSelProp(null);
  },[stage]);

  const ackAlert = id => setAlerts(list=>list.map(item=>item.id===id ? {...item, ack:true} : item));
  const ackAll = () => setAlerts(list=>list.map(item=>({...item, ack:true})));

  const currentStage = getStageById(stage);
  const focusProperty = prop => {
    setSelProp(prop);
  };

  const stageMatchedProps = props.filter(prop=>currentStage.filter(prop));
  const actionableProps = stageMatchedProps
    .filter(prop=>isActionableForStage(stage, prop))
    .sort((a, b)=>{
      const order = {HIGH:0, MED:1, OK:2};
      return order[a.priority] - order[b.priority];
    });
  const filtered = stageMatchedProps
    .filter(prop=>{
      if(search && !prop.name.toLowerCase().includes(search.toLowerCase()) && !(prop.guest || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b)=>{
      const order = {HIGH:0, MED:1, OK:2};
      return order[a.priority] - order[b.priority];
    });
  const unack = alerts.filter(alert=>!alert.ack).length;
  const stageInsights = CC_STAGES.map(item=>{
    const matched = props.filter(item.filter);
    const count = matched.length;
    const actionable = matched.filter(prop=>isActionableForStage(item.id, prop)).length;
    const urgent = matched.filter(prop=>hasUrgentSignal(prop)).length;
    const unread = matched.reduce((sum, prop)=>sum + prop.unreadMsg, 0);
    return {
      id: item.id,
      code: item.code,
      label: item.label,
      count,
      actionable,
      urgent,
      unread,
      score: actionable * 3 + urgent + unread,
    };
  });
  const currentDrilldown = currentStage?.scenarioScreen
    ? { screen: currentStage.scenarioScreen, label: currentStage.batchActionLabel }
    : null;
  const currentInsight = stageInsights.find(item=>item.id===stage) || stageInsights[0];
  const stageLeadProp = actionableProps[0] || filtered[0] || null;

  const getPrimaryAction = prop => {
    if(prop.priority==="HIGH" || prop.issues.length > 0){
      return {
        label:"긴급 이슈",
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
        label:"메시지 확인",
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
        label:"체크인 준비",
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
        label:"청소 확인",
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
      label:"운영 점검",
      detail:"현재 체류 상태와 장치 연결을 빠르게 점검하세요.",
      tab:"iot",
      color:"#059669",
      bg:"#ecfdf5",
      border:"#a7f3d0",
      toast:"숙소 상태 확인 화면을 열었습니다.",
      tone:"s",
    };
  };

  const stageFocusTitle = stageLeadProp
    ? `${stageLeadProp.name}부터 보면 됩니다`
    : `${currentStage.label} 단계는 지금 안정적입니다`;
  const stageFocusDesc = stageLeadProp
    ? `${getPrimaryAction(stageLeadProp).detail} 커맨드 센터에서는 우선순위만 정하고, 숙소 한 곳은 대표 숙소 보드로 넘기거나 같은 문제 여러 곳은 일괄 처리로 넘기면 됩니다.`
    : "지금 바로 넘길 숙소는 없어요. 다른 단계를 눌러 막힌 곳이 있는지 확인해 보세요.";
  const stageDecisionCards = [
    {
      label: "지금 볼 숙소",
      value: selProp ? selProp.name : stageLeadProp ? stageLeadProp.name : "선택 대기",
      desc: "숙소 1건은 대표 숙소 보드에서 처리합니다.",
      tone: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
    },
    {
      label: "확인 필요한 숙소",
      value: `${currentInsight?.actionable || 0}곳`,
      desc: `${currentStage.label} 단계에서 사람 확인이 필요한 숙소 수입니다.`,
      tone: { bg: currentStage.bg, border: currentStage.border, text: currentStage.color },
    },
    {
      label: "방금 들어온 알림",
      value: `${unack}건`,
      desc: "실시간 알림 패널에서 최신 이벤트를 먼저 봅니다.",
      tone: { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" },
    },
  ];

  const openPropertyWorkspace = prop => {
    focusProperty(prop);
    const primaryAction = getPrimaryAction(prop);
    const routeReason = prop.issues.length > 0
      ? prop.issues[0]
      : prop.unreadMsg > 0
      ? `미읽음 메시지 ${prop.unreadMsg}건`
      : primaryAction.detail;
    onOpenHomeAssistant?.(stage, {
      source: "command-center",
      stage,
      property: prop,
      headline: primaryAction.label,
      reason: routeReason,
      nextActionLabel: primaryAction.label,
    });
    Toast.show(`${prop.name.split("#")[0].trim()} · 대표 숙소 보드로 넘깁니다.`, "i");
  };

  const openBatchWorkspace = () => {
    if(!currentDrilldown) return;
    onOpenScenario?.(currentDrilldown.screen);
  };

  const openAlertsPanel = () => {
    Toast.show("오른쪽 실시간 알림 패널에서 바로 확인할 수 있습니다.", "i");
  };

  const stageActionQueue = actionableProps.slice(0, 5).map(prop=>({
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
    const primaryAction = getPrimaryAction(p);
    const stageColor =
      stage==="d1" ? "#2563eb" :
      stage==="checkin" ? "#059669" :
      stage==="stay" ? "#7c3aed" :
      stage==="checkout" ? "#d97706" :
      stage==="settlement" ? "#0891b2" :
      "transparent";

    return (
      <div className={`pcard ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p)} style={{borderTopColor: stageColor}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
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
              openPropertyWorkspace(p);
            }}
          >
            대표 숙소 보기
          </button>
        </div>
      </div>
    );
  };

  const LRow = ({p}) => {
    const isSel = selProp?.id === p.id;
    const primaryAction = getPrimaryAction(p);
    return (
      <div className={`lrow ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p)}>
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
            openPropertyWorkspace(p);
          }}
        >
          대표 숙소 보기
        </button>
      </div>
    );
  };

  const DetailPanel = () => {
    if(!selProp){
      return (
        <div className="no-sel">
          <div style={{fontSize:"36px",opacity:0.2}}>🏠</div>
          <div>숙소를 하나 고르면 다음 할 일이 보입니다</div>
          <div style={{fontSize:"11px",color:"#cbd5e0",lineHeight:"1.7",textAlign:"center"}}>
            숙소 한 곳은 대표 숙소 화면으로 넘기고
            <br />
            같은 문제 숙소가 여러 곳이면 아래 버튼으로 묶어서 처리합니다
          </div>
          {currentDrilldown && (
            <button
              className="act-btn"
              style={{color:currentStage.color,borderColor:currentStage.border,background:currentStage.bg,fontSize:"11px",marginTop:"4px"}}
              onClick={openBatchWorkspace}
            >
              {currentDrilldown.label}
            </button>
          )}
        </div>
      );
    }

    const p = props.find(item=>item.id===selProp.id) || selProp;
    const primaryAction = getPrimaryAction(p);
    const routeReason = p.issues.length > 0
      ? p.issues[0]
      : p.unreadMsg > 0
      ? `미읽음 메시지 ${p.unreadMsg}건`
      : primaryAction.detail;

    return (
      <>
        <div style={{padding:"16px 18px",borderBottom:"1.5px solid #e2e8f0",flexShrink:0,background:"#ffffff"}}>
          <div style={{fontSize:"11px",color:"#94a3b8",fontFamily:"'DM Mono',monospace",marginBottom:"4px",fontWeight:500}}>#{String(p.id).padStart(3,"0")} · {p.type}</div>
          <div style={{fontSize:"14px",fontWeight:"800",color:"#1e293b",lineHeight:"1.3"}}>{p.name}</div>
          <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
            <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1.5px solid ${SC[p.status]}44`}}>{p.status}</span>
            <span className="badge-sm" style={{background:p.priority==="HIGH"?"#fef2f2":p.priority==="MED"?"#fffbeb":"#ecfdf5",color:p.priority==="HIGH"?"#dc2626":p.priority==="MED"?"#d97706":"#059669",border:`1.5px solid ${p.priority==="HIGH"?"#fecaca":p.priority==="MED"?"#fde68a":"#a7f3d0"}`}}>{p.priority==="HIGH"?"🚨 긴급":p.priority==="MED"?"⚠ 주의":"✓ 정상"}</span>
          </div>
        </div>
        <div className="dbody">
          <div style={{padding:"14px",borderRadius:"12px",background:primaryAction.bg,border:`1.5px solid ${primaryAction.border}`,marginBottom:"14px"}}>
            <div style={{fontSize:"10px",fontWeight:"800",letterSpacing:"0.08em",textTransform:"uppercase",color:"#94a3b8",marginBottom:"8px"}}>왜 이 숙소를 봐야 하나</div>
            <div style={{fontSize:"16px",fontWeight:"800",color:primaryAction.color,lineHeight:"1.45"}}>{primaryAction.label}</div>
            <div style={{fontSize:"12px",color:"#475569",lineHeight:"1.7",marginTop:"6px"}}>{routeReason}</div>
          </div>

          <div className="d-label">현재 상태</div>
          {[["단계", `${currentStage.code} · ${currentStage.label}`],["숙소 상태", p.status],["게스트", p.guest || "없음"],["미읽음", `${p.unreadMsg}건`],["이슈", `${p.issues.length}건`],["체크인", p.checkIn || "—"],["체크아웃", p.checkOut || "—"]].map(([key, value])=>(
            <div className="d-row" key={key}><span className="d-k">{key}</span><span className="d-v">{value}</span></div>
          ))}

          <div className="d-label" style={{marginTop:"14px"}}>커맨드 센터에서의 첫 액션</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px",marginBottom:"14px"}}>
            {[
              `1. 이 숙소가 지금 우선인지 확인합니다.`,
              `2. 숙소 1건이면 대표 숙소 보드로 넘깁니다.`,
              `3. 같은 단계 숙소가 여러 곳이면 ${currentStage.label} 일괄 처리로 넘깁니다.`,
            ].map(item=>(
              <div key={item} style={{fontSize:"12px",color:"#475569",lineHeight:"1.7",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:"10px",background:"#f8fafc"}}>
                {item}
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
            <button className="act-btn" style={{color:"#ffffff",borderColor:"#2563eb",background:"#2563eb",fontSize:"11px"}} onClick={()=>openPropertyWorkspace(p)}>대표 숙소 보드 열기</button>
            {currentDrilldown && (
              <button className="act-btn" style={{color:currentStage.color,borderColor:currentStage.border,background:currentStage.bg,fontSize:"11px"}} onClick={openBatchWorkspace}>
                {currentDrilldown.label}
              </button>
            )}
            <button className="act-btn" style={{color:"#718096",borderColor:"#e2e8f0",background:"#f8fafc",fontSize:"11px"}} onClick={()=>setSelProp(null)}>선택 해제</button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",padding:"0 18px",gap:"10px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",minHeight:54}}>
        <button onClick={onBack} style={{padding:"6px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#f8fafc",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}>← 뒤로</button>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"17px",fontWeight:"800",color:"#2563eb",whiteSpace:"nowrap",letterSpacing:"-0.5px"}}>PROP<span style={{color:"#dc2626"}}>OS</span></div>
        <div style={{fontSize:"11px",color:"#94a3b8",fontWeight:500,whiteSpace:"nowrap",paddingTop:1}}>전체 관제 센터 · 지금 멈춘 숙소만 골라 넘기는 곳</div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",color:"#475569",fontWeight:"600",flexShrink:0}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
        <div style={{display:"flex",gap:"8px",alignItems:"center",marginLeft:"auto",flexShrink:0}}>
          <button onClick={()=>onOpenHomeAssistant?.(stage)} style={{padding:"7px 14px",borderRadius:8,background:"#ffffff",border:"1.5px solid #e2e8f0",color:"#475569",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>🏠 대표 숙소 해결 보기</button>
          <div style={{position:"relative",cursor:"pointer",padding:"6px 12px",borderRadius:"20px",background:unack>0?"#fef2f2":"#f7f9fc",border:`1.5px solid ${unack>0?"#fecaca":"#e2e8f0"}`,display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:unack>0?"#dc2626":"#718096",fontWeight:"700"}} onClick={openAlertsPanel}>
            🔔 {unack}
            {unack>0 && <div style={{position:"absolute",top:"-2px",right:"-2px",width:"8px",height:"8px",background:"#dc2626",borderRadius:"50%",animation:"pulse 1.5s infinite"}} />}
          </div>
        </div>
      </div>

      <div className="cc-body">
        <div className="cc-main">
          <div className="prop-panel">
                <div className="pipeline-wrap">
                  {CC_STAGES.map(item=>{
                    const matched = props.filter(item.filter);
                    const count = matched.length;
                    const actionableCount = matched.filter(prop=>isActionableForStage(item.id, prop)).length;
                    const active = stage===item.id;
                    return (
                      <div key={item.id} className={`pipeline-card ${active ? "active" : ""}`} style={{borderColor:active?item.color:item.border,background:active?item.bg:"#fff",color:item.color}} onClick={()=>setStage(item.id)}>
                        {actionableCount>0 && <div className="pipeline-urgent">🔴 {actionableCount}</div>}
                        <div style={{fontSize:"16px",marginBottom:"2px"}}>{item.emoji}</div>
                        <div className="pipeline-count" style={{color:item.color}}>{actionableCount}</div>
                        <div className="pipeline-code">{item.code}</div>
                        <div className="pipeline-label" style={{color:active?item.color:"#475569"}}>{item.label}</div>
                        <div className="pipeline-meta">확인 필요 {actionableCount} · 전체 {count}</div>
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
                        {stageDecisionCards.map(metric=>(
                          <span key={metric.label}>
                            {metric.label} · {metric.value}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="stage-bar-actions">
                      {selProp && (
                        <button className="stage-action-btn" style={{background:"#2563eb",borderColor:"#1d4ed8",color:"#ffffff"}} onClick={()=>openPropertyWorkspace(selProp)}>
                          대표 숙소 보드 열기
                        </button>
                      )}
                      {currentDrilldown && (
                        <button className="stage-action-btn" style={{background:"#ffffff",borderColor:"#cbd5e0",color:"#475569"}} onClick={openBatchWorkspace}>
                          {currentDrilldown.label}
                        </button>
                      )}
                      <button className="stage-action-btn" style={{background:"#ffffff",borderColor:"#e2e8f0",color:"#475569"}} onClick={openAlertsPanel}>
                        실시간 알림 보기
                      </button>
                    </div>
                  </div>
                )}

                <div className="cc-action-queue">
                  <div className="cc-section-header">
                    <div>
                      <div className="cc-section-eyebrow">먼저 볼 숙소</div>
                      <div className="cc-section-title">바로 확인할 우선 {stageActionQueue.length}곳</div>
                    </div>
                    <div className="cc-section-meta">
                      {currentInsight?.actionable > stageActionQueue.length
                        ? `확인 필요한 전체 ${currentInsight.actionable}곳 중 우선순위 상위 ${stageActionQueue.length}곳만 먼저 보여줍니다.`
                        : "숙소 1건은 대표 숙소 보드로 넘기고, 여러 곳이면 단계별 일괄 처리로 넘어갑니다."}
                    </div>
                  </div>
                  {stageActionQueue.length > 0 ? (
                    <div className="cc-queue-grid">
                      {stageActionQueue.map(({prop, action})=>(
                        <button key={prop.id} className="cc-queue-card" onClick={()=>focusProperty(prop)}>
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
                            <span>대표 숙소 보드로 넘기기</span>
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
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#a0aec0",fontWeight:"500"}}>같은 단계 숙소 {filtered.length}개</span>
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

    </div>
  );
}

export default CommandCenter;
