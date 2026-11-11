// Local browser integration with synthetic publication responses; never sends live writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {publication,draft}=require('../tests/fixtures/forecast-publication.cjs'),root=path.join(__dirname,'..');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:1000}});let publicReads=0,withdrawn=false;
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname.endsWith('.supabase.co')){
    if(u.pathname==='/rest/v1/forecast_public'){publicReads++;return route.fulfill({json:withdrawn?[]:[{revision_id:1,published_at:'2026-11-11T17:00:00Z',payload:publication()}]});}
    return route.fulfill({json:[]});
   }
   if(u.hostname!=='preview.test')return route.abort();
   const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   if(u.pathname==='/admin.js')return route.fulfill({contentType:'text/javascript',body:''});
   const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
   return route.fulfill({body:fs.readFileSync(file),contentType:types[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('https://preview.test/index.html');await page.waitForFunction(()=>document.getElementById('currentRows')?.children.length>0||document.querySelector('.player-card'));
  assert.equal(publicReads,0);
  await page.locator('[data-editorial-menu]:visible').last().click();await page.locator('#editorialMenu [data-go="forecasts"]').click();
  await page.waitForSelector('#forecasts .fp-player');assert.equal(await page.locator('#forecasts .fp-player').count(),11);assert.equal(publicReads,1);await page.locator('#forecastTeamMadrid').click();assert.equal(publicReads,1);assert.equal(await page.locator('#forecastTeamMadrid img').evaluate(x=>x.complete&&x.naturalWidth>0),true);
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:1000});
   const measure=await page.locator('#forecasts').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,photos:[...e.querySelectorAll('.fp-player img')].filter(x=>x.complete&&x.naturalWidth>0).length,fieldHeight:e.querySelector('.fp-field').getBoundingClientRect().height,cardWidth:e.querySelector('.fp-card').getBoundingClientRect().width,buttonHeight:e.querySelector('.fp-player').getBoundingClientRect().height,gap:getComputedStyle(e.querySelector('.fp-player')).gap,minHeight:getComputedStyle(e.querySelector('.fp-field')).minHeight}));
   assert.ok(measure.scroll<=measure.client+1,JSON.stringify({width,...measure}));assert.ok(measure.fieldHeight<600,JSON.stringify({width,...measure}));assert.ok(measure.cardWidth<=880);console.log(JSON.stringify({width,...measure}));
   await page.locator('#forecasts').screenshot({path:path.join(root,'test-results','forecast-public-'+width+'.png')});
  }
  await page.locator('#forecasts .fp-player[aria-label^="Y. Diomande"]').click();await page.waitForFunction(()=>document.querySelector('#forecasts .fp-detail h3')?.textContent==='Y. Diomande');
  assert.equal(await page.locator('#forecasts .fp-player img').evaluateAll(images=>images.filter(x=>x.complete&&x.naturalWidth>0).length),11);
  withdrawn=true;await page.locator('#forecastPublicReload').click();await page.waitForFunction(()=>document.getElementById('forecastPublicStatus').textContent.includes('no hay'));assert.equal(await page.locator('#forecasts .fp-player').count(),0);
  await page.goto('https://preview.test/admin.html');
  await page.evaluate(({source,payload})=>{
   for(const id of ['loadingView','loginView'])document.getElementById(id).hidden=true;document.getElementById('panelView').hidden=false;document.getElementById('forecastTool').open=true;
   let version=0,current=null,revision=null;window.__commands=[];
   CubanForecastReview.init({client:{rpc:async(name,args)=>{
    if(name==='get_forecast_publication')return {data:args.p_revision_id?{version,current_revision:current,revision}:{version,current_revision:current,revisions:revision?[{id:1,created_at:'2026-11-11T17:00Z',ever_published:!!current}]:[]}};
    if(name==='command_forecast_publication'){
     window.__commands.push(args.p_action);version++;
     if(args.p_action==='save')revision={id:1,source_key:source.run_key,payload};
     if(args.p_action==='publish')current=1;
     return {data:{version,current_revision:current,revision_id:1,action:args.p_action}};
    }
    return {data:args.p_run_key?source:[source]};
   }}});CubanForecastReview.authorize();
  },{source:draft(),payload:publication()});
  await page.waitForFunction(()=>!document.getElementById('forecastManage').disabled);
  await page.locator('#forecastManage').click();
  await page.waitForSelector('#forecastEditPlayers fieldset');
  assert.equal(await page.locator('#forecastSaveRevision').isDisabled(),false);
  await page.locator('#forecastSaveRevision').click();await page.waitForFunction(()=>document.getElementById('forecastEditorStatus').textContent.includes('guardada en privado'));
  await page.waitForSelector('#forecastPreview .fp-player');
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:1000});const box=await page.locator('#forecastEditor').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,columns:getComputedStyle(e.querySelector('.fp-edit-grid')).gridTemplateColumns.split(' ').length}));assert.equal(box.columns,width<760?2:3);assert.ok(box.scroll<=box.client+1,JSON.stringify({width,...box}));
   await page.locator('#forecastPreview').screenshot({path:path.join(root,'test-results','forecast-preview-'+width+'.png')});
  }
  assert.equal(await page.locator('#forecastPublish').isDisabled(),true);await page.locator('#forecastPublishConfirm').check();await page.locator('#forecastPublish').click();await page.waitForFunction(()=>window.__commands.length===2);
  assert.deepEqual(await page.evaluate(()=>window.__commands),['save','publish']);await page.evaluate(()=>CubanForecastReview.reset());assert.equal(await page.locator('#forecastEditPlayers fieldset').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: real public navigation, lazy read, 11 catalog photos, 320/390/768/1280 layouts, details, withdrawn state, private save, saved preview, explicit publish, logout reset. All responses synthetic.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
