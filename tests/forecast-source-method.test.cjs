const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const core=require("../forecast-review-core.js"),method=require("../forecast-source-method.js"),publish=require("../forecast-publish-core.js");
const {draft,publication}=require("./fixtures/forecast-publication.cjs");
const refs=publication().sources.map(s=>s.url),item=value=>({value,reason:"Dato sintético revisado.",refs});
function evidence(){return {method:"editorial-v2",confirmed_out:false,sources:publication().sources.map(s=>({id:s.id,prediction:"starter",probability:90,reason:"Observación sintética de titularidad.",refs:[s.url]})),role:item(90),availability:item("clear"),rotation:item("low"),horizon:item("distant"),context:{points:0,reason:"Sin ajuste adicional.",refs}};}
function weighted(){const d=draft();d.payload.method_version="editorial-v2";for(const p of d.payload.proposal.players){p.assessment=evidence();p.probability=88;p.alternative=null;}return d;}
test("v2 gives the three sources 80% and role 20%; distant horizon does not collapse a strong starter",()=>{
 const e=evidence();assert.equal(method.evaluate(e).probability,88);e.sources.forEach(s=>s.probability=80);assert.equal(method.evaluate(e).probability,80);
 e.role.value=80;assert.equal(method.evaluate(e).probability,78);assert.equal(core.evaluate(e).probability,78);
 e.availability.value="concern";assert.equal(method.evaluate(e).probability,70);e.horizon.value="near";assert.equal(method.evaluate(e).probability,72);
});
test("categorical editorial signals stay distinct from observed percentages; absence is not a guaranteed zero",()=>{
 const e=evidence();e.sources[0].probability=null;const r=method.evaluate(e);assert.equal(r.probability,88);assert.match(r.trace[0].reason,/no publica un porcentaje/);
 e.sources[0].prediction="not_listed";assert.equal(method.evaluate(e).probability,71);e.sources[0].probability=0;assert.equal(method.evaluate(e).probability,64);
});
test("v2 rejects missing, duplicated, foreign or incomplete evidence and confirmed absences",()=>{
 for(const mutate of [e=>e.sources.pop(),e=>e.sources[1].id=e.sources[0].id,e=>e.sources[0].id="unknown",e=>e.sources[0].refs=["https://evil.test/"],e=>delete e.sources[0].probability,e=>e.sources[0].probability=50.1,e=>e.role.value=101,e=>e.context.points=11,e=>e.horizon.value="unknown",e=>e.confirmed_out=true,e=>e.rotation.refs=[]]){const e=evidence();mutate(e);assert.throws(()=>method.evaluate(e));}
});
test("both versions remain readable; new method does not rewrite historical probabilities",()=>{
 const old=draft(),before=JSON.stringify(old);assert.equal(core.evaluate(old.payload.proposal.players[8].assessment).probability,75);
 const d=weighted();assert.equal(core.applyMethod(d.payload).method_version,"editorial-v2");assert.equal(publish.fromDraft(d.payload).length,11);assert.match(core.assessment(d.payload.proposal.players[0]).label,/fuentes 80%/);assert.equal(JSON.stringify(old),before);
 d.payload.proposal.players[0].assessment=old.payload.proposal.players[0].assessment;assert.throws(()=>core.applyMethod(d.payload),/mezclados/);
 const p=publication();p.players.forEach(x=>x.method="editorial-v2");assert.equal(publish.validate(p),p);
});
test("v2 loads from the visible editor entry, saves privately and keeps publication confirmation",async()=>{
 const {JSDOM}=require("jsdom"),read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8"),dom=new JSDOM(read("admin.html"),{url:"https://preview.test",runScripts:"outside-only"}),w=dom.window;
 const tick=()=>new Promise(r=>setTimeout(r,0));try{
 w.confirm=()=>true;w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read("catalog/players.json"))});
 for(const file of ["player-catalog.js","forecast-source-method.js","forecast-review-core.js","forecast-publish-core.js","forecast-pitch.js","forecast-editor.js","forecast-review.js"])w.eval(read(file));
 const source={...weighted(),created_at:"2026-11-11T19:00:00Z",status:"draft"},commands=[];
 const p=publication();p.players.forEach(x=>{x.method="editorial-v2";x.probability=88;x.alternative=null;});let version=0;
 w.CubanForecastReview.init({client:{rpc:async(name,args)=>{
 if(name==="command_forecast_publication"){commands.push(args);version++;return {data:{action:"save",version,revision_id:2,current_revision:1}};}
 if(name==="get_forecast_publication")return {data:args.p_revision_id?{version,revision:{id:2,source_key:source.run_key,payload:p}}:{version,current_revision:1,revisions:version?[{id:2,ever_published:false}]:[]}};
 return {data:args.p_run_key?source:[source]};
 }}});w.CubanForecastReview.authorize();const $=id=>w.document.getElementById(id);$("forecastTool").open=true;$("forecastTool").dispatchEvent(new w.Event("toggle"));await tick();await tick();$("forecastManage").click();await tick();await tick();assert.equal($("forecastSaveRevision").disabled,false);
 $("forecastSaveRevision").click();await tick();await tick();assert.equal(commands.length,1);assert.equal(commands[0].p_action,"save");assert.equal(commands[0].p_players[8].probability,88);assert.equal($("forecastPreview").querySelectorAll(".fp-player").length,11);assert.equal($("forecastPublish").disabled,true);
 }finally{dom.window.close();}
});
module.exports={evidence,weighted};
