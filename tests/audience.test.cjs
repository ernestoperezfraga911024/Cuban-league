const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const PEOPLE=[{id:1,name:'Ernesto'},{id:8,name:'Yovany R9'},{id:21,name:'Retirado',active:false}];
const choice=id=>({kind:'participant',participantId:id,version:1});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({storage={},blocked=false,owner=false}={}){
 const dom=new JSDOM('<body data-section="home"></body>',{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[];let now=Date.parse('2026-11-13T15:00:00Z');
 w.Date.now=()=>now;w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 if(owner)w.localStorage.setItem('cuban-league-owner-browser','1');
 if(blocked)for(const method of ['getItem','setItem'])w.Storage.prototype[method]=()=>{throw Error('Denied');};
 w.fetch=async(url,options)=>{calls.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>true};};
 w.eval(read('site-analytics.js'));
 const start=c=>w.CubanLeagueAnalytics.start(PEOPLE,c);
 const route=async section=>{w.document.body.dataset.section=section;await flush();};
 const advance=ms=>{now+=ms;};
 return {dom,w,calls,start,route,advance};
}
test('records real sections and selected IDs without names, queries or credentials; no repeated section within a minute',async()=>{
 const t=setup();try{
 t.start(choice(1));await flush();assert.equal(t.calls.length,1);assert.equal(t.calls[0].payload.p_profile_id,1);
 await t.route('news');await t.route('news');await t.route('home');await t.route('admin');
 assert.equal(t.calls.length,2);assert.equal(t.calls[1].payload.p_section,'news');
 assert.deepEqual(Object.keys(t.calls[0].payload).sort(),['p_profile_id','p_section','p_session_id','p_visitor_id']);
 t.w.CubanLeagueAnalytics.identify(choice(8));await t.route('forecasts');
 assert.equal(t.calls.at(-1).payload.p_profile_id,8);assert.equal(t.calls[0].payload.p_profile_id,1);
 t.w.CubanLeagueAnalytics.identify(null);await flush();assert.equal(t.calls.at(-1).payload.p_profile_id,0);
 }finally{t.dom.window.close();}
});
test('reload and another tab reuse the same browser visit; inactivity starts a new visit',async()=>{
 const t=setup();let next;try{
 t.start(choice(1));await flush();const first=t.calls[0].payload;
 const storage=Object.fromEntries(Object.entries(t.w.localStorage));next=setup({storage});next.start(choice(1));await flush();
 assert.equal(next.calls[0].payload.p_session_id,first.p_session_id);assert.equal(next.calls[0].payload.p_visitor_id,first.p_visitor_id);
 t.advance(31*60000);await t.route('news');assert.notEqual(t.calls.at(-1).payload.p_session_id,first.p_session_id);
 }finally{t.dom.window.close();next?.dom.window.close();}
});
test('owner is excluded, guests and invalid/retired profiles stay anonymous, blocked storage is stable within the page',async()=>{
 const owner=setup({owner:true}),guest=setup({blocked:true});try{
 owner.start(choice(1));await owner.route('news');assert.equal(owner.calls.length,0);
 guest.start(choice(21));await flush();await guest.route('news');assert.equal(guest.calls[0].payload.p_profile_id,0);
 assert.equal(guest.calls[0].payload.p_session_id,guest.calls[1].payload.p_session_id);
 guest.w.CubanLeagueAnalytics.identify(choice(999));await guest.route('forecasts');assert.equal(guest.calls.at(-1).payload.p_profile_id,0);
 }finally{owner.dom.window.close();guest.dom.window.close();}
});
test('failed requests can retry the same identity and session without blocking navigation',async()=>{
 const t=setup();try{
 t.w.fetch=async()=>{throw Error('Offline');};t.start(choice(1));await flush();
 t.w.fetch=async(url,options)=>{t.calls.push(JSON.parse(options.body));return {ok:true,json:async()=>true};};
 t.w.dispatchEvent(new t.w.Event('online'));await flush();assert.equal(t.calls.length,1);
 await t.route('news');assert.equal(t.calls.length,2);
 }finally{t.dom.window.close();}
});
test('private admin renders canonical names safely, period errors do not expose stale numbers',async()=>{
 const dom=new JSDOM(read('admin.html'),{url:'https://example.test/admin.html',runScripts:'outside-only'}),w=dom.window;
 try{
 w.eval(read('audience-admin.js'));let fail=false;
 const client={rpc:async(name,{p_days})=>{assert.equal(name,'get_site_audience');return fail?{error:{message:'No access'}}:{data:{days:p_days,generatedAt:'2026-11-13T15:00:00Z',identifiedProfiles:1,identifiedVisits:3,unidentifiedVisits:2,profiles:[{id:1,visits:3,activeDays:1,lastSeen:'2026-11-13T15:00:00Z'}],sections:[{id:'news',visits:4},{id:'forecasts',visits:2}]}};}};
 await w.CubanAudienceAdmin.load({client,participants:[{id:1,name:'<script>fake</script>'}]});
 assert.equal(w.document.querySelector('#audienceProfilesRows th').textContent,'<script>fake</script>');
 assert.equal(w.document.querySelector('#audienceProfilesRows script'),null);
 assert.equal(w.document.getElementById('audienceSections').children.length,2);
 w.document.querySelector('[data-days="7"]').click();await flush();assert.match(w.document.getElementById('audienceRange').textContent,/7 días/);
 fail=true;w.document.querySelector('[data-days="30"]').click();await flush();assert.equal(w.document.getElementById('audienceData').hidden,true);assert.equal(w.document.getElementById('audienceError').hidden,false);
 }finally{dom.window.close();}
});
