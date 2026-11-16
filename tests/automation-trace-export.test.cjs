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
  assert.match(items['01-run/page.html.visible.txt'],/Durán 70%/);assert.match(items['01-run/page.html.visible.txt'],/Jornada 13/);
  for(const secret of ['secret-value','secret-script','another-secret','SELECT private_example','token=hidden','guest-path-token','nested-secret'])assert.ok(!inspect.stdout.includes(secret),secret);
  const manifest=JSON.parse(items['manifest.json']);assert.equal(manifest.files.length,4);assert.ok(!items['01-run/broken.json']);
  assert.equal(items['01-run/trace.jsonl'].trim().split('\n').length,2);assert.equal(manifest.files.find(x=>x.path.endsWith('trace.jsonl')).invalid_lines[0].line,3);
 }finally {await fs.rm(directory,{recursive:true,force:true});}
});
