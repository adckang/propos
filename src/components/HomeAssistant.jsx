// ============================================================
// HomeAssistant.jsx — 개별 숙소 어시스턴트
// 의존성: mockData.js (BOOKING, SINGLE_PROP, DEVICES_INIT, CLEANERS, EXPENSES)
// 상태: tab, devs, msgs, msgIn, now
// ============================================================

function HomeAssistant({onBack}) {
  const [tab, setTab] = useState("overview");
  const [devs, setDevs] = useState(DEVICES_INIT);
  const [msgs, setMsgs] = useState([
    {id:1,from:"guest",text:"체크아웃 11시 맞죠?",time:"09:42"},
    {id:2,from:"host",text:"네, 맞습니다! 짐 보관 필요하시면 말씀해 주세요 😊",time:"09:45"},
    {id:3,from:"guest",text:"아리가또! 뷰가 너무 아름다워요 🌊",time:"10:12"},
  ]);
  const [msgIn, setMsgIn] = useState("");
  const [now, setNow] = useState(new Date());
  const chatRef = useRef(null);

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},[msgs]);

  const toggleDev = id => setDevs(d=>d.map(x=>x.id===id?{...x,state:!x.state}:x));
  const adjDev = (id,key,delta) => setDevs(d=>d.map(x=>x.id===id?{...x,[key]:Math.max(0,Math.min(100,x[key]+delta))}:x));

  const checkOutDate = new Date(BOOKING.checkOut);
  const checkInDate  = new Date(BOOKING.checkIn);
  const diff = checkOutDate - now;
  const cd = {
    days:  Math.max(0,Math.floor(diff/86400000)),
    hours: Math.max(0,Math.floor((diff%86400000)/3600000)),
    mins:  Math.max(0,Math.floor((diff%3600000)/60000)),
    secs:  Math.max(0,Math.floor((diff%60000)/1000)),
  };
  const prog   = Math.min(100,Math.max(0,((now-checkInDate)/(checkOutDate-checkInDate))*100));
  const netRev = EXPENSES.reduce((s,e)=>s+e.amount,0);

  const sendMsg = t => {
    if(!(t||"").trim()) return;
    setMsgs(m=>[...m,{id:Date.now(),from:"host",text:t,
      time:now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}]);
    setMsgIn("");
  };

  const TABS = [["overview","현황"],["checkinout","체크인/아웃"],["devices","스마트홈"],
                ["messages","메시지"],["cleaning","청소·정비"],["revenue","수익"]];

  return (
    <div className="ha-root">
      <div className="ha-topbar">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
              <span style={{fontSize:"26px"}}>{SINGLE_PROP.emoji||"🏠"}</span>
              <div>
                <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"20px",fontWeight:"800",color:"#1a202c"}}>{SINGLE_PROP.name}</div>
                <div style={{fontSize:"12px",color:"#718096",marginTop:"2px"}}>{SINGLE_PROP.address}</div>
              </div>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"22px",color:"#2563eb",fontWeight:"500"}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
            <div style={{fontSize:"11px",color:"#a0aec0",marginTop:"2px"}}>{now.toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})}</div>
          </div>
        </div>
        <div className="ha-tabs">{TABS.map(([id,l])=><div key={id} className={`ha-tab${tab===id?" active":""}`} onClick={()=>setTab(id)}>{l}</div>)}</div>
      </div>

      <div className="ha-content">
        {/* ── 탭 1: 현황 ─────────────────────────── */}
        {tab==="overview" && <>
          <div className="ha-card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
                <div style={{width:"48px",height:"48px",borderRadius:"50%",background:"#eff6ff",border:"2px solid #bfdbfe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"22px"}}>{BOOKING.guest.avatar}</div>
                <div>
                  <div style={{fontSize:"16px",fontWeight:"700",color:"#1a202c"}}>{BOOKING.guest.name}</div>
                  <div style={{fontSize:"12px",color:"#718096",marginTop:"2px"}}>{BOOKING.guests}명 · {BOOKING.nights}박 · {BOOKING.platform}</div>
                </div>
              </div>
              <span style={{background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:"11px",padding:"4px 12px",borderRadius:"20px",fontWeight:"700"}}>● 입실 중</span>
            </div>
            <div style={{marginTop:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",color:"#a0aec0",marginBottom:"6px"}}>
                <span>체크인 03/07 15:00</span>
                <span style={{color:"#2563eb",fontWeight:"600"}}>{prog.toFixed(0)}% 경과</span>
                <span>체크아웃 03/12 11:00</span>
              </div>
              <div className="progress-bar"><div className="progress-fill" style={{width:`${prog}%`}} /></div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
            <div className="ha-card">
              <div className="ha-label">체크아웃까지</div>
              <div style={{display:"flex",justifyContent:"space-around"}}>
                {[[cd.days,"일"],[cd.hours,"시"],[cd.mins,"분"],[cd.secs,"초"]].map(([n,u],i)=>(
                  <div key={u} style={{display:"flex",alignItems:"center"}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:"26px",fontWeight:"700",color:"#2563eb"}}>{String(n).padStart(2,"0")}</div>
                      <div style={{fontSize:"10px",color:"#a0aec0",marginTop:"2px"}}>{u}</div>
                    </div>
                    {i<3 && <span style={{color:"#e2e8f0",margin:"0 4px",paddingBottom:"12px",fontSize:"20px"}}>:</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="ha-card">
              <div className="ha-label">특이사항</div>
              <div style={{fontSize:"13px",color:"#4a5568",lineHeight:"1.7"}}>{BOOKING.specialRequests}</div>
            </div>
          </div>
          <div className="ha-card" style={{marginTop:"14px"}}>
            <div className="ha-label">스마트홈 빠른 제어</div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {devs.map(d=>(
                <div key={d.id} onClick={()=>toggleDev(d.id)} style={{display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:"20px",background:d.state?"#eff6ff":"#f7f9fc",border:`1.5px solid ${d.state?"#bfdbfe":"#e2e8f0"}`,cursor:"pointer",transition:"all 0.15s"}}>
                  <span style={{fontSize:"14px"}}>{d.icon}</span>
                  <span style={{fontSize:"12px",fontWeight:"600",color:d.state?"#2563eb":"#718096"}}>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ── 탭 2: 체크인/아웃 ─────────────────── */}
        {tab==="checkinout" && <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",marginBottom:"14px"}}>
            <div className="ha-card" style={{borderTop:"3px solid #059669"}}>
              <div className="ha-label">체크인</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:"26px",fontWeight:"700",color:"#059669"}}>03월 07일</div>
              <div style={{fontSize:"15px",color:"#718096",marginTop:"6px",fontWeight:"600"}}>15:00 PM</div>
              <span style={{display:"inline-block",marginTop:"12px",background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:"11px",padding:"4px 12px",borderRadius:"20px",fontWeight:"700"}}>✓ 완료</span>
            </div>
            <div className="ha-card" style={{borderTop:"3px solid #2563eb"}}>
              <div className="ha-label">체크아웃</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:"26px",fontWeight:"700",color:"#2563eb"}}>03월 12일</div>
              <div style={{fontSize:"15px",color:"#718096",marginTop:"6px",fontWeight:"600"}}>11:00 AM</div>
              <span style={{display:"inline-block",marginTop:"12px",background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",fontSize:"11px",padding:"4px 12px",borderRadius:"20px",fontWeight:"700"}}>예정</span>
            </div>
          </div>
          <div className="ha-card">
            <div className="ha-label">도어 액세스</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
              <div style={{background:"#f7f9fc",border:"1px solid #e2e8f0",borderRadius:"10px",padding:"16px"}}>
                <div style={{fontSize:"11px",color:"#718096",marginBottom:"8px",fontWeight:"600"}}>입장 PIN</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"30px",fontWeight:"700",color:"#2563eb",letterSpacing:"8px"}}>4821</div>
                <div style={{fontSize:"11px",color:"#a0aec0",marginTop:"6px"}}>체크아웃 후 만료</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                <button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5"}}>🔓 도어락 열기</button>
                <button className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff"}}>↻ PIN 재발급</button>
                <button className="act-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb"}}>⏱ 레이트 체크아웃</button>
              </div>
            </div>
          </div>
          <div className="ha-card" style={{marginTop:"14px"}}>
            <div className="ha-label">체크인 체크리스트</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              {[["청소 완료 확인",true],["비품 체크",true],["어메니티 보충",true],["스마트홈 초기화",true],["긴급연락처 카드",true],["냉장고 웰컴드링크",false]].map(([item,done],i)=>(
                <div key={i} style={{display:"flex",gap:"10px",alignItems:"center",padding:"10px 13px",background:done?"#f0fdf4":"#f7f9fc",borderRadius:"8px",border:`1px solid ${done?"#a7f3d0":"#e2e8f0"}`}}>
                  <div style={{width:"18px",height:"18px",borderRadius:"5px",background:done?"#059669":"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"11px",flexShrink:0,fontWeight:"700"}}>{done?"✓":""}</div>
                  <span style={{fontSize:"12px",color:done?"#065f46":"#718096",fontWeight:done?"600":"400"}}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ── 탭 3: 스마트홈 ───────────────────── */}
        {tab==="devices" && <>
          {[{cat:"security",label:"🔒 보안"},{cat:"climate",label:"❄️ 냉·난방"},{cat:"lighting",label:"💡 조명"},{cat:"comfort",label:"🛋️ 편의"},{cat:"entertainment",label:"🎬 엔터테인먼트"}].map(({cat,label})=>{
            const catDevs = devs.filter(d=>d.category===cat);
            if(!catDevs.length) return null;
            return <div key={cat} style={{marginBottom:"16px"}}>
              <div className="ha-label">{label}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"10px"}}>
                {catDevs.map(d=>(
                  <div key={d.id} style={{background:d.state?"#eff6ff":"#f7f9fc",border:`1.5px solid ${d.state?"#bfdbfe":"#e2e8f0"}`,borderRadius:"10px",padding:"14px",transition:"all 0.2s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                      <span style={{fontSize:"22px"}}>{d.icon}</span>
                      <button className={`tog ${d.state?"on":""}`} onClick={()=>toggleDev(d.id)}><div className="tog-d"/></button>
                    </div>
                    <div style={{fontSize:"12px",fontWeight:"600",color:"#4a5568"}}>{d.label}</div>
                    <div style={{fontSize:"11px",color:d.state?"#2563eb":"#a0aec0",marginTop:"3px",fontWeight:"600"}}>{d.state?"ON":"OFF"}</div>
                    {d.state&&d.type==="ac"&&<div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"9px"}}>
                      <button className="adj" onClick={()=>adjDev(d.id,"temp",-1)}>−</button>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",color:"#2563eb",flex:1,textAlign:"center",fontWeight:"500"}}>{d.temp}°C</span>
                      <button className="adj" onClick={()=>adjDev(d.id,"temp",1)}>+</button>
                    </div>}
                    {d.state&&d.type==="light"&&<div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"9px"}}>
                      <button className="adj" onClick={()=>adjDev(d.id,"brightness",-10)}>−</button>
                      <div style={{flex:1,height:"4px",background:"#e2e8f0",borderRadius:"2px"}}><div style={{height:"100%",background:"#2563eb",width:`${d.brightness}%`,borderRadius:"2px"}} /></div>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#2563eb"}}>{d.brightness}%</span>
                      <button className="adj" onClick={()=>adjDev(d.id,"brightness",10)}>+</button>
                    </div>}
                  </div>
                ))}
              </div>
            </div>;
          })}
          <div className="ha-label" style={{marginTop:"8px"}}>씬 프리셋</div>
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
            {["🌅 아침 모드","🌙 취침 모드","🎬 영화 모드","🏠 퇴실 모드"].map(s=><button key={s} className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff"}}>{s}</button>)}
          </div>
        </>}

        {/* ── 탭 4: 메시지 ─────────────────────── */}
        {tab==="messages" && (
          <div style={{height:"calc(100vh - 240px)",display:"flex",flexDirection:"column",background:"#fff",border:"1px solid #e2e8f0",borderRadius:"12px",overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}}>
            <div style={{padding:"14px 18px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:"#f7f9fc"}}>
              <div style={{fontSize:"14px",fontWeight:"700",color:"#1a202c"}}>{BOOKING.guest.avatar} {BOOKING.guest.name} 님</div>
              <span style={{background:"#ecfdf5",color:"#059669",border:"1px solid #a7f3d0",fontSize:"11px",padding:"3px 10px",borderRadius:"20px",fontWeight:"700"}}>● 온라인</span>
            </div>
            <div ref={chatRef} className="chat-msgs">
              {msgs.map(m=>(
                <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:m.from==="host"?"flex-end":"flex-start"}}>
                  <div className={`chat-b chat-${m.from}`}>{m.text}</div>
                  <div style={{fontSize:"10px",color:"#a0aec0",marginBottom:"6px",alignSelf:m.from==="host"?"flex-end":"flex-start"}}>{m.time}</div>
                </div>
              ))}
            </div>
            <div style={{padding:"12px 14px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#f7f9fc"}}>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
                {["체크아웃 안내","와이파이 정보","주변 맛집 추천","불편사항 접수"].map(q=>(
                  <button key={q} onClick={()=>sendMsg(q)} style={{fontSize:"11px",padding:"4px 10px",borderRadius:"20px",background:"#fff",border:"1.5px solid #e2e8f0",color:"#4a5568",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"500",transition:"all 0.15s"}}>{q}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:"8px"}}>
                <input className="msg-in" placeholder="메시지 입력..." value={msgIn} onChange={e=>setMsgIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg(msgIn.slice(0,2000))} />
                <button className="act-btn" style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontWeight:"700"}} onClick={()=>sendMsg(msgIn)}>전송</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 탭 5: 청소·정비 ─────────────────── */}
        {tab==="cleaning" && <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px",marginBottom:"14px"}}>
            {[{l:"청소 상태",v:"완료",c:"#059669"},{l:"다음 청소",v:"03/09",c:"#2563eb"},{l:"퇴실 청소",v:"03/12",c:"#d97706"}].map(s=>(
              <div key={s.l} className="ha-card" style={{marginBottom:0,borderTop:`3px solid ${s.c}`}}>
                <div className="ha-label">{s.l}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"24px",fontWeight:"700",color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div className="ha-card">
            <div className="ha-label">청소 인력</div>
            {CLEANERS.slice(0,3).map(c=>(
              <div key={c.id} className="cleaner-card">
                <div style={{width:"10px",height:"10px",borderRadius:"50%",background:c.status==="가용"?"#059669":c.status==="작업중"?"#d97706":"#cbd5e0",flexShrink:0}} />
                <div style={{flex:1}}>
                  <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{c.name}</div>
                  <div style={{fontSize:"11px",color:"#718096",marginTop:"2px"}}>{c.zone} · {c.status}</div>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"12px",color:"#d97706",fontWeight:"500"}}>★{c.rating}</div>
                {c.status==="가용" && <button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5",fontSize:"11px",padding:"5px 10px"}}>배정</button>}
              </div>
            ))}
          </div>
          <div className="ha-card" style={{marginTop:"14px"}}>
            <div className="ha-label">유지보수 이슈</div>
            <div style={{padding:"12px 14px",borderRadius:"8px",background:"#fef2f2",border:"1.5px solid #fecaca",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:"13px",color:"#dc2626",fontWeight:"600"}}>⚠ 욕실 샤워헤드 수압 약함 (게스트 보고)</span>
              <button className="act-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fff",fontSize:"11px",padding:"5px 10px"}}>처리</button>
            </div>
          </div>
        </>}

        {/* ── 탭 6: 수익 ──────────────────────── */}
        {tab==="revenue" && <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px",marginBottom:"14px"}}>
            {[{l:"객실 매출",v:"1,250,000원",c:"#059669"},{l:"총 비용",v:"235,000원",c:"#dc2626"},{l:"순수익",v:`${(netRev/10000).toFixed(0)}만원`,c:"#2563eb"}].map(s=>(
              <div key={s.l} className="ha-card" style={{marginBottom:0,borderTop:`3px solid ${s.c}`}}>
                <div className="ha-label">{s.l}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"20px",fontWeight:"700",color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div className="ha-card">
            <div className="ha-label">이번 예약 수익 내역</div>
            {EXPENSES.map((e,i)=>(
              <div key={i} className="ha-drow">
                <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                  <div style={{width:"8px",height:"8px",borderRadius:"50%",background:e.type==="income"?"#059669":"#dc2626"}} />
                  <span style={{fontSize:"13px",color:"#1a202c"}}>{e.desc}</span>
                </div>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:"13px",fontWeight:"700",color:e.type==="income"?"#059669":"#dc2626"}}>
                  {e.type==="income"?"+":""}{e.amount.toLocaleString()}원
                </span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"13px 0 4px",borderTop:"2px solid #e2e8f0",marginTop:"4px"}}>
              <span style={{fontSize:"14px",fontWeight:"700",color:"#1a202c"}}>최종 순수익</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"16px",fontWeight:"700",color:"#2563eb"}}>+{netRev.toLocaleString()}원</span>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
