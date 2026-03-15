// ============================================================
// CommandCenter.jsx — 전체 숙소 관제 센터
// 의존성: mockData.js (ALL_PROPS, INIT_ALERTS, AUTO_RULES, CLEANERS, SC, PC)
// 상태: view, props, alerts, selProp, filter, search, sortBy, rules, now,
//        showGcmd, dTab, bulkSel, gMode, msgIn, chat, cleanerAss, globalMsg
// 서브컴포넌트: PCard, LRow, DetailPanel (내부 정의)
// ============================================================
function CommandCenter({onBack}) {
  const [view, setView] = useState("command");
  const [props, setProps] = useState(ALL_PROPS);
  const [alerts, setAlerts] = useState(INIT_ALERTS);
  const [selProp, setSelProp] = useState(null);
  const [filter, setFilter] = useState("전체");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("priority");
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
    const t=setInterval(()=>setNow(new Date()),1000);
    const t2=setInterval(()=>{
      if(Math.random()<0.12){
        const p=props[randN(0,props.length-1)];
        setAlerts(a=>[{id:Date.now(),type:rand(["warn","info"]),prop:p.name,msg:rand(["게스트 메시지 수신","청소 완료 보고","체크인 완료","Wi-Fi 신호 약화"]),time:new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}),ack:false},...a.slice(0,28)]);
      }
    },9000);
    return()=>{clearInterval(t);clearInterval(t2);};
  },[]);

  const toggleDev = (id,dev) => setProps(p=>p.map(x=>x.id!==id?x:{...x,[dev]:!x[dev]}));
  const adjAc = (id,delta) => setProps(p=>p.map(x=>x.id!==id?x:{...x,acTemp:Math.max(16,Math.min(30,x.acTemp+delta))}));
  const ackAlert = id => setAlerts(a=>a.map(x=>x.id===id?{...x,ack:true}:x));
  const ackAll = () => setAlerts(a=>a.map(x=>({...x,ack:true})));
  const bulkToggle = (dev,val) => setProps(p=>p.map(x=>bulkSel.includes(x.id)?{...x,[dev]:val}:x));

  const filtered = props.filter(p=>{
    if(filter!=="전체"&&p.status!==filter)return false;
    if(search&&!p.name.toLowerCase().includes(search.toLowerCase())&&!(p.guest||"").toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  }).sort((a,b)=>{
    if(sortBy==="priority"){const o={HIGH:0,MED:1,OK:2};return o[a.priority]-o[b.priority];}
    if(sortBy==="revenue")return b.revenue-a.revenue;
    if(sortBy==="rating")return b.rating-a.rating;
    return 0;
  });

  const occupied=props.filter(p=>p.status==="입실중").length;
  const vacant=props.filter(p=>p.status==="공실").length;
  const cleaning=props.filter(p=>p.status==="청소중").length;
  const highAlert=props.filter(p=>p.priority==="HIGH").length;
  const totalMsg=props.reduce((s,p)=>s+p.unreadMsg,0);
  const totalRev=props.reduce((s,p)=>s+p.revenue,0);
  const unack=alerts.filter(a=>!a.ack).length;
  const occ=Math.round((occupied/props.length)*100);

  const PCard = ({p}) => {
    const isSel=selProp?.id===p.id, isBulk=bulkSel.includes(p.id);
    return (
      <div className={`pcard ${p.priority} ${isSel?"sel":""}`} onClick={()=>{setSelProp(p);setDTab("info");setChat([]);}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
            <div style={{width:"16px",height:"16px",borderRadius:"4px",border:`1.5px solid ${isBulk?"#2563eb":"#e2e8f0"}`,background:isBulk?"#eff6ff":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#2563eb",cursor:"pointer",flexShrink:0}}
              onClick={e=>{e.stopPropagation();setBulkSel(s=>isBulk?s.filter(x=>x!==p.id):[...s,p.id]);}}>{isBulk?"✓":""}</div>
            <div style={{width:"8px",height:"8px",borderRadius:"50%",background:SC[p.status]}} />
          </div>
          <div style={{display:"flex",gap:"4px"}}>
            {p.unreadMsg>0&&<span style={{fontSize:"10px",background:"#2563eb",color:"#fff",borderRadius:"10px",padding:"1px 6px",fontWeight:"700",fontFamily:"'DM Mono',monospace"}}>{p.unreadMsg}</span>}
            {p.issues.length>0&&<span style={{fontSize:"12px"}}>⚠️</span>}
          </div>
        </div>
        <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",lineHeight:"1.4",marginBottom:"6px"}}>{p.name}</div>
        <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
          <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1px solid ${SC[p.status]}44`}}>{p.status}</span>
          {p.guest&&<span style={{fontSize:"10px",color:"#718096"}}>{p.guest}</span>}
        </div>
        <div style={{display:"flex",gap:"10px",marginTop:"9px",paddingTop:"9px",borderTop:"1px solid #f0f4f8"}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#718096"}}>🌡{p.temp}°</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#718096"}}>★{p.rating}</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#059669",fontWeight:"600"}}>{(p.revenue/10000).toFixed(0)}만원</span>
        </div>
        {p.issues.length>0&&<div style={{fontSize:"10px",color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",padding:"3px 8px",borderRadius:"4px",marginTop:"6px",display:"inline-block",fontWeight:"600"}}>⚠ {p.issues[0]}</div>}
      </div>
    );
  };

  const LRow = ({p}) => {
    const isSel=selProp?.id===p.id, isBulk=bulkSel.includes(p.id);
    return (
      <div className={`lrow ${p.priority} ${isSel?"sel":""}`} onClick={()=>{setSelProp(p);setDTab("info");setChat([]);}}>
        <div style={{width:"16px",height:"16px",borderRadius:"4px",border:`1.5px solid ${isBulk?"#2563eb":"#e2e8f0"}`,background:isBulk?"#eff6ff":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#2563eb",cursor:"pointer",flexShrink:0}}
          onClick={e=>{e.stopPropagation();setBulkSel(s=>isBulk?s.filter(x=>x!==p.id):[...s,p.id]);}}>{isBulk?"✓":""}</div>
        <div style={{width:"8px",height:"8px",borderRadius:"50%",background:SC[p.status],flexShrink:0}} />
        <div style={{flex:2,minWidth:0}}>
          <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
          <div style={{fontSize:"10px",color:"#a0aec0"}}>{p.type}</div>
        </div>
        <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1px solid ${SC[p.status]}44`,whiteSpace:"nowrap"}}>{p.status}</span>
        <div style={{flex:1,fontSize:"11px",color:"#4a5568",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.guest||"—"}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#718096",whiteSpace:"nowrap"}}>🌡{p.temp}° ★{p.rating}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#059669",fontWeight:"600",whiteSpace:"nowrap",minWidth:"45px"}}>{(p.revenue/10000).toFixed(0)}만</div>
        <div style={{display:"flex",gap:"3px"}}>{p.issues.length>0&&<span style={{fontSize:"11px"}}>⚠️</span>}{p.unreadMsg>0&&<span style={{fontSize:"10px",background:"#2563eb",color:"#fff",borderRadius:"8px",padding:"0 5px",fontWeight:"700",fontFamily:"'DM Mono',monospace"}}>{p.unreadMsg}</span>}</div>
      </div>
    );
  };

  const DetailPanel = () => {
    if(!selProp) return <div className="no-sel"><div style={{fontSize:"36px",opacity:0.2}}>🏠</div><div>숙소를 선택하세요</div><div style={{fontSize:"11px",color:"#cbd5e0"}}>목록에서 숙소를 클릭하면<br/>상세 정보가 표시됩니다</div></div>;
    const p = props.find(x=>x.id===selProp.id)||selProp;

    return <>
      <div style={{padding:"14px 16px",borderBottom:"1px solid #e2e8f0",flexShrink:0,background:"#f7f9fc"}}>
        <div style={{fontSize:"11px",color:"#a0aec0",fontFamily:"'DM Mono',monospace",marginBottom:"4px"}}>#{String(p.id).padStart(3,"0")} · {p.type}</div>
        <div style={{fontSize:"14px",fontWeight:"800",color:"#1a202c",lineHeight:"1.3",fontFamily:"'Nunito',sans-serif"}}>{p.name}</div>
        <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
          <span className="badge-sm" style={{background:SC[p.status]+"18",color:SC[p.status],border:`1px solid ${SC[p.status]}44`}}>{p.status}</span>
          <span className="badge-sm" style={{background:p.priority==="HIGH"?"#fef2f2":p.priority==="MED"?"#fffbeb":"#ecfdf5",color:PC[p.priority],border:`1px solid ${PC[p.priority]}44`}}>{p.priority==="HIGH"?"🚨 긴급":p.priority==="MED"?"⚠ 주의":"✓ 정상"}</span>
        </div>
      </div>
      <div className="dtabs">
        {[["info","정보"],["iot","IoT"],["msg","메시지"],["clean","청소"]].map(([id,l])=>(
          <div key={id} className={`dtab ${dTab===id?"active":""}`} onClick={()=>setDTab(id)}>{l}</div>
        ))}
      </div>

      {dTab==="info" && <div className="dbody">
        <div className="d-label">숙소 정보</div>
        {[["위치",p.city],["유형",p.type],["상태",p.status],["플랫폼",p.platform],["평점",`★ ${p.rating}`],["수익",`${p.revenue.toLocaleString()}원`]].map(([k,v])=>(
          <div className="d-row" key={k}><span className="d-k">{k}</span><span className="d-v">{v}</span></div>
        ))}
        {p.guest && <>
          <div className="d-label" style={{marginTop:"14px"}}>현재 게스트</div>
          {[["이름",p.guest],["체크인",p.checkIn],["체크아웃",p.checkOut]].map(([k,v])=>(
            <div className="d-row" key={k}><span className="d-k">{k}</span><span className="d-v">{v}</span></div>
          ))}
        </>}
        {p.issues.length>0 && <div style={{marginTop:"14px",padding:"12px 14px",borderRadius:"8px",background:"#fef2f2",border:"1.5px solid #fecaca"}}>
          <div style={{fontSize:"11px",color:"#dc2626",fontWeight:"700",marginBottom:"6px"}}>🚨 이슈</div>
          {p.issues.map((iss,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:"12px",color:"#dc2626",fontWeight:"600"}}>{iss}</span>
              <button className="act-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fff",fontSize:"10px",padding:"4px 9px"}}
                onClick={()=>setProps(prev=>prev.map(x=>x.id===p.id?{...x,issues:[],priority:"OK"}:x))}>처리</button>
            </div>
          ))}
        </div>}
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"14px"}}>
          <button className="act-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb",fontSize:"11px"}} onClick={()=>setDTab("clean")}>🧹 청소 배정</button>
          <button className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff",fontSize:"11px"}} onClick={()=>setDTab("msg")}>💬 메시지</button>
          <button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5",fontSize:"11px"}} onClick={()=>setDTab("iot")}>🔌 IoT 제어</button>
        </div>
      </div>}

      {dTab==="iot" && <div className="dbody">
        <div className="d-label">IoT 디바이스</div>
        {[
          {icon:"🔒",name:"현관 도어락",dev:"lockOpen",val:p.lockOpen?"열림":"잠김",valC:p.lockOpen?"#dc2626":"#059669"},
          {icon:"❄️",name:"에어컨",dev:"acOn",val:p.acOn?`${p.acTemp}°C`:"OFF",valC:p.acOn?"#2563eb":"#a0aec0"},
          {icon:"💡",name:"조명",dev:"lightsOn",val:p.lightsOn?"ON":"OFF",valC:p.lightsOn?"#d97706":"#a0aec0"},
        ].map(d=>(
          <div key={d.dev} className="dev-row">
            <span style={{fontSize:"18px",width:"26px",textAlign:"center"}}>{d.icon}</span>
            <span style={{fontSize:"12px",color:"#4a5568",flex:1,fontWeight:"500"}}>{d.name}</span>
            {d.dev==="acOn"&&p.acOn&&<button className="adj" onClick={()=>adjAc(p.id,-1)}>−</button>}
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:"12px",color:d.valC,minWidth:"42px",textAlign:"center",fontWeight:"600"}}>{d.val}</span>
            {d.dev==="acOn"&&p.acOn&&<button className="adj" onClick={()=>adjAc(p.id,1)}>+</button>}
            <button className={`tog ${(p[d.dev])?"on":""}`} onClick={()=>toggleDev(p.id,d.dev)}><div className="tog-d"/></button>
          </div>
        ))}
        <div className="d-label" style={{marginTop:"14px"}}>센서 데이터</div>
        {[["실내 온도",`${p.temp}°C`,"#2563eb"],["습도",`${p.humidity}%`,"#4a5568"],["스마트락",p.smartLock?"연결됨":"미설치","#718096"]].map(([k,v,c])=>(
          <div className="d-row" key={k}><span className="d-k">{k}</span><span className="d-v" style={{color:c}}>{v}</span></div>
        ))}
        <div className="d-label" style={{marginTop:"14px"}}>씬 프리셋</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
          {[["취침 모드","🌙"],["외출 모드","🚪"],["환영 모드","👋"],["청소 모드","🧹"]].map(([s,ic])=>(
            <button key={s} className="act-btn" style={{color:"#2563eb",borderColor:"#bfdbfe",background:"#eff6ff",fontSize:"11px"}}>{ic} {s}</button>
          ))}
        </div>
      </div>}

      {dTab==="msg" && <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
        <div style={{flex:1,overflow:"auto",padding:"12px",display:"flex",flexDirection:"column",minHeight:0,background:"#f7f9fc"}}>
          {p.guest ? <>
            <div className="chat-b chat-g">안녕하세요! 체크인은 몇 시인가요?</div>
            <div style={{fontSize:"10px",color:"#a0aec0",marginBottom:"8px"}}>09:21</div>
            <div className="chat-b chat-h" style={{alignSelf:"flex-end"}}>오후 3시부터 입실 가능합니다 😊</div>
            <div style={{fontSize:"10px",color:"#a0aec0",textAlign:"right",marginBottom:"8px"}}>09:23</div>
            {chat.map((m,i)=>(
              <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.from==="host"?"flex-end":"flex-start"}}>
                <div className={`chat-b chat-${m.from}`} style={{alignSelf:m.from==="host"?"flex-end":"flex-start"}}>{m.text}</div>
                <div style={{fontSize:"10px",color:"#a0aec0",marginBottom:"6px",textAlign:m.from==="host"?"right":"left"}}>{m.time}</div>
              </div>
            ))}
          </> : <div style={{color:"#a0aec0",fontSize:"13px",textAlign:"center",marginTop:"30px"}}>현재 게스트 없음</div>}
        </div>
        <div style={{padding:"10px 12px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#fff"}}>
          <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
            {["체크아웃 안내","와이파이 정보","불편사항 접수"].map(q=>(
              <button key={q} onClick={()=>setMsgIn(q)} style={{fontSize:"10px",padding:"4px 9px",borderRadius:"20px",background:"#f7f9fc",border:"1.5px solid #e2e8f0",color:"#4a5568",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"500"}}>{q}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:"6px"}}>
            <input className="msg-in" placeholder="메시지..." value={msgIn} onChange={e=>setMsgIn(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&msgIn.trim()){setChat(c=>[...c,{from:"host",text:msgIn,time:now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}]);setMsgIn("");}}} />
            <button className="act-btn" style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontSize:"11px"}} onClick={()=>{if(msgIn.trim()){setChat(c=>[...c,{from:"host",text:msgIn,time:now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}]);setMsgIn("");;}}}>전송</button>
          </div>
        </div>
      </div>}

      {dTab==="clean" && <div className="dbody">
        <div className="d-label">청소 배정</div>
        {CLEANERS.map(c=>(
          <div className="cleaner-card" key={c.id}>
            <div style={{width:"10px",height:"10px",borderRadius:"50%",background:c.status==="가용"?"#059669":c.status==="작업중"?"#d97706":"#cbd5e0",flexShrink:0}} />
            <div style={{flex:1}}>
              <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{c.name}</div>
              <div style={{fontSize:"10px",color:"#718096",marginTop:"2px"}}>{c.zone} · <span style={{color:c.status==="가용"?"#059669":c.status==="작업중"?"#d97706":"#94a3b8",fontWeight:"600"}}>{c.status}</span></div>
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#d97706",fontWeight:"600"}}>★{c.rating}</div>
            {c.status==="가용"&&<button className="act-btn" style={{color:"#059669",borderColor:"#a7f3d0",background:"#ecfdf5",fontSize:"10px",padding:"4px 9px"}}
              onClick={()=>{setCleanerAss(prev=>({...prev,[p.id]:c.name}));Toast.show(`${c.name}님을 ${p.name.split("#")[0].trim()}에 배정했습니다!`,"s");}}>배정</button>}
          </div>
        ))}
        {cleanerAss[p.id]&&<div style={{marginTop:"10px",padding:"11px 14px",borderRadius:"8px",background:"#ecfdf5",border:"1.5px solid #a7f3d0",fontSize:"13px",color:"#059669",fontWeight:"700"}}>✓ {cleanerAss[p.id]} 배정 완료</div>}
      </div>}
    </>;
  };

  const renderAutomation = () => (
    <div className="view-wrap">
      <div className="vt">자동화 규칙 관리</div>
      {rules.map(r=>(
        <div className="rule-row" key={r.id}>
          <div style={{flex:1}}>
            <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{r.name}</div>
            <div style={{fontSize:"11px",color:"#718096",marginTop:"3px"}}>트리거: {r.trigger} → {r.action}</div>
          </div>
          <button className={`tog ${r.active?"on":""}`} onClick={()=>setRules(rs=>rs.map(x=>x.id===r.id?{...x,active:!x.active}:x))}><div className="tog-d"/></button>
        </div>
      ))}
      <div style={{marginTop:"24px"}}><div className="vt">AI 인사이트</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
          {[{ic:"🤖",t:"AI 권장사항",d:"서울 강남 지역 주말 가격 최적화 시 예상 수익 +18%",c:"#2563eb",bg:"#eff6ff"},{ic:"📊",t:"패턴 감지",d:"화~목 공실률 32% — 주중 할인 자동화 권장",c:"#d97706",bg:"#fffbeb"},{ic:"⚡",t:"효율 알림",d:"자동화로 이번 달 절약 시간: 약 14.3시간",c:"#059669",bg:"#ecfdf5"},{ic:"🔮",t:"예측 모델",d:"제주 다음 주 예약률 82% — 청소 인력 사전 배치 권장",c:"#7c3aed",bg:"#f5f3ff"}].map(x=>(
            <div key={x.t} style={{padding:"16px",background:x.bg,border:`1.5px solid ${x.c}22`,borderRadius:"10px",borderLeft:`4px solid ${x.c}`}}>
              <div style={{fontSize:"20px",marginBottom:"8px"}}>{x.ic}</div>
              <div style={{fontSize:"12px",fontWeight:"700",color:x.c,marginBottom:"5px"}}>{x.t}</div>
              <div style={{fontSize:"12px",color:"#4a5568",lineHeight:"1.6"}}>{x.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderRevenue = () => {
    const top = [...props].sort((a,b)=>b.revenue-a.revenue).slice(0,10);
    const maxR = top[0]?.revenue||1;
    const total = props.reduce((s,p)=>s+p.revenue,0);
    return (
      <div className="view-wrap">
        <div className="vt">수익 분석 센터</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"20px"}}>
          {[{l:"총 월 수익",v:`${(total/10000).toFixed(0)}만원`,c:"#059669",bg:"#ecfdf5"},{l:"숙소당 평균",v:`${(total/props.length/10000).toFixed(0)}만원`,c:"#2563eb",bg:"#eff6ff"},{l:"점유율",v:`${occ}%`,c:"#d97706",bg:"#fffbeb"},{l:"수수료 추산",v:`${(total*0.11/10000).toFixed(0)}만원`,c:"#dc2626",bg:"#fef2f2"}].map(k=>(
            <div key={k.l} style={{background:k.bg,border:`1.5px solid ${k.c}22`,borderRadius:"12px",padding:"16px",borderTop:`4px solid ${k.c}`}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:"24px",fontWeight:"700",color:k.c}}>{k.v}</div>
              <div style={{fontSize:"11px",color:"#718096",marginTop:"6px",fontWeight:"600"}}>{k.l}</div>
            </div>
          ))}
        </div>
        <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:"12px",padding:"20px",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <div className="d-label">TOP 10 수익 숙소</div>
          {top.map(p=>(
            <div key={p.id} className="rev-row">
              <span style={{fontSize:"11px",color:"#4a5568",fontWeight:"500",width:"80px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name.split(" ").slice(-1)[0]}</span>
              <div className="rev-bar"><div className="rev-fill" style={{width:`${(p.revenue/maxR)*100}%`}} /></div>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#059669",fontWeight:"600",width:"55px",textAlign:"right"}}>{(p.revenue/10000).toFixed(0)}만</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCleaning = () => {
    const needC = props.filter(p=>p.status==="청소중");
    const issues = props.filter(p=>p.issues.length>0);
    return (
      <div className="view-wrap">
        <div className="vt">청소 · 유지보수 관제</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"18px"}}>
          <div>
            <div className="d-label">청소 인력 현황</div>
            {CLEANERS.map(c=>(
              <div className="cleaner-card" key={c.id}>
                <div style={{width:"10px",height:"10px",borderRadius:"50%",background:c.status==="가용"?"#059669":c.status==="작업중"?"#d97706":"#cbd5e0",flexShrink:0}} />
                <div style={{flex:1}}>
                  <div style={{fontSize:"13px",fontWeight:"700",color:"#1a202c"}}>{c.name}</div>
                  <div style={{fontSize:"10px",color:"#718096",marginTop:"2px"}}>{c.zone}</div>
                  <div style={{fontSize:"11px",color:c.status==="가용"?"#059669":c.status==="작업중"?"#d97706":"#94a3b8",fontWeight:"600"}}>{c.status}</div>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#d97706",fontWeight:"600"}}>★{c.rating}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="d-label">청소 대기 ({needC.length})</div>
            {needC.slice(0,7).map(p=>(
              <div key={p.id} style={{padding:"10px 13px",background:"#fff",border:"1px solid #e2e8f0",borderRadius:"8px",marginBottom:"5px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
                <div>
                  <div style={{fontSize:"12px",fontWeight:"700",color:"#1a202c"}}>{p.name.split(" ").slice(-2).join(" ")}</div>
                  <div style={{fontSize:"10px",color:"#a0aec0",marginTop:"2px"}}>{p.city}</div>
                </div>
                <button className="act-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb",fontSize:"11px",padding:"5px 10px"}}>배정</button>
              </div>
            ))}
          </div>
        </div>
        <div style={{marginTop:"18px"}}>
          <div className="d-label">유지보수 이슈 ({issues.length}건)</div>
          {issues.map(p=>(
            <div key={p.id} style={{padding:"10px 14px",background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:"8px",marginBottom:"6px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:"12px",color:"#dc2626",fontWeight:"700"}}>{p.name}</div>
                <div style={{fontSize:"11px",color:"#dc2626",opacity:0.7,marginTop:"3px"}}>⚠ {p.issues[0]}</div>
              </div>
              <button className="act-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fff",fontSize:"11px",padding:"5px 10px"}}
                onClick={()=>setProps(prev=>prev.map(x=>x.id===p.id?{...x,issues:[],priority:"OK"}:x))}>처리완료</button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="app" style={{fontFamily:"'DM Sans',sans-serif"}}>
      {/* KPI TOPBAR */}
      <div style={{height:"54px",background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",padding:"0 18px",gap:"12px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
        <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"18px",fontWeight:"800",color:"#2563eb",whiteSpace:"nowrap"}}>PROP<span style={{color:"#dc2626"}}>OS</span></div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"14px",color:"#4a5568",fontWeight:"500"}}>{now.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
        <div style={{width:"1px",height:"26px",background:"#e2e8f0",flexShrink:0}} />
        <div className="kpi-top">
          {[[props.length,"전체","#4a5568"],[occupied,"입실중","#059669"],[props.filter(p=>p.status==="예약됨").length,"예약됨","#2563eb"],[vacant,"공실","#94a3b8"],[cleaning,"청소중","#d97706"],[highAlert,"긴급","#dc2626"],[totalMsg,"미읽","#7c3aed"],[`${(totalRev/10000).toFixed(0)}만`,"수익","#059669"],[`${occ}%`,"점유율","#2563eb"]].map(([v,l,c])=>(
            <div key={l} className="kpi-t"><div className="kv" style={{color:c}}>{v}</div><div className="kl">{l}</div></div>
          ))}
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center",marginLeft:"auto"}}>
          {bulkSel.length>0&&<div style={{fontSize:"11px",color:"#2563eb",fontFamily:"'DM Mono',monospace",border:"1px solid #bfdbfe",padding:"4px 10px",borderRadius:"20px",background:"#eff6ff",fontWeight:"600"}}>
            {bulkSel.length}개 선택 <span style={{cursor:"pointer",color:"#dc2626",marginLeft:"4px"}} onClick={()=>setBulkSel([])}>×</span>
          </div>}
          <div style={{position:"relative",cursor:"pointer",padding:"6px 12px",borderRadius:"20px",background:unack>0?"#fef2f2":"#f7f9fc",border:`1.5px solid ${unack>0?"#fecaca":"#e2e8f0"}`,display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:unack>0?"#dc2626":"#718096",fontWeight:"700"}} onClick={()=>setView(v=>v==="alerts"?"command":"alerts")}>
            🔔 {unack}
            {unack>0&&<div style={{position:"absolute",top:"-2px",right:"-2px",width:"8px",height:"8px",background:"#dc2626",borderRadius:"50%",animation:"pulse 1.5s infinite"}} />}
          </div>
          <button onClick={()=>setShowGcmd(true)} style={{padding:"7px 14px",borderRadius:"20px",background:"#2563eb",border:"none",color:"#fff",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>⚡ 전체 제어</button>
          <button onClick={onBack} className="back-btn">← 홈</button>
        </div>
      </div>

      {/* BODY */}
      <div className="cc-body">
        <div className="cc-sidenav">
          {[["command","◈","지휘"],["automation","⚙","자동화"],["revenue","💰","수익"],["cleaning","🧹","청소"]].map(([id,ic,tip])=>(
            <div key={id} className={`cc-nav-ic ${view===id?"active":""}`} onClick={()=>setView(id)} title={tip}>{ic}</div>
          ))}
        </div>

        <div className="cc-main">
          {view==="command" && <>
            {/* PROP PANEL */}
            <div className="prop-panel">
              <div className="toolbar">
                <input className="srch" placeholder="숙소 검색..." value={search} onChange={e=>setSearch(e.target.value)} />
                <div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                  {["전체","입실중","예약됨","공실","청소중","점검중"].map(f=>(
                    <button key={f} className={`fb ${filter===f?"act":""}`} onClick={()=>setFilter(f)}>{f}</button>
                  ))}
                </div>
                <select style={{background:"#f7f9fc",border:"1.5px solid #e2e8f0",color:"#4a5568",padding:"6px 10px",borderRadius:"20px",fontSize:"12px",fontFamily:"'DM Sans',sans-serif",outline:"none",cursor:"pointer",fontWeight:"600"}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                  <option value="priority">우선순위</option>
                  <option value="revenue">수익순</option>
                  <option value="rating">평점순</option>
                </select>
                <div style={{flex:1}} />
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#a0aec0",fontWeight:"500"}}>{filtered.length}개</span>
                <div style={{display:"flex",border:"1.5px solid #e2e8f0",borderRadius:"20px",overflow:"hidden"}}>
                  {[["grid","▦"],["list","≡"]].map(([m,ic])=>(
                    <button key={m} onClick={()=>setGMode(m)} style={{padding:"5px 10px",fontSize:"14px",cursor:"pointer",border:"none",background:gMode===m?"#2563eb":"transparent",color:gMode===m?"#fff":"#a0aec0",transition:"all 0.15s"}}>{ic}</button>
                  ))}
                </div>
              </div>
              {gMode==="grid" ? (
                <div className="prop-grid">{filtered.map(p=><PCard key={p.id} p={p}/>)}</div>
              ) : (
                <div className="prop-list">
                  <div className="lrow" style={{cursor:"default",background:"transparent",border:"none",borderBottom:"1px solid #e2e8f0",borderRadius:0,padding:"3px 12px"}}>
                    {[["14px",""],["8px",""],["flex-2","숙소"],["50px","상태"],["flex-1","게스트"],["auto","센서"],["40px","수익"],["30px",""]].map(([w,l],i)=>(
                      <div key={i} style={{[w.includes("flex")?"flex":"width"]:w.replace("flex-",""),fontSize:"10px",color:"#a0aec0",fontWeight:"600"}}>{l}</div>
                    ))}
                  </div>
                  {filtered.map(p=><LRow key={p.id} p={p}/>)}
                </div>
              )}
            </div>

            {/* DETAIL PANEL */}
            <div className="detail-panel">
              <DetailPanel/>
            </div>

            {/* ALERT FEED */}
            <div className="alert-panel">
              <div className="alert-hdr">
                <span style={{fontSize:"12px",fontWeight:"700",color:"#dc2626"}}>🔴 LIVE 알림</span>
                <button onClick={ackAll} style={{fontSize:"10px",color:"#718096",background:"none",border:"1.5px solid #e2e8f0",borderRadius:"20px",padding:"3px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:"600"}}>전체 확인</button>
              </div>
              <div className="alert-list-wrap">
                {alerts.map(a=>(
                  <div key={a.id} className={`aitem ${a.acked?"acked":""}`}
                    style={{borderLeftColor:{"error":"#dc2626","warn":"#d97706","info":"#2563eb"}[a.type],background:{"error":"#fef2f2","warn":"#fffbeb","info":"#eff6ff"}[a.type]}}>
                    <div style={{fontSize:"10px",fontWeight:"700",color:{"error":"#dc2626","warn":"#d97706","info":"#2563eb"}[a.type],marginBottom:"3px"}}>{a.prop}</div>
                    <div style={{fontSize:"12px",color:"#4a5568",fontWeight:"500"}}>{a.msg}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#a0aec0",marginTop:"3px"}}>{a.time}</div>
                    {!a.acked&&<button style={{fontSize:"10px",padding:"3px 9px",borderRadius:"20px",border:`1.5px solid ${{error:"#fecaca",warn:"#fde68a",info:"#bfdbfe"}[a.type]}`,cursor:"pointer",background:"#fff",color:{"error":"#dc2626","warn":"#d97706","info":"#2563eb"}[a.type],fontFamily:"'DM Sans',sans-serif",marginTop:"5px",fontWeight:"600"}} onClick={()=>ackAlert(a.id)}>확인</button>}
                  </div>
                ))}
              </div>
            </div>
          </>}

          {view==="automation" && renderAutomation()}
          {view==="revenue" && renderRevenue()}
          {view==="cleaning" && renderCleaning()}
        </div>
      </div>

      {/* GLOBAL CMD MODAL */}
      {showGcmd && (
        <div className="modal-bg" onClick={()=>setShowGcmd(false)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Nunito',sans-serif",fontSize:"18px",fontWeight:"800",color:"#1a202c",marginBottom:"6px"}}>⚡ 글로벌 지휘 센터</div>
            <div style={{fontSize:"12px",color:"#718096",marginBottom:"20px"}}>{bulkSel.length>0?`선택된 ${bulkSel.length}개 숙소에 적용`:`전체 ${props.length}개 숙소에 적용`}</div>
            <div className="d-label">일괄 IoT 제어</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"20px"}}>
              {[["🔒 전체 도어락 잠금",()=>bulkToggle("lockOpen",false),"#059669","#ecfdf5","#a7f3d0"],["🔓 전체 도어락 해제",()=>bulkToggle("lockOpen",true),"#dc2626","#fef2f2","#fecaca"],["❄️ 에어컨 전체 ON",()=>bulkToggle("acOn",true),"#2563eb","#eff6ff","#bfdbfe"],["❄️ 에어컨 전체 OFF",()=>bulkToggle("acOn",false),"#718096","#f7f9fc","#e2e8f0"],["💡 조명 전체 ON",()=>bulkToggle("lightsOn",true),"#d97706","#fffbeb","#fde68a"],["💡 조명 전체 OFF",()=>bulkToggle("lightsOn",false),"#718096","#f7f9fc","#e2e8f0"]].map(([l,fn,c,bg,bc])=>(
                <button key={l} className="cmd-btn" style={{color:c,borderColor:bc,background:bg}} onClick={()=>{fn();setShowGcmd(false);}}>
                  {l} <span style={{fontSize:"14px"}}>→</span>
                </button>
              ))}
            </div>
            <div className="d-label">전체 메시지 발송</div>
            <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
              <input className="msg-in" placeholder={`입실 중 ${occupied}개 숙소 게스트에게...`} value={globalMsg} onChange={e=>setGlobalMsg(e.target.value)} style={{flex:1}} />
              <button className="act-btn" style={{color:"#fff",borderColor:"#2563eb",background:"#2563eb",fontWeight:"700"}} onClick={()=>{if(globalMsg.trim()){Toast.show(`${occupied}개 숙소 게스트에게 발송: "${globalMsg}"`,"s");setGlobalMsg("");setShowGcmd(false);}}}>전송</button>
            </div>
            <div className="d-label" style={{marginTop:"16px"}}>긴급 액션</div>
            <div style={{display:"flex",gap:"8px"}}>
              <button className="cmd-btn" style={{color:"#dc2626",borderColor:"#fecaca",background:"#fef2f2",flex:1}} onClick={()=>{Toast.show("전체 긴급 알림 발송!","e");setShowGcmd(false);}}>🚨 전체 긴급 알림</button>
              <button className="cmd-btn" style={{color:"#d97706",borderColor:"#fde68a",background:"#fffbeb",flex:1}} onClick={()=>{Toast.show("청소팀 전체 소집!","s");setShowGcmd(false);}}>🧹 청소팀 전체 소집</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
