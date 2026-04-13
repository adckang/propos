import React, { useEffect, useRef, useState } from "react";

import { BOOKING, CLEANERS, DEVICES_INIT, EXPENSES, SINGLE_PROP } from "../data/mockData";
import Toast from "../utils/toast";

// ============================================================
// HomeAssistant.jsx — 개별 숙소 어시스턴트
// 시나리오 1~5를 한 축으로 재구성한 운영 화면
// ============================================================

function HomeAssistant({onBack}) {
  const [devs, setDevs] = useState(DEVICES_INIT);
  const [msgs, setMsgs] = useState([
    {id:1,from:"guest",text:"체크아웃 11시 맞죠?",time:"09:42"},
    {id:2,from:"host",text:"네, 맞습니다! 짐 보관 필요하시면 말씀해 주세요 😊",time:"09:45"},
    {id:3,from:"guest",text:"아리가또! 뷰가 너무 아름다워요 🌊",time:"10:12"},
  ]);
  const [msgIn, setMsgIn] = useState("");
  const [now, setNow] = useState(new Date());
  const [haStage, setHaStage] = useState("stay");
  const chatRef = useRef(null);

  useEffect(()=>{
    const timer = setInterval(()=>setNow(new Date()), 1000);
    return ()=>clearInterval(timer);
  },[]);

  useEffect(()=>{
    if(chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  },[msgs]);

  const toggleDev = id => setDevs(list=>list.map(item=>item.id===id ? {...item, state:!item.state} : item));

  const checkOutDate = new Date(BOOKING.checkOut);
  const checkInDate = new Date(BOOKING.checkIn);
  const diff = checkOutDate - now;
  const countdown = {
    days: Math.max(0, Math.floor(diff / 86400000)),
    hours: Math.max(0, Math.floor((diff % 86400000) / 3600000)),
    mins: Math.max(0, Math.floor((diff % 3600000) / 60000)),
    secs: Math.max(0, Math.floor((diff % 60000) / 1000)),
  };
  const progress = Math.min(100, Math.max(0, ((now - checkInDate) / (checkOutDate - checkInDate)) * 100));
  const netRevenue = EXPENSES.reduce((sum, item)=>sum + item.amount, 0);

  const sendMsg = text => {
    if(!(text || "").trim()) return;
    setMsgs(list=>[
      ...list,
      {
        id: Date.now(),
        from: "host",
        text,
        time: now.toLocaleTimeString("ko-KR", {hour:"2-digit", minute:"2-digit"}),
      },
    ]);
    setMsgIn("");
  };

  const HA_STAGES = [
    {id:"d1", emoji:"📅", label:"D-1 자동화", sub:"내일 체크인", color:"#2563eb", done:true},
    {id:"checkin", emoji:"🏠", label:"체크인", sub:"입실 완료", color:"#059669", done:true},
    {id:"stay", emoji:"📡", label:"체류 중", sub:"센서 모니터링", color:"#7c3aed", done:false},
    {id:"checkout", emoji:"🚪", label:"퇴실·청소", sub:"체크아웃 예정", color:"#d97706", done:false},
    {id:"revenue", emoji:"💰", label:"정산", sub:"이달 정산", color:"#0891b2", done:false},
  ];
  const currentStage = HA_STAGES.find(stage=>stage.id===haStage) || HA_STAGES[2];
  const connectedDevices = devs.filter(device=>device.state).length;
  const disconnectedDevices = devs.length - connectedDevices;
  const checkoutClock = `${countdown.days}일 ${countdown.hours}시간`;
  const stageGuides = {
    d1: {
      title:"내일 체크인 전에 PIN, 메시지, 스마트홈 초기화만 다시 확인하면 됩니다.",
      desc:"자동화는 완료 상태예요. 마지막으로 게스트가 바로 입실할 수 있는지만 체크하면 충분합니다.",
      checks:["PIN 발급 완료", "웰컴 메시지 발송 완료", "환영 모드 준비 완료"],
      primary:{label:"D-1 자동화 재실행", toast:"체크인 전날 자동화를 다시 점검했습니다.", tone:"s"},
      secondary:{label:"PIN 재발급", toast:"도어락 PIN 재발급 절차를 열었습니다.", tone:"i"},
      tone:{bg:"#eff6ff", border:"#bfdbfe", text:"#2563eb"},
    },
    checkin: {
      title:"입실 로그와 웰컴 씬 실행 결과를 확인하고, 게스트 첫 문의에 바로 답할 준비를 해두세요.",
      desc:"체크인이 끝난 직후에는 입실 성공 여부와 초기 안내만 명확하면 운영 피로가 크게 줄어듭니다.",
      checks:["도어락 입실 감지", "웰컴 씬 실행 완료", "입실 안내 메시지 발송"],
      primary:{label:"체크인 로그 다시 보기", toast:"체크인 흐름 요약을 다시 확인합니다.", tone:"i"},
      secondary:{label:"환영 메시지 재발송", toast:"환영 메시지 재발송 준비를 열었습니다.", tone:"s", prefill:`${BOOKING.guest.name}님, 입실은 잘 되셨나요? 필요하신 점이 있으면 편하게 말씀해 주세요.`},
      tone:{bg:"#ecfdf5", border:"#a7f3d0", text:"#059669"},
    },
    stay: {
      title:"센서 이상 여부와 미응답 메시지를 먼저 보면 체류 중 문제의 대부분을 빠르게 막을 수 있습니다.",
      desc:"운영자는 전체를 다 보는 대신, 연결이 끊겼거나 답장이 밀린 지점만 빠르게 처리하면 됩니다.",
      checks:["연결 끊긴 기기 확인", "게스트 대화 응답", "체크아웃 전 안내 준비"],
      primary:{label:"센서 재확인", toast:"현재 센서와 기기 연결 상태를 다시 확인했습니다.", tone:"i"},
      secondary:{label:"게스트 답장 작성", toast:"메시지 작성 상태로 이동했습니다.", tone:"s", prefill:"확인했습니다. 바로 조치하고 다시 안내드릴게요."},
      tone:{bg:"#f5f3ff", border:"#ddd6fe", text:"#7c3aed"},
    },
    checkout: {
      title:"퇴실 후에는 청소 배정, 체크리스트, 유지보수 접수까지 한 흐름으로 이어지게 해야 합니다.",
      desc:"여기서 막히면 다음 예약 준비가 모두 늦어지기 때문에, 청소와 보수 상태를 먼저 확정해야 해요.",
      checks:["청소 인력 배정", "청소 체크리스트 진행", "유지보수 이슈 접수"],
      primary:{label:"청소 상태 확인", toast:"퇴실·청소 작업 현황을 다시 점검했습니다.", tone:"w"},
      secondary:{label:"유지보수 등록", toast:"유지보수 이슈 처리 흐름을 열었습니다.", tone:"i"},
      tone:{bg:"#fffbeb", border:"#fde68a", text:"#d97706"},
    },
    revenue: {
      title:"이번 예약의 매출, 비용, 순수익을 한 번에 검토하고 다음 가격 판단에 쓰면 됩니다.",
      desc:"정산 단계는 보기 좋은 숫자보다, 실제 남는 금액이 얼마인지 빠르게 이해되는 것이 중요합니다.",
      checks:["객실 매출 확인", "비용 누락 점검", "최종 순수익 확인"],
      primary:{label:"정산 요약 확인", toast:"정산 요약 카드를 기준으로 다시 검토합니다.", tone:"i"},
      secondary:{label:"수익 내역 검토", toast:"수익 상세 내역을 검토합니다.", tone:"s"},
      tone:{bg:"#ecfeff", border:"#a5f3fc", text:"#0891b2"},
    },
  };
  const stageEvents = {
    d1: [
      {time:"09:00", text:"체크인 전날 자동화 스케줄이 실행됐어요."},
      {time:"09:03", text:"도어락 PIN 4821 발급을 완료했어요."},
      {time:"09:05", text:"웰컴 메시지를 게스트에게 발송했어요."},
    ],
    checkin: [
      {time:"15:21", text:"도어락 해제 이벤트를 감지했어요."},
      {time:"15:23", text:"웰컴 씬과 냉방 설정이 적용됐어요."},
      {time:"15:25", text:"입실 완료 메시지를 자동 발송했어요."},
    ],
    stay: [
      {time:"09:42", text:"게스트가 체크아웃 시간을 문의했어요."},
      {time:"10:12", text:"게스트가 전망 만족 메시지를 남겼어요."},
      {time:"10:18", text:`현재 활성 기기 ${connectedDevices}대, 확인 필요 ${disconnectedDevices}대예요.`},
    ],
    checkout: [
      {time:"10:55", text:"퇴실 예정 시간 5분 전 알림이 발송됐어요."},
      {time:"11:02", text:"청소팀 배정 가능 상태를 확인했어요."},
      {time:"11:06", text:"유지보수 접수 여부를 점검 중이에요."},
    ],
    revenue: [
      {time:"18:10", text:"이번 예약 매출과 청소비를 집계했어요."},
      {time:"18:14", text:"플랫폼 수수료와 소모품 비용을 반영했어요."},
      {time:"18:18", text:"최종 순수익 계산을 완료했어요."},
    ],
  };
  const currentGuide = stageGuides[haStage];
  const currentEvents = stageEvents[haStage];
  const snapshotCards = [
    {
      label:"기기 연결",
      value:`${connectedDevices}/${devs.length}`,
      desc: disconnectedDevices===0 ? "모든 기기가 연결 중" : `${disconnectedDevices}대 확인 필요`,
      tone:{bg:"#eff6ff", border:"#bfdbfe", text:"#2563eb"},
    },
    {
      label:"게스트 대화",
      value:`${msgs.length}건`,
      desc:"최근 문의 흐름을 바로 볼 수 있어요.",
      tone:{bg:"#f5f3ff", border:"#ddd6fe", text:"#7c3aed"},
    },
    {
      label:"체크아웃까지",
      value:checkoutClock,
      desc:"다음 운영 전환 시점을 알려줘요.",
      tone:{bg:"#fffbeb", border:"#fde68a", text:"#d97706"},
    },
  ];

  const runGuideAction = action => {
    if(action.prefill){
      setMsgIn(action.prefill);
    }
    Toast.show(action.toast, action.tone);
  };

  return (
    <div className="ha-root">
      <div className="ha-topbar">
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {onBack && (
            <button
              onClick={onBack}
              style={{padding:"6px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#f8fafc",color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}
            >
              ← 뒤로
            </button>
          )}
          {onBack && <div style={{width:1,height:24,background:"#e2e8f0",flexShrink:0}} />}
          <span style={{fontSize:22,flexShrink:0}}>{SINGLE_PROP.emoji || "🏠"}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:800,fontSize:17,color:"#1e293b",lineHeight:1.2}}>{SINGLE_PROP.name}</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{SINGLE_PROP.address}</div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
            <span style={{background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:11,padding:"4px 12px",borderRadius:20,fontWeight:700,whiteSpace:"nowrap"}}>● {currentStage.sub}</span>
            <span style={{background:disconnectedDevices===0?"#ecfdf5":"#fffbeb",color:disconnectedDevices===0?"#059669":"#d97706",border:`1px solid ${disconnectedDevices===0?"#a7f3d0":"#fde68a"}`,fontSize:11,padding:"4px 12px",borderRadius:20,fontWeight:700,whiteSpace:"nowrap"}}>
              ● 홈 어시스턴트 {disconnectedDevices===0 ? "연결 정상" : "일부 확인 필요"}
            </span>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:18,color:"#2563eb",fontWeight:700}}>
                {now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
              </div>
              <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>
                {now.toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ha-timeline">
        {HA_STAGES.map((stage, index)=>(
          <React.Fragment key={stage.id}>
            <div
              className="ha-step"
              onClick={()=>setHaStage(stage.id)}
              style={{opacity: !stage.done && haStage !== stage.id ? 0.55 : 1}}
            >
              <div
                className="ha-step-dot"
                style={{
                  background: stage.id===haStage ? stage.color : stage.done ? "#e2e8f0" : "#f1f5f9",
                  color: stage.id===haStage ? "#fff" : stage.done ? "#64748b" : "#94a3b8",
                  border: stage.id!==haStage && !stage.done ? `2px solid ${stage.color}` : "2px solid transparent",
                  boxShadow: stage.id===haStage ? `0 0 0 3px ${stage.color}33` : "none",
                }}
              >
                {stage.done && stage.id!==haStage ? "✓" : stage.emoji}
              </div>
              <div
                className="ha-step-label"
                style={{color:stage.id===haStage ? stage.color : stage.done ? "#475569" : "#94a3b8", fontWeight:stage.id===haStage ? 800 : 600}}
              >
                {stage.label}
              </div>
              <div className="ha-step-sub">{stage.sub}</div>
            </div>
            {index < HA_STAGES.length - 1 && (
              <div className="ha-step-line" style={{background:stage.done ? "#059669" : "#e2e8f0"}} />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="ha-content">
        <div className="ha-stage-header">
          <span className="ha-stage-icon">{currentStage.emoji}</span>
          <div className="ha-stage-title" style={{color:currentStage.color}}>{currentStage.label}</div>
          <div className="ha-stage-sub">— {currentStage.sub}</div>
        </div>

        <div className="ha-focus-card" style={{background:currentGuide.tone.bg,borderColor:currentGuide.tone.border}}>
          <div className="ha-focus-copy">
            <div className="ha-focus-eyebrow">지금 할 일</div>
            <div className="ha-focus-title" style={{color:currentGuide.tone.text}}>{currentGuide.title}</div>
            <div className="ha-focus-desc">{currentGuide.desc}</div>
            <div className="ha-focus-checks">
              {currentGuide.checks.map(check=>(
                <div key={check} className="ha-focus-check">
                  <span>✓</span>
                  <span>{check}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ha-focus-actions">
            <button className="ha-focus-btn ha-focus-btn-strong" onClick={()=>runGuideAction(currentGuide.primary)}>{currentGuide.primary.label}</button>
            <button className="ha-focus-btn" onClick={()=>runGuideAction(currentGuide.secondary)}>{currentGuide.secondary.label}</button>
          </div>
        </div>

        <div className="ha-snapshot-grid">
          {snapshotCards.map(card=>(
            <div key={card.label} className="ha-snapshot-card" style={{background:card.tone.bg,borderColor:card.tone.border}}>
              <div className="ha-snapshot-head">
                <span>{card.label}</span>
                <strong style={{color:card.tone.text}}>{card.value}</strong>
              </div>
              <div className="ha-snapshot-desc">{card.desc}</div>
            </div>
          ))}
        </div>

        <div className="ha-event-card">
          <div className="ha-label">최근 운영 이벤트</div>
          <div className="ha-event-list">
            {currentEvents.map(event=>(
              <div key={`${event.time}-${event.text}`} className="ha-event-row">
                <div className="ha-event-time">{event.time}</div>
                <div className="ha-event-dot" style={{background:currentStage.color}} />
                <div className="ha-event-text">{event.text}</div>
              </div>
            ))}
          </div>
        </div>

        {haStage === "d1" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",marginBottom:"14px"}}>
              <div className="ha-card" style={{borderTop:"3px solid #2563eb"}}>
                <div className="ha-label">도어락 PIN 발급</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"32px",fontWeight:"700",color:"#2563eb",letterSpacing:"8px"}}>4821</div>
                <div style={{fontSize:"11px",color:"#059669",marginTop:"6px",fontWeight:"600"}}>✓ 발급 완료 · 체크인 1시간 전부터 유효</div>
              </div>
              <div className="ha-card" style={{borderTop:"3px solid #059669"}}>
                <div className="ha-label">웰컴 메시지</div>
                <div style={{fontSize:"12px",color:"#4a5568",lineHeight:"1.6",marginTop:"4px"}}>
                  {BOOKING.guest.name}님, 내일 체크인을 환영합니다! PIN: 4821
                </div>
                <span style={{display:"inline-block",marginTop:"10px",background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:"11px",padding:"3px 10px",borderRadius:"20px",fontWeight:"700"}}>✓ 발송 완료</span>
              </div>
            </div>
            <div className="ha-card">
              <div className="ha-label">스마트홈 초기화</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px"}}>
                {[["🌡 에어컨","24°C 설정","#2563eb"],["💡 조명","환영 모드","#d97706"],["🔒 도어락","초기화 완료","#059669"]].map(([label, value, color])=>(
                  <div key={label} style={{background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:"10px",padding:"14px",textAlign:"center"}}>
                    <div style={{fontSize:"20px",marginBottom:"6px"}}>{label.split(" ")[0]}</div>
                    <div style={{fontSize:"11px",color:"#64748b",fontWeight:"600"}}>{label.split(" ").slice(1).join(" ")}</div>
                    <div style={{fontSize:"12px",color, fontWeight:"700",marginTop:"4px"}}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:"14px",display:"flex",gap:"8px"}}>
                <button className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff"}}>⚡ D-1 자동화 재실행</button>
                <button className="act-btn" style={{color:"#718096",borderColor:"#e2e8f0",background:"#f8fafc"}}>↻ PIN 재발급</button>
              </div>
            </div>
          </>
        )}

        {haStage === "checkin" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",marginBottom:"14px"}}>
              <div className="ha-card" style={{borderTop:"3px solid #059669"}}>
                <div className="ha-label">입실 확인</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"26px",fontWeight:"700",color:"#059669"}}>15:23</div>
                <div style={{fontSize:"12px",color:"#718096",marginTop:"4px"}}>03월 07일 · 실제 입실</div>
                <span style={{display:"inline-block",marginTop:"10px",background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:"11px",padding:"4px 12px",borderRadius:"20px",fontWeight:"700"}}>✓ 도어락 감지 완료</span>
              </div>
              <div className="ha-card" style={{borderTop:"3px solid #2563eb"}}>
                <div className="ha-label">체크아웃 예정</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"26px",fontWeight:"700",color:"#2563eb"}}>03월 12일</div>
                <div style={{fontSize:"12px",color:"#718096",marginTop:"4px"}}>11:00 AM</div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",color:"#a0aec0",marginTop:"12px",marginBottom:"6px"}}>
                  <span>{progress.toFixed(0)}% 경과</span>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{width:`${progress}%`}} /></div>
              </div>
            </div>
            <div className="ha-card">
              <div className="ha-label">체크인 씬 실행 결과</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                {[["🎬 웰컴 씬 실행",true],["💡 조명 켜짐",true],["❄️ 에어컨 24°C",true],["💬 게스트 채팅 오픈",true],["📩 입실 확인 메시지",true],["🔓 도어락 해제 후 복원",true]].map(([item, done], index)=>(
                  <div key={index} style={{display:"flex",gap:"8px",alignItems:"center",padding:"9px 12px",background:done?"#f0fdf4":"#f7f9fc",borderRadius:"8px",border:`1px solid ${done?"#a7f3d0":"#e2e8f0"}`}}>
                    <div style={{width:"16px",height:"16px",borderRadius:"4px",background:done?"#059669":"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"10px",flexShrink:0,fontWeight:"700"}}>{done?"✓":""}</div>
                    <span style={{fontSize:"12px",color:done?"#065f46":"#718096",fontWeight:done?"600":"400"}}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {haStage === "stay" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"12px",marginBottom:"14px"}}>
              {[
                {label:"온도", value:"24°C", icon:"🌡", color:"#2563eb", ok:true},
                {label:"습도", value:"62%", icon:"💧", color:"#4a5568", ok:true},
                {label:"소음", value:"—", icon:"🔊", color:"#94a3b8", ok:true},
                {label:"전력", value:"—", icon:"⚡", color:"#94a3b8", ok:true},
              ].map(card=>(
                <div key={card.label} className="ha-card" style={{marginBottom:0,borderTop:`3px solid ${card.ok ? "#059669" : "#dc2626"}`,padding:"14px"}}>
                  <div style={{fontSize:"18px",marginBottom:"4px"}}>{card.icon}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:"20px",fontWeight:"700",color:card.color}}>{card.value}</div>
                  <div style={{fontSize:"10px",color:"#94a3b8",marginTop:"4px",fontWeight:"600"}}>{card.label}</div>
                  <div style={{fontSize:"9px",color:card.ok && card.value !== "—" ? "#059669" : "#dc2626",fontWeight:"600",marginTop:"2px"}}>
                    {card.ok && card.value !== "—" ? "정상" : "미연결"}
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:"14px"}}>
              <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:"12px",overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.06)",display:"flex",flexDirection:"column",maxHeight:"340px"}}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:"#f7f9fc"}}>
                  <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{BOOKING.guest.avatar} {BOOKING.guest.name} 님</div>
                  <span style={{background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:"10px",padding:"2px 8px",borderRadius:"20px",fontWeight:"700"}}>● 온라인</span>
                </div>
                <div ref={chatRef} className="chat-msgs" style={{flex:1}}>
                  {msgs.map(message=>(
                    <div key={message.id} style={{display:"flex",flexDirection:"column",alignItems:message.from==="host"?"flex-end":"flex-start"}}>
                      <div className={`chat-b chat-${message.from}`}>{message.text}</div>
                      <div style={{fontSize:"10px",color:"#a0aec0",marginBottom:"6px",alignSelf:message.from==="host"?"flex-end":"flex-start"}}>{message.time}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:"10px 12px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#f7f9fc"}}>
                  <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                    {["체크아웃 안내","와이파이 정보","불편사항 접수"].map(quick=>(
                      <button key={quick} onClick={()=>sendMsg(quick)} style={{fontSize:"10px",padding:"3px 8px",borderRadius:"20px",background:"#fff",border:"1.5px solid #e2e8f0",color:"#4a5568",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"500"}}>{quick}</button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:"6px"}}>
                    <input className="msg-in" placeholder="메시지 입력..." value={msgIn} onChange={e=>setMsgIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg(msgIn.slice(0,2000))} />
                    <button className="act-btn" style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontWeight:"700",fontSize:"11px",padding:"5px 12px"}} onClick={()=>sendMsg(msgIn)}>전송</button>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                <div className="ha-card" style={{marginBottom:0}}>
                  <div className="ha-label">특이사항</div>
                  <div style={{fontSize:"12px",color:"#4a5568",lineHeight:"1.7"}}>{BOOKING.specialRequests}</div>
                </div>
                <div className="ha-card" style={{marginBottom:0}}>
                  <div className="ha-label">체크아웃까지</div>
                  <div style={{display:"flex",justifyContent:"space-around"}}>
                    {[[countdown.days,"일"],[countdown.hours,"시"],[countdown.mins,"분"],[countdown.secs,"초"]].map(([value, unit], index)=>(
                      <div key={unit} style={{display:"flex",alignItems:"center"}}>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"22px",fontWeight:"700",color:"#2563eb"}}>{String(value).padStart(2,"0")}</div>
                          <div style={{fontSize:"10px",color:"#a0aec0",marginTop:"2px"}}>{unit}</div>
                        </div>
                        {index < 3 && <span style={{color:"#e2e8f0",margin:"0 3px",paddingBottom:"10px",fontSize:"18px"}}>:</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {haStage === "checkout" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px",marginBottom:"14px"}}>
              {[
                {label:"PIN 상태", value:"유효", color:"#059669"},
                {label:"청소 상태", value:"완료", color:"#059669"},
                {label:"퇴실 청소", value:"03/12", color:"#d97706"},
              ].map(card=>(
                <div key={card.label} className="ha-card" style={{marginBottom:0,borderTop:`3px solid ${card.color}`}}>
                  <div className="ha-label">{card.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:"22px",fontWeight:"700",color:card.color}}>{card.value}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
              <div className="ha-card">
                <div className="ha-label">청소 인력 배정</div>
                {CLEANERS.slice(0,2).map(cleaner=>(
                  <div key={cleaner.id} className="cleaner-card">
                    <div style={{width:"10px",height:"10px",borderRadius:"50%",background:cleaner.status==="가용"?"#059669":cleaner.status==="작업중"?"#d97706":"#cbd5e0",flexShrink:0}} />
                    <div style={{flex:1}}>
                      <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{cleaner.name}</div>
                      <div style={{fontSize:"11px",color:"#718096",marginTop:"2px"}}>{cleaner.zone} · {cleaner.status}</div>
                    </div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#d97706",fontWeight:"600"}}>★{cleaner.rating}</div>
                    {cleaner.status==="가용" && <button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5",fontSize:"10px",padding:"4px 9px"}}>배정</button>}
                  </div>
                ))}
              </div>
              <div className="ha-card">
                <div className="ha-label">청소 체크리스트</div>
                {[["침구 교체",true],["화장실 청소",true],["주방 청소",true],["바닥 청소",false],["쓰레기 비우기",false]].map(([item, done], index)=>(
                  <div key={index} style={{display:"flex",gap:"8px",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{width:"16px",height:"16px",borderRadius:"4px",background:done?"#059669":"#f1f5f9",border:`1.5px solid ${done?"#059669":"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"10px",flexShrink:0,fontWeight:"700"}}>{done?"✓":""}</div>
                    <span style={{fontSize:"12px",color:done?"#065f46":"#64748b",fontWeight:done?"600":"400",textDecoration:done?"line-through":""}}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="ha-card" style={{marginTop:"14px"}}>
              <div className="ha-label">유지보수 이슈</div>
              <div style={{padding:"12px 14px",borderRadius:"8px",background:"#fef2f2",border:"1.5px solid #fecaca",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:"13px",color:"#dc2626",fontWeight:"600"}}>⚠ 욕실 샤워헤드 수압 약함 (게스트 보고)</span>
                <button className="act-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fff",fontSize:"11px",padding:"5px 10px"}}>처리</button>
              </div>
            </div>
          </>
        )}

        {haStage === "revenue" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px",marginBottom:"14px"}}>
              {[
                {label:"객실 매출", value:"1,250,000원", color:"#059669"},
                {label:"총 비용", value:"235,000원", color:"#dc2626"},
                {label:"순수익", value:`${(netRevenue / 10000).toFixed(0)}만원`, color:"#2563eb"},
              ].map(card=>(
                <div key={card.label} className="ha-card" style={{marginBottom:0,borderTop:`3px solid ${card.color}`}}>
                  <div className="ha-label">{card.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:"20px",fontWeight:"700",color:card.color}}>{card.value}</div>
                </div>
              ))}
            </div>
            <div className="ha-card">
              <div className="ha-label">이번 예약 수익 내역</div>
              {EXPENSES.map((expense, index)=>(
                <div key={index} className="ha-drow">
                  <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                    <div style={{width:"8px",height:"8px",borderRadius:"50%",background:expense.type==="income"?"#059669":"#dc2626"}} />
                    <span style={{fontSize:"13px",color:"#1a202c"}}>{expense.desc}</span>
                  </div>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",fontWeight:"700",color:expense.type==="income"?"#059669":"#dc2626"}}>
                    {expense.type==="income"?"+":""}{expense.amount.toLocaleString()}원
                  </span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"13px 0 4px",borderTop:"2px solid #e2e8f0",marginTop:"4px"}}>
                <span style={{fontSize:"14px",fontWeight:"700",color:"#1a202c"}}>최종 순수익</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:"16px",fontWeight:"700",color:"#2563eb"}}>+{netRevenue.toLocaleString()}원</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="ha-quick-strip">
        <div className="ha-quick-label">빠른 제어</div>
        {devs.slice(0,5).map(device=>(
          <div key={device.id} onClick={()=>toggleDev(device.id)} style={{display:"flex",alignItems:"center",gap:"5px",padding:"6px 12px",borderRadius:"20px",background:device.state?"#eff6ff":"#f7f9fc",border:`1.5px solid ${device.state?"#bfdbfe":"#e2e8f0"}`,cursor:"pointer",transition:"all 0.15s",flexShrink:0}}>
            <span style={{fontSize:"13px"}}>{device.icon}</span>
            <span style={{fontSize:"11px",fontWeight:"600",color:device.state?"#2563eb":"#718096"}}>{device.label}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:device.state?"#2563eb":"#a0aec0",marginLeft:2}}>{device.state?"ON":"OFF"}</span>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:"6px",flexShrink:0}}>
          {["🌅 아침","🌙 취침","🎬 영화","🏠 퇴실"].map(scene=>(
            <button key={scene} className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff",fontSize:"11px",padding:"5px 10px"}}>{scene}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeAssistant;
