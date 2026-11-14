'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {responseValue}=require('../scripts/forecast/bridge-response.cjs');
const {comuniateAlternatives}=require('../scripts/forecast/collect-team.cjs');
const {compile}=require('../scripts/forecast/editorial-producer.cjs'),{example}=require('./fixtures/forecast-producer.cjs');
test('large bridge responses preserve full UTF-8 JSON and reject truncated, unexpected and symlink files',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-test-')),id='12',file=path.join(directory,id+'-response.json');
 try{const expected={result:{players:Array.from({length:200},(_,i)=>({id:i,reason:'Revisión íntegra: '+ 'á'.repeat(1000)}))}};await fs.writeFile(file,JSON.stringify(expected));
 assert.deepEqual(await responseValue({id,result_file:file},{directory,id}),expected);
 for(const message of [{id,result_file:'/etc/passwd'},{id,result_file:file,result:null}])await assert.rejects(responseValue(message,{directory,id}),/Unexpected response file/);
 await fs.writeFile(file,'{"result":'+JSON.stringify(expected).slice(0,4079));await assert.rejects(responseValue({id,result_file:file},{directory,id}),SyntaxError);
 await fs.unlink(file);await fs.symlink(path.join(directory,'other.json'),file);await assert.rejects(responseValue({id,result_file:file},{directory,id}),/Invalid response file/);
 assert.deepEqual(await responseValue({id,result:0},{directory,id}),{id,result:0});
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('Comuniate alternative text, explicit zero and absent percentages stay distinct',()=>{
 const html='<div class="cuerpo_campo"><div class="jugador_campo"><div class="nombre_jugador">Starter 90%<div class="alternativo">Camavinga</div><div class="alternativo">Robert Navarro 0%</div></div></div></div>';
 assert.deepEqual(comuniateAlternatives(html),[{name:'Camavinga',probability:null},{name:'Robert Navarro',probability:0}]);
});
test('captured Comuniate alternative cannot silently become not_listed or gain an invented percentage',()=>{
 for(const mutate of [x=>x.review.sources.comuniate.alternatives=[],x=>x.review.sources.comuniate.alternatives[0].probability=50,x=>delete x.packet.comuniate_alternatives]){const x=example();mutate(x);assert.throws(()=>compile(x.packet,x.review,x.roster,x.window),/alternativa/);}
 const x=example(),out=compile(x.packet,x.review,x.roster,x.window);assert.equal(out.payload.sources[2].player_observations[11].prediction,'alternative');assert.equal(out.payload.sources[2].player_observations[11].probability,null);
});
test('modular contracts preserve every original authorized section byte for byte',async()=>{
 const dir=path.join(__dirname,'../docs/automation'),original=await fs.readFile(path.join(dir,'previous-prompt-20261114.txt'),'utf8'),map=JSON.parse(await fs.readFile(path.join(dir,'contract-map.json')));
 assert.equal(createHash('sha256').update(original).digest('hex'),map.archived_prompt_sha256);
 assert.equal(map.sections[0].start,0);assert.equal(map.sections.at(-1).end,original.length);
 map.sections.slice(1).forEach((s,i)=>assert.equal(s.start,map.sections[i].end));
 const ids=Object.values(map.groups).flat();assert.equal(new Set(ids).size,map.sections.length);assert.equal(ids.length,map.sections.length);
 for(const [name,keys]of Object.entries(map.groups)){const expected=keys.map(k=>{const s=map.sections.find(s=>s.id===k);return original.slice(s.start,s.end);}).join('');assert.equal(await fs.readFile(path.join(dir,'contracts',name+'.md'),'utf8'),expected);}
 const registry=JSON.parse(await fs.readFile(path.join(dir,'incidents.json')));for(const incident of registry.incidents)for(const file of incident.tests)await fs.access(path.join(__dirname,'..',file));
});
test('runner consumes large file responses end to end with short stdin messages',async()=>{
 const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['scripts/run-forecast-season.cjs','--existing-run','season-bridge-test'],{stdio:['pipe','pipe','pipe']});
 const readline=require('node:readline'),lines=readline.createInterface({input:child.stdout});
 let errors='',directory,finished,requests=0,chain=Promise.resolve();child.stderr.on('data',data=>errors+=data);
 const at=new Date().toISOString(),state={observed_at:at,run:{expected:[],slot_at:at,started_at:at,finished_at:at},attempts:[],padding:'Revisión íntegra '.repeat(10000)};
 lines.on('line',line=>{chain=chain.then(async()=>{
  const event=JSON.parse(line);directory=path.dirname(event.path);
  if(event.event==='finished'){finished=JSON.parse(await fs.readFile(event.path,'utf8'));return;}
  assert.equal(event.event,'sql');requests++;const request=JSON.parse(await fs.readFile(event.path,'utf8'));
  const result=request.query.includes("'teams',(")?{observed_at:at,teams:null}:state;
  await fs.writeFile(event.response_path,JSON.stringify({result}));const message=JSON.stringify({id:event.id,result_file:event.response_path});assert.ok(message.length<512);child.stdin.write(message+'\n');
 }).catch(error=>{errors+=error.stack;child.kill();});});
 const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Bridge test timeout'));},15000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code);});});
 await chain;try{assert.equal(exit,0,errors);assert.equal(finished.no_eligible_teams,true);assert.equal(finished.publication_complete,false);assert.equal(requests,3);}finally{if(directory)await fs.rm(directory,{recursive:true,force:true});}
});
