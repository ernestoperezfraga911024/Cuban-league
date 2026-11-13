/* Self-declared profiles only; reporting is admin-only. No fingerprinting or credentials. */
(()=>{
  'use strict';
  const SESSION='cuban-league-activity-session-v1',VISITOR='cuban-league-visitor-id';
  const OWNER='cuban-league-owner-browser',IDLE=30*60*1000;
  const SECTIONS=new Set(['home','current','matchdays','players','history','cup','champions','rules','cards','second-division','forecasts','news']);
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let started=false,profile=0,visitor=null,session=null,lastTouch=0,allowed=new Set();
  const sent=new Map();
  const read=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{/* In-memory fallback. */}};
  function uuid(){
    if(window.crypto?.randomUUID)return window.crypto.randomUUID();
    if(!window.crypto?.getRandomValues)return null;
    const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function touch(){
    const now=Date.now();let saved;
    try{saved=JSON.parse(read(SESSION)||'null');}catch{}
    if(saved&&UUID.test(saved.id)&&saved.visitor===visitor&&Number.isFinite(saved.last)&&saved.last<=now&&now-saved.last<IDLE)session=saved;
    if(!session||now-session.last>=IDLE||session.last>now)session={id:uuid(),visitor,last:now};
    if(!session.id)return null;
    session.last=now;write(SESSION,JSON.stringify(session));lastTouch=now;
    return session.id;
  }
  async function record(){
    if(!started||document.visibilityState==='hidden'||read(OWNER)==='1')return false;
    const section=document.body.dataset.section||'home';
    if(!SECTIONS.has(section))return false;
    const config=window.CUBAN_LEAGUE_SUPABASE;
    if(!config?.url||!config?.publishableKey)return false;
    const id=touch();if(!id)return false;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const key=`${id}:${day}:${profile}:${section}`,now=Date.now();
    if(now-(sent.get(key)||0)<60000)return false;
    sent.set(key,now);
    const payload={p_visitor_id:visitor,p_session_id:id,p_section:section,p_profile_id:profile};
    try{
      const response=await fetch(`${config.url.replace(/\/$/,'')}/rest/v1/rpc/track_site_activity`,{
        method:'POST',cache:'no-store',keepalive:true,
        headers:{apikey:config.publishableKey,Authorization:`Bearer ${config.publishableKey}`,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const ok=response.ok&&await response.json()===true;
      if(!ok)sent.delete(key);
      return ok;
    }catch{sent.delete(key);return false;}
  }
  function identify(choice){
    const next=choice?.kind==='participant'&&allowed.has(choice.participantId)?choice.participantId:0;
    if(next===profile)return;
    profile=next;record();
  }
  function start(people,choice){
    if(started)return;
    allowed=new Set(people.filter(p=>p.active!==false&&Number.isInteger(p.id)&&p.id>=1&&p.id<=20).map(p=>p.id));
    visitor=read(VISITOR);if(!UUID.test(visitor||'')){visitor=uuid();if(!visitor)return;write(VISITOR,visitor);}
    profile=choice?.kind==='participant'&&allowed.has(choice.participantId)?choice.participantId:0;
    started=true;
    new MutationObserver(()=>record()).observe(document.body,{attributes:true,attributeFilter:['data-section']});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')record();});
    window.addEventListener('pageshow',()=>record());
    window.addEventListener('online',()=>record());
    const active=()=>{
      if(document.visibilityState==='hidden'||read(OWNER)==='1'||Date.now()-lastTouch<60000)return;
      const old=session?.id;touch();if(old!==session?.id)record();
    };
    document.addEventListener('pointerdown',active,{passive:true});
    document.addEventListener('keydown',active,{passive:true});
    record();
  }
  window.CubanLeagueAnalytics=Object.freeze({start,identify});
})();
