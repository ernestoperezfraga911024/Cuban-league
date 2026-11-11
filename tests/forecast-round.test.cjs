const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const core=require('../forecast-round-core.js'),{publication,rows}=require('./fixtures/forecast-round.cjs'),old=require('./fixtures/forecast-publication.cjs'),root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
test('J13 has ten paired fixtures, twenty unique catalog teams and valid formation slots',()=>{
 assert.equal(core.config.teams.length,20);assert.equal(core.config.fixtures.length,10);assert.equal(new Set(core.config.fixtures.flatMap(f=>[f.home,f.away])).size,20);
 for(const t of core.config.teams)for(const f of core.formations){const p=core.validate(publication(t.id,f));assert.equal(new Set(core.lines(f).flat()).size,11);assert.equal(p.players.filter(x=>x.position==='GK').length,1);}
});
test('foreign fixture, bad sources, duplicate players and missing alternatives never render',()=>{
 for(const mutate of [p=>p.opponent='wrong',p=>p.kickoff_at='2026-11-23T20:00:00Z',p=>p.players[0].id=p.players[1].id,p=>p.players[2].alternative=null,p=>p.players[2].alternative=p.players[1],p=>p.sources[0].url='https://www.futbolfantasy.com.evil.test/x',p=>p.evidence_at='2026-11-10T20:00:00Z',p=>p.players[0].position='FW',p=>p.players[0].probability=80.1]){const p=publication('athletic-club');mutate(p);assert.throws(()=>core.validate(p));}
});
test('Madrid withdrawal is authoritative; a round row can never resurrect an old Madrid snapshot',()=>{
 const r={team:'real-madrid',published_at:'2026-11-12T20:00:00Z',payload:publication('real-madrid')};assert.equal(core.choose('real-madrid',[r],[]),null);
 const pilot={payload:old.publication(),published_at:'2026-11-11T19:00:00Z'};assert.equal(core.choose('real-madrid',[r],[pilot]),pilot);
});
test('twenty selectors load lazily, reuse two public reads, handle failure and clear withdrawn snapshots',async()=>{
 const dom=new JSDOM(read('index.html'),{url:'https://preview.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let fail=false,withdraw=false;const calls=[];
 try{
 w.CUBAN_LEAGUE_SUPABASE={url:'https://example.supabase.co',publishableKey:'test'};w.CubanLeaguePlayerCatalog={load:async()=>({playersById:new Map()})};
 w.fetch=async u=>{calls.push(String(u));if(String(u).includes('forecast_round_public'))return {ok:!fail,json:async()=>withdraw?[]:rows()};return {ok:true,json:async()=>[{payload:old.publication(),published_at:'2026-11-11T19:00:00Z'}]};};
 for(const f of ['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js','forecast-public.js'])w.eval(read(f));
 assert.equal(calls.length,0);assert.equal(w.document.querySelectorAll('[data-forecast-team]').length,20);
 w.document.body.dataset.section='forecasts';await tick();await tick();assert.equal(calls.length,2);
 for(const b of w.document.querySelectorAll('[data-forecast-team]')){b.click();assert.equal(w.document.querySelectorAll('#forecasts .fp-player').length,11,b.dataset.forecastTeam);assert.equal(w.document.querySelectorAll('[data-forecast-team][aria-pressed=true]').length,1);}
 assert.equal(calls.length,2);fail=true;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('#forecasts .fp-player').length,0);
 w.document.getElementById('forecastTeamMadrid').click();assert.equal(w.document.querySelectorAll('#forecasts .fp-player').length,11);
 fail=false;withdraw=true;w.document.querySelector('[data-forecast-team="espanyol"]').click();w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('#forecasts .fp-player').length,0);
 }finally{dom.window.close();}
});
