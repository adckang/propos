import { useEffect, useState } from "react";

import { ALL_PROPS, AUTO_RULES, CLEANERS, INIT_ALERTS, PC, SC, rand, randN } from "../data/mockData";
import Toast from "../utils/toast";

// ============================================================
// CommandCenter.jsx — 전체 숙소 지휘 센터
// 시나리오 1~5를 기준으로 100개 숙소를 한눈에 보는 운영 화면
// ============================================================

const CC_STAGES = [
  {
    id:"all",
    emoji:"◈",
    label:"전체",
    color:"#4a5568",
    bg:"#f7f9fc",
    border:"#e2e8f0",
    filter: prop => true,
    desc:"전체 숙소 현황이에요. 긴급 순으로 정렬돼 있어요. 왼쪽 탭으로 단계별로 집중 관리하세요.",
    action:null,
  },
  {
    id:"d1",
    emoji:"📅",
    label:"내일 체크인",
    color:"#2563eb",
    bg:"#eff6ff",
    border:"#bfdbfe",
    filter: prop => prop.status === "예약됨",
    desc:"내일 게스트가 들어오는 숙소예요. PIN 발급, 웰컴 메시지, 스마트홈 초기화가 준비됐는지 확인하세요. 아직 안 된 곳은 [D-1 자동화 전체 실행]으로 한 번에 처리하세요.",
    action:"⚡ D-1 자동화 전체 실행",
  },
  {
    id:"occupied",
    emoji:"🏠",
    label:"지금 숙박 중",
    color:"#059669",
    bg:"#ecfdf5",
    border:"#a7f3d0",
    filter: prop => prop.status === "입실중" && prop.priority === "OK",
    desc:"현재 게스트가 머물고 있는 숙소예요. 미읽은 메시지나 긴급 요청이 있는 숙소를 먼저 확인하세요.",
    action:null,
  },
  {
    id:"monitoring",
    emoji:"📡",
    label:"센서 모니터링",
    color:"#7c3aed",
    bg:"#f5f3ff",
    border:"#ddd6fe",
    filter: prop => prop.status === "입실중" && (prop.priority === "HIGH" || prop.priority === "MED"),
    desc:"온도·습도·소음·전력 이상이 감지된 숙소예요. 빨간 숙소는 지금 즉시 확인이 필요해요. 클릭해서 어떤 센서가 문제인지 보세요.",
    action:"📡 전체 폴링 시작",
  },
  {
    id:"checkout",
    emoji:"🚪",
    label:"퇴실·청소 중",
    color:"#d97706",
    bg:"#fffbeb",
    border:"#fde68a",
    filter: prop => prop.status === "청소중",
    desc:"오늘 체크아웃이 완료됐거나 청소가 진행 중이에요. 청소 완료된 숙소를 확인하고 다음 예약 준비를 시작하세요.",
    action:"🧹 청소팀 전체 소집",
  },
  {
    id:"settlement",
    emoji:"💰",
    label:"이달 정산",
    color:"#0891b2",
    bg:"#ecfeff",
    border:"#a5f3fc",
    filter: prop => true,
    desc:"이번 달 전체 숙소의 수익을 집계하고 AI 가격 최적화 추천을 받을 수 있어요. [월 정산 실행]으로 한 번에 처리하세요.",
    action:"💰 월 정산 실행",
  },
];

function CommandCenter({onBack}) {
  const [stage, setStage] = useState("all");
  const [view, setView] = useState("command");
  const [props, setProps] = useState(ALL_PROPS);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [selProp, setSelProp] = useState(null);
  const [search, setSearch] = useState("");
  const [rules, setRules] = useState(AUTO_RULES);
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
  const stageProps = stage==="all" ? props : props.filter(currentStage.filter);
  const leadAlert = alerts.find(alert=>!alert.ack) || alerts[0];

  const occupied = props.filter(prop=>prop.status==="입실중").length;
  const vacant = props.filter(prop=>prop.status==="공실").length;
  const cleaning = props.filter(prop=>prop.status==="청소중").length;
  const highAlert = props.filter(prop=>prop.priority==="HIGH").length;
  const totalMsg = props.reduce((sum, prop)=>sum + prop.unreadMsg, 0);
  const totalRev = props.reduce((sum, prop)=>sum + prop.revenue, 0);
  const unack = alerts.filter(alert=>!alert.ack).length;
  const occ = Math.round((occupied / props.length) * 100);

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
        label:"체크인 준비",
        detail:`${prop.checkIn || "내일"} 체크인을 준비하세요.`,
        tab:"info",
        color:"#2563eb",
        bg:"#eff6ff",
        border:"#bfdbfe",
        toast:"체크인 준비 상태를 확인합니다.",
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

  const runPrimaryAction = prop => {
    const action = getPrimaryAction(prop);
    focusProperty(prop, action.tab);
    Toast.show(`${prop.name.split("#")[0].trim()} · ${action.toast}`, action.tone);
  };

  const stageOverviewCards = [
    {
      label:"즉시 대응",
      value: stageProps.filter(prop=>prop.priority==="HIGH" || prop.issues.length > 0).length,
      desc:"긴급 이슈와 유지보수",
      tone:{bg:"#fef2f2", border:"#fecaca", text:"#dc2626"},
    },
    {
      label:"체크인 준비",
      value: stageProps.filter(prop=>prop.status==="예약됨").length,
      desc:"내일 또는 당일 입실 예정",
      tone:{bg:"#eff6ff", border:"#bfdbfe", text:"#2563eb"},
    },
    {
      label:"메시지 응답",
      value: stageProps.filter(prop=>prop.unreadMsg > 0).length,
      desc:"게스트 응답 대기",
      tone:{bg:"#f5f3ff", border:"#ddd6fe", text:"#7c3aed"},
    },
    {
      label:"청소 흐름",
      value: stageProps.filter(prop=>prop.status==="청소중").length,
      desc:"퇴실 이후 다음 예약 준비",
      tone:{bg:"#fffbeb", border:"#fde68a", text:"#d97706"},
    },
  ];

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
    if(stageId==="occupied"){
      return (
        <div className="pcard-kpi">
          {prop.unreadMsg > 0 && <span className="pcard-kpi-item" style={{color:"#7c3aed",fontWeight:700}}>💬 미읽 {prop.unreadMsg}</span>}
          <span className="pcard-kpi-item" style={{color:"#64748b"}}>퇴실 {prop.checkOut || "—"}</span>
        </div>
      );
    }
    if(stageId==="monitoring"){
      return (
        <div className="pcard-kpi">
          <span className="pcard-kpi-item" style={{color:prop.temp>30?"#dc2626":"#2563eb"}}>🌡 {prop.temp}°C</span>
          <span className="pcard-kpi-item" style={{color:prop.humidity>80?"#dc2626":"#64748b"}}>💧 {prop.humidity}%</span>
          <span className="pcard-kpi-item" style={{color:prop.priority==="HIGH"?"#dc2626":"#d97706",fontWeight:700}}>{prop.priority==="HIGH"?"🔴이상":"🟡주의"}</span>
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
      stage==="occupied" ? "#059669" :
      stage==="monitoring" ? "#7c3aed" :
      stage==="checkout" ? "#d97706" :
      stage==="settlement" ? "#0891b2" :
      "transparent";

    return (
      <div className={`pcard ${p.priority} ${isSel ? "sel" : ""}`} onClick={()=>focusProperty(p, "info")} style={{borderTopColor: stage!=="all" ? stageColor : undefined}}>
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

  const renderAutomation = () => (
    <div className="view-wrap" style={{display:"flex",flexDirection:"column",gap:16,padding:20}}>
      <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
        <div className="vt"><span style={{width:3,height:13,background:"#2563eb",borderRadius:2,display:"inline-block",flexShrink:0}} /> 자동화 규칙 관리</div>
        {rules.map(rule=>(
          <div className="rule-row" key={rule.id}>
            <div style={{flex:1}}>
              <div style={{fontSize:"13px",fontWeight:"700",color:"#1e293b"}}>{rule.name}</div>
              <div style={{fontSize:"11px",color:"#64748b",marginTop:"3px"}}>트리거: {rule.trigger} → {rule.action}</div>
            </div>
            <button className={`tog ${rule.active ? "on" : ""}`} onClick={()=>setRules(list=>list.map(item=>item.id===rule.id ? {...item, active:!item.active} : item))}><div className="tog-d" /></button>
          </div>
        ))}
      </div>
      <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
        <div className="vt"><span style={{width:3,height:13,background:"#7c3aed",borderRadius:2,display:"inline-block",flexShrink:0}} /> AI 인사이트</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
          {[{ic:"🤖",t:"AI 권장사항",d:"서울 강남 지역 주말 가격 최적화 시 예상 수익 +18%",c:"#2563eb",bg:"#eff6ff"},{ic:"📊",t:"패턴 감지",d:"화~목 공실률 32% — 주중 할인 자동화 권장",c:"#d97706",bg:"#fffbeb"},{ic:"⚡",t:"효율 알림",d:"자동화로 이번 달 절약 시간: 약 14.3시간",c:"#059669",bg:"#ecfdf5"},{ic:"🔮",t:"예측 모델",d:"제주 다음 주 예약률 82% — 청소 인력 사전 배치 권장",c:"#7c3aed",bg:"#f5f3ff"}].map(card=>(
            <div key={card.t} style={{padding:"16px",background:card.bg,border:`1.5px solid ${card.c}22`,borderRadius:"10px",borderLeft:`4px solid ${card.c}`}}>
              <div style={{fontSize:"20px",marginBottom:"8px"}}>{card.ic}</div>
              <div style={{fontSize:"12px",fontWeight:"700",color:card.c,marginBottom:"5px"}}>{card.t}</div>
              <div style={{fontSize:"12px",color:"#4a5568",lineHeight:"1.6"}}>{card.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderRevenue = () => {
    const top = [...props].sort((a,b)=>b.revenue-a.revenue).slice(0,10);
    const maxRevenue = top[0]?.revenue || 1;
    const total = props.reduce((sum, prop)=>sum + prop.revenue, 0);
    return (
      <div className="view-wrap" style={{display:"flex",flexDirection:"column",gap:16,padding:20}}>
        <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
          <div className="vt"><span style={{width:3,height:13,background:"#059669",borderRadius:2,display:"inline-block",flexShrink:0}} /> 수익 분석 센터</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px"}}>
            {[{label:"총 월 수익",value:`${(total/10000).toFixed(0)}만원`,color:"#059669",bg:"#ecfdf5"},{label:"숙소당 평균",value:`${(total/props.length/10000).toFixed(0)}만원`,color:"#2563eb",bg:"#eff6ff"},{label:"점유율",value:`${occ}%`,color:"#d97706",bg:"#fffbeb"},{label:"수수료 추산",value:`${(total*0.11/10000).toFixed(0)}만원`,color:"#dc2626",bg:"#fef2f2"}].map(card=>(
              <div key={card.label} style={{background:card.bg,border:`1.5px solid ${card.color}22`,borderRadius:"10px",padding:"16px",borderTop:`3px solid ${card.color}`}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"22px",fontWeight:"700",color:card.color}}>{card.value}</div>
                <div style={{fontSize:"11px",color:"#64748b",marginTop:"6px",fontWeight:"600"}}>{card.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
          <div className="vt"><span style={{width:3,height:13,background:"#2563eb",borderRadius:2,display:"inline-block",flexShrink:0}} /> TOP 10 수익 숙소</div>
          {top.map(prop=>(
            <div key={prop.id} className="rev-row">
              <span style={{fontSize:"11px",color:"#4a5568",fontWeight:"500",width:"80px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prop.name.split(" ").slice(-1)[0]}</span>
              <div className="rev-bar"><div className="rev-fill" style={{width:`${(prop.revenue / maxRevenue) * 100}%`}} /></div>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#059669",fontWeight:"600",width:"55px",textAlign:"right"}}>{(prop.revenue / 10000).toFixed(0)}만</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCleaning = () => {
    const needCleaning = props.filter(prop=>prop.status==="청소중");
    const issues = props.filter(prop=>prop.issues.length>0);

    return (
      <div className="view-wrap" style={{display:"flex",flexDirection:"column",gap:16,padding:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
            <div className="vt"><span style={{width:3,height:13,background:"#059669",borderRadius:2,display:"inline-block",flexShrink:0}} /> 청소 인력 현황</div>
            {CLEANERS.map(cleaner=>(
              <div className="cleaner-card" key={cleaner.id}>
                <div style={{width:"10px",height:"10px",borderRadius:"50%",background:cleaner.status==="가용"?"#059669":cleaner.status==="작업중"?"#d97706":"#cbd5e0",flexShrink:0}} />
                <div style={{flex:1}}>
                  <div style={{fontSize:"13px",fontWeight:"700",color:"#1e293b"}}>{cleaner.name}</div>
                  <div style={{fontSize:"10px",color:"#64748b",marginTop:"2px"}}>{cleaner.zone}</div>
                  <div style={{fontSize:"11px",color:cleaner.status==="가용"?"#059669":cleaner.status==="작업중"?"#d97706":"#94a3b8",fontWeight:"600"}}>{cleaner.status}</div>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#d97706",fontWeight:"600"}}>★{cleaner.rating}</div>
              </div>
            ))}
          </div>
          <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
            <div className="vt"><span style={{width:3,height:13,background:"#d97706",borderRadius:2,display:"inline-block",flexShrink:0}} /> 청소 대기 ({needCleaning.length})</div>
            {needCleaning.slice(0,7).map(prop=>(
              <div key={prop.id} style={{padding:"10px 13px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:"8px",marginBottom:"5px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:"12px",fontWeight:"700",color:"#1e293b"}}>{prop.name.split(" ").slice(-2).join(" ")}</div>
                  <div style={{fontSize:"10px",color:"#94a3b8",marginTop:"2px"}}>{prop.city}</div>
                </div>
                <button className="act-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb",fontSize:"11px",padding:"5px 10px"}}>배정</button>
              </div>
            ))}
          </div>
        </div>
        <div style={{background:"#ffffff",border:"1.5px solid #e2e8f0",borderRadius:12,padding:18}}>
          <div className="vt"><span style={{width:3,height:13,background:"#dc2626",borderRadius:2,display:"inline-block",flexShrink:0}} /> 유지보수 이슈 ({issues.length}건)</div>
          {issues.map(prop=>(
            <div key={prop.id} style={{padding:"10px 14px",background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:"8px",marginBottom:"6px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:"12px",color:"#dc2626",fontWeight:"700"}}>{prop.name}</div>
                <div style={{fontSize:"11px",color:"#dc2626",opacity:0.7,marginTop:"3px"}}>⚠ {prop.issues[0]}</div>
              </div>
              <button className="act-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fff",fontSize:"11px",padding:"5px 10px"}} onClick={()=>setProps(list=>list.map(item=>item.id===prop.id ? {...item, issues:[], priority:"OK"} : item))}>처리완료</button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",padding:"0 18px",gap:"10px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",minHeight:54}}>
        <button onClick={onBack} style={{padding:"6px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#f8fafc",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}>← 뒤로</button>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"17px",fontWeight:"800",color:"#2563eb",whiteSpace:"nowrap",letterSpacing:"-0.5px"}}>PROP<span style={{color:"#dc2626"}}>OS</span></div>
        <div style={{fontSize:"11px",color:"#94a3b8",fontWeight:500,whiteSpace:"nowrap",paddingTop:1}}>전체 관제 센터</div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",color:"#475569",fontWeight:"600",flexShrink:0}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div className="kpi-top">
          {[[props.length,"전체","#4a5568"],[occupied,"입실중","#059669"],[props.filter(prop=>prop.status==="예약됨").length,"예약됨","#2563eb"],[vacant,"공실","#94a3b8"],[cleaning,"청소중","#d97706"],[highAlert,"긴급","#dc2626"],[totalMsg,"미읽","#7c3aed"],[`${(totalRev / 10000).toFixed(0)}만`,"수익","#059669"],[`${occ}%`,"점유율","#2563eb"]].map(([value, label, color])=>(
            <div key={label} className="kpi-t"><div className="kv" style={{color}}>{value}</div><div className="kl">{label}</div></div>
          ))}
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center",marginLeft:"auto",flexShrink:0}}>
          {bulkSel.length>0 && (
            <div style={{fontSize:"11px",color:"#2563eb",fontFamily:"'DM Mono',monospace",border:"1px solid #bfdbfe",padding:"4px 10px",borderRadius:"20px",background:"#eff6ff",fontWeight:"600"}}>
              {bulkSel.length}개 선택 <span style={{cursor:"pointer",color:"#dc2626",marginLeft:"4px"}} onClick={()=>setBulkSel([])}>×</span>
            </div>
          )}
          <div style={{position:"relative",cursor:"pointer",padding:"6px 12px",borderRadius:"20px",background:unack>0?"#fef2f2":"#f7f9fc",border:`1.5px solid ${unack>0?"#fecaca":"#e2e8f0"}`,display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:unack>0?"#dc2626":"#718096",fontWeight:"700"}} onClick={()=>setView(value=>value==="alerts"?"command":"alerts")}>
            🔔 {unack}
            {unack>0 && <div style={{position:"absolute",top:"-2px",right:"-2px",width:"8px",height:"8px",background:"#dc2626",borderRadius:"50%",animation:"pulse 1.5s infinite"}} />}
          </div>
          <button onClick={()=>setShowGcmd(true)} style={{padding:"7px 16px",borderRadius:8,background:"#2563eb",border:"1.5px solid #1d4ed8",color:"#fff",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>⚡ 전체 제어</button>
        </div>
      </div>

      <div className="cc-body">
        <div className="cc-sidenav">
          {[["command","◈","지휘"],["automation","⚙","자동화"],["revenue","💰","수익"],["cleaning","🧹","청소"]].map(([id, icon, label])=>(
            <div key={id} className={`cc-nav-ic ${view===id ? "active" : ""}`} onClick={()=>setView(id)} title={label}>
              <span style={{fontSize:18,lineHeight:1}}>{icon}</span>
              <span className="cc-nav-label" style={{color:view===id?"#2563eb":"#94a3b8"}}>{label}</span>
            </div>
          ))}
        </div>

        <div className="cc-main">
          {view==="command" && (
            <>
              <div className="prop-panel">
                <div className="pipeline-wrap">
                  {CC_STAGES.map(item=>{
                    const count = item.id==="all" ? props.length : props.filter(item.filter).length;
                    const urgentCount = props.filter(item.filter).filter(prop=>prop.priority==="HIGH").length;
                    const active = stage===item.id;
                    return (
                      <div key={item.id} className={`pipeline-card ${active ? "active" : ""}`} style={{borderColor:active?item.color:item.border,background:active?item.bg:"#fff",color:item.color}} onClick={()=>setStage(item.id)}>
                        {urgentCount>0 && item.id!=="all" && <div className="pipeline-urgent">🔴 {urgentCount}</div>}
                        <div style={{fontSize:"16px",marginBottom:"2px"}}>{item.emoji}</div>
                        <div className="pipeline-count" style={{color:item.color}}>{count}</div>
                        <div className="pipeline-label" style={{color:active?item.color:"#475569"}}>{item.label}</div>
                      </div>
                    );
                  })}
                </div>

                {leadAlert && (
                  <div className="cc-priority-banner">
                    <div className="cc-priority-copy">
                      <span className="cc-priority-chip">지금 가장 급한 알림</span>
                      <div className="cc-priority-title">{leadAlert.prop}</div>
                      <div className="cc-priority-desc">{leadAlert.msg} · {leadAlert.time}</div>
                    </div>
                    <div className="cc-priority-actions">
                      <button className="cc-banner-btn" onClick={()=>setView("alerts")}>알림 패널 열기</button>
                      <button className="cc-banner-btn cc-banner-btn-strong" onClick={()=>Toast.show("긴급 대응 큐를 상단에 고정했습니다.", "i")}>즉시 대응 큐 보기</button>
                    </div>
                  </div>
                )}

                {currentStage.desc && (
                  <div className="stage-bar">
                    <div className="stage-bar-desc">{currentStage.desc}</div>
                    {currentStage.action && (
                      <button className="stage-action-btn" style={{background:currentStage.bg,borderColor:currentStage.color,color:currentStage.color}} onClick={()=>Toast.show(`${currentStage.action} 실행 중...`, "s")}>
                        {currentStage.action}
                      </button>
                    )}
                  </div>
                )}

                <div className="cc-stage-overview">
                  {stageOverviewCards.map(card=>(
                    <div key={card.label} className="cc-stage-card" style={{background:card.tone.bg,borderColor:card.tone.border}}>
                      <div className="cc-stage-card-head">
                        <span>{card.label}</span>
                        <strong style={{color:card.tone.text}}>{card.value}</strong>
                      </div>
                      <div className="cc-stage-card-desc">{card.desc}</div>
                    </div>
                  ))}
                </div>

                <div className="cc-action-queue">
                  <div className="cc-section-header">
                    <div>
                      <div className="cc-section-eyebrow">즉시 대응 큐</div>
                      <div className="cc-section-title">{currentStage.label}에서 지금 먼저 처리할 숙소</div>
                    </div>
                    <div className="cc-section-meta">긴급도와 현재 단계 기준으로 상위 {stageActionQueue.length}개를 먼저 보여줘요.</div>
                  </div>
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
                </div>

                <div className="toolbar">
                  <input className="srch" placeholder="숙소 검색..." value={search} onChange={e=>setSearch(e.target.value)} />
                  <div style={{flex:1}} />
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#a0aec0",fontWeight:"500"}}>{filtered.length}개</span>
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
            </>
          )}

          {view==="automation" && renderAutomation()}
          {view==="revenue" && renderRevenue()}
          {view==="cleaning" && renderCleaning()}
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
