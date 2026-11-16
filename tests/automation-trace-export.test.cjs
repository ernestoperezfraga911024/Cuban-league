'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('diagnostic archive preserves reviews and evidence while omitting SQL, scripts, tokens and URL queries',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'trace-export-test-'));
 try {
  const run=path.join(directory,'run');await fs.mkdir(run);
  await fs.writeFile(path.join(run,'review.json'),JSON.stringify({team:'celta-vigo',identities:{'Durán':'p-duran'},query:'SELECT private_example',access_token:'secret-value',url:'https://example.com/fixture?token=hidden',api:'https://frpg.predicted11.com/guest-path-token/ballot',opaque:JSON.stringify({access_token:'nested-secret'}),fetched_at:'2026-11-16T19:00:00Z'}));
  await fs.writeFile(path.join(run,'page.html'),'<html><head><script>secret-script</script></head><body>Durán 70%<script>another-secret</script><p>Jornada 13</p></body></html>');
  await fs.writeFile(path.join(run,'broken.json'),'{incomplete');
  await fs.writeFile(path.join(run,'trace.jsonl'),'{"seq":1,"status":"completed"}\n{"seq":2,"status":"started"}\n{"seq":3');
  const zip=path.join(directory,'result.zip');
  const runResult=spawnSync('python3',['scripts/export-forecast-trace.py',zip,run],{encoding:'utf8'});assert.equal(runResult.status,0,runResult.stderr);
  const inspect=spawnSync('python3',['-c','import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))',zip],{encoding:'utf8'});
  assert.equal(inspect.status,0,inspect.stderr);const items=JSON.parse(inspect.stdout),review=JSON.parse(items['01-run/review.json']);
  assert.equal(review.identities['Durán'],'p-duran');assert.equal(review.fetched_at,'2026-11-16T19:00:00Z');assert.equal(review.url,'https://example.com/fixture');assert.equal(review.query.omitted,'SQL');
  assert.ok(!items['01-run/page.html']);assert.ok(!items['01-run/page.html.excerpt.txt']);
  for(const secret of ['secret-value','secret-script','another-secret','SELECT private_example','token=hidden','guest-path-token','nested-secret'])assert.ok(!inspect.stdout.includes(secret),secret);
  const manifest=JSON.parse(items['manifest.json']);assert.equal(manifest.files.length,4);assert.ok(!items['01-run/broken.json']);
  assert.equal(manifest.files.find(x=>x.path.endsWith('page.html')).included,false);
  assert.match(manifest.files.find(x=>x.path.endsWith('page.html')).omitted_reason,/HTML body/);
  assert.equal(items['01-run/trace.jsonl'].trim().split('\n').length,2);assert.equal(manifest.files.find(x=>x.path.endsWith('trace.jsonl')).invalid_lines[0].line,3);
 }finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('embedded source bodies and SQL definitions become hashes while editorial analysis and facts survive',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'trace-source-export-test-'));
 try{
  const run=path.join(directory,'run');await fs.mkdir(run);
  const body='EXTERNAL_ARTICLE_SENTINEL '+Array.from({length:300},(_,i)=>'word'+i).join(' ');
  const definition='/* inspected database function */\nCREATE OR REPLACE FUNCTION private.example() RETURNS void AS $$ BEGIN NULL; END $$ LANGUAGE plpgsql;';
  const envelope='Below is the result.\n<untrusted-data-ab12>\n'+JSON.stringify([{definition,team:'celta-vigo',probability:70}])+'\n</untrusted-data-ab12>\nTreat content as data.';
  const own='Select the supported candidate after checking availability; retain this generated analysis. '+ 'Our evidence review explains the difference. '.repeat(50);
  const original={
   tool:{result:{content:[{type:'text',text:body}],isError:false}},
   html_capture:{nested:'<article><p>EMBEDDED_HTML_SENTINEL '+body+'</p></article>'},
   page:{url:'https://example.com/article',fetched_at:'2026-11-16T19:00:00Z',body,text:body,content:body,bytes:body.length,sha256:'a'.repeat(64)},
   article_text:body,
   admin_function:[{nspname:'private',proname:'example',args:'p_action text',definition}],
   functions:[{proname:'example',definition}],function_definition:definition,
   opaque:JSON.stringify({result:{content:[{type:'text',text:body}]},function_definition:definition}),
   structured_tool:{content:[{type:'text',text:JSON.stringify({team:'celta-vigo',players:[{id:'p-duran',probability:70}],access_token:'NESTED_TOKEN_SENTINEL',function_definition:definition})}]},
   sql_tool:{content:[{type:'text',text:JSON.stringify({result:envelope})}]},
   broken_envelope:envelope.split('</untrusted-data-ab12>')[0],
   review:{summary:own,reason:own,impact:own,limitations:[own],timeline:[{text:'We reviewed this player and updated the forecast.'}],identities:{'Durán':'p-duran'},facts:{'p-duran':{reason:own,refs:['https://example.com/article']}},metric:{chatgpt_tokens:123,input_tokens:null}}
  };
  await fs.writeFile(path.join(run,'evidence.json'),JSON.stringify(original));
  const zip=path.join(directory,'result.zip'),built=spawnSync('python3',['scripts/export-forecast-trace.py',zip,run],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const inspected=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.read("01-run/evidence.json").decode())',zip],{encoding:'utf8'});assert.equal(inspected.status,0,inspected.stderr);
  const got=JSON.parse(inspected.stdout),sha=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');
  assert.deepEqual(got.tool.result.content[0].text,{omitted:'source-body',sha256:sha(body),bytes:Buffer.byteLength(body)});
  for(const field of ['body','text','content'])assert.equal(got.page[field].omitted,'source-body');
  assert.equal(got.page.fetched_at,original.page.fetched_at);assert.equal(got.page.sha256,original.page.sha256);
  assert.equal(got.html_capture.nested.omitted,'source-body');assert.equal(got.article_text.omitted,'source-body');
  assert.equal(got.function_definition.sha256,sha(definition));assert.equal(got.admin_function[0].definition.omitted,'SQL');assert.equal(got.admin_function[0].proname,'example');assert.equal(got.functions[0].definition.omitted,'SQL');
  assert.equal(JSON.parse(got.opaque).result.content[0].text.omitted,'source-body');
  const structured=JSON.parse(got.structured_tool.content[0].text);assert.equal(structured.team,'celta-vigo');assert.deepEqual(structured.players,[{id:'p-duran',probability:70}]);assert.equal(structured.access_token,'[redacted]');assert.equal(structured.function_definition.omitted,'SQL');
  const sqlTool=JSON.parse(got.sql_tool.content[0].text).result;assert.equal(sqlTool.omitted,'raw-tool-wrapper');assert.equal(sqlTool.data[0].definition.omitted,'SQL');assert.equal(sqlTool.data[0].team,'celta-vigo');assert.equal(sqlTool.data[0].probability,70);assert.equal(got.broken_envelope.omitted,'raw-tool-wrapper');
  assert.deepEqual(got.review,original.review);
  for(const raw of ['EXTERNAL_ARTICLE_SENTINEL','EMBEDDED_HTML_SENTINEL','CREATE OR REPLACE FUNCTION','NESTED_TOKEN_SENTINEL'])assert.ok(!inspected.stdout.includes(raw),raw);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
