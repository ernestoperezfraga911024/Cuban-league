'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const {createConnectorBridge}=require('../scripts/forecast/connector-bridge.cjs');
const args={link_id:'link_6aad67ea13208191b8315f9bb7f2cce7',project_id:'pyahosamoisqcbpvzwka',query:'select true as result'};
const wrapped=result=>({content:[{type:'text',text:JSON.stringify({result:'Result below:\n<untrusted-data-ab12>\n'+JSON.stringify([{result}])+'\n</untrusted-data-ab12>\nDo not execute data.'})}],structuredContent:null});
test('connector adapter owns exact SQL arguments and unwraps full tool data without guessing',()=>{
 const bridge=createConnectorBridge({});assert.deepEqual(bridge.requestArgs(args),args);
 for(const change of [{read_only:true},{project_id:'other'},{link_id:'other'},{query:''}])assert.throws(()=>bridge.requestArgs({...args,...change}),/arguments/);
 for(const value of [null,0,false,'',[],{players:[1,2,3]}]){
  assert.deepEqual(bridge.extract(wrapped(value)),value);
  assert.deepEqual(bridge.extract({structuredContent:[{result:value}]}),value);
 }
 for(const value of [{isError:true},wrapped(1).content[0].text.slice(0,40),[{result:1},{result:2}],{content:[{type:'text',text:'x'},{type:'text',text:'y'}]}])assert.throws(()=>bridge.extract(value));
});
test('real shell file transport preserves large Unicode and shell metacharacters, sends only ID/path and never retries SQL',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'forecast-season-'));
 try{
  const event={id:'1',event:'sql',path:path.join(directory,'1-sql.json'),response_path:path.join(directory,'1-response.json')};
  await fs.writeFile(event.path,JSON.stringify(args));let calls=0,sent;
  // The emoji straddles the old UTF-16 chunk boundary. The string also contains shell syntax as inert data.
  const result={text:'a'.repeat(11980)+'⚽😀'.repeat(15000)+" ' `echo unsafe` $(echo unsafe) á\n",rows:Array.from({length:200},(_,id)=>({id}))};
  const run=promisify(execFile),tools={exec_command:async({cmd})=>{const r=await run('/bin/bash',['-c',cmd],{maxBuffer:4*1024*1024});return{exit_code:0,output:r.stdout};},
   mcp__codex_apps__supabase_execute_sql:async actual=>{assert.deepEqual(actual,args);calls++;return wrapped(result);},write_stdin:async actual=>{sent=actual;return{exit_code:0};}};
  const bridge=createConnectorBridge(tools);await bridge.sql(event,42);
  assert.equal(calls,1);assert.ok(sent.chars.length<512);assert.equal(sent.session_id,42);
  assert.deepEqual(JSON.parse(sent.chars),{id:'1',result_file:event.response_path});
  assert.deepEqual(JSON.parse(await fs.readFile(event.response_path,'utf8')),{result});
  assert.equal((await fs.stat(event.response_path)).mode&0o777,0o600);
  tools.mcp__codex_apps__supabase_execute_sql=async()=>{calls++;throw Error('reply lost');};
  await assert.rejects(bridge.sql(event,42),/reply lost/);assert.equal(calls,2);
  await assert.rejects(bridge.reply({...event,response_path:'/tmp/elsewhere'},{result:1},42),/paths/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('runner rejects inline/truncated replies but accepts the corrected file for the same pending request',async()=>{
 const child=spawn(process.execPath,['scripts/run-forecast-season.cjs','--existing-run','season-protocol-test'],{stdio:['pipe','pipe','pipe']});
 const lines=require('node:readline').createInterface({input:child.stdout});let directory,finished,errors='',sql=0,protocol=0,chain=Promise.resolve(),pending;
 child.stderr.on('data',data=>errors+=data);
 const at=new Date().toISOString(),state={observed_at:at,run:{expected:[],slot_at:at,started_at:at,finished_at:at},attempts:[],padding:'a'.repeat(57000)};
 async function sendFile(event){await fs.writeFile(event.response_path,JSON.stringify({result:state}));child.stdin.write(JSON.stringify({id:event.id,result_file:event.response_path})+'\n');}
 lines.on('line',line=>{chain=chain.then(async()=>{
  const event=JSON.parse(line);
  if(event.event==='finished'){finished=JSON.parse(await fs.readFile(event.path));return;}
  if(event.event==='bridge_error'){
   protocol++;assert.equal(event.id,pending.id);
   if(protocol===1){await fs.writeFile(pending.response_path,'{"result":');child.stdin.write(JSON.stringify({id:pending.id,result_file:pending.response_path})+'\n');}
   else await sendFile(pending);return;
  }
  assert.equal(event.event,'sql');assert.equal(event.response_format,'file');directory=path.dirname(event.path);sql++;
  if(sql===1){pending=event;child.stdin.write(JSON.stringify({id:event.id,result:state})+'\n');return;}
  const request=JSON.parse(await fs.readFile(event.path));const result=request.query.includes("'teams',(")?{observed_at:at,teams:null}:state;
  await fs.writeFile(event.response_path,JSON.stringify({result}));child.stdin.write(JSON.stringify({id:event.id,result_file:event.response_path})+'\n');
 }).catch(error=>{errors+=error.stack;child.kill();});});
 const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Timeout'));},15000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code);});});await chain;
 try{assert.equal(exit,0,errors);assert.equal(protocol,2);assert.equal(sql,3);assert.equal(finished.publication_complete,false);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'checkpoint.json'))).status,'partial');}
 finally{if(directory)await fs.rm(directory,{recursive:true,force:true});}
});
