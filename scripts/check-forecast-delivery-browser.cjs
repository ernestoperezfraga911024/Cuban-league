// Synthetic responses only; no network writes or saved personal data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {publication}=require('../tests/fixtures/forecast-publication.cjs'),root=path.join(__dirname,'..');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:1000}});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.hostname!=='preview.test')return route.abort();
   const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   if(u.pathname==='/admin.js')return route.fulfill({contentType:'text/javascript',body:''});
   const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
   return route.fulfill({body:fs.readFileSync(file),contentType:types[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>{throw Error('Quick flow must not require a confirmation dialog');});
  await page.goto('https://preview.test/admin.html');
  await page.evaluate(payload=>{
   for(const id of ['loadingView','loginView'])document.getElementById(id).hidden=true;
   document.getElementById('panelView').hidden=false;document.getElementById('forecastTool').open=true;
   window.__delivery={version:10,current_revision:1,mode:'manual',readiness:'ready',source_key:'pilot-synthetic-delivery',created_at:'2026-11-11T17:00:00Z',preview:payload};
   window.__requests=[];window.__fail=false;window.__hold=false;window.__results=new Map();
   CubanForecastDelivery.init({client:{rpc:async(name,args)=>{
    if(window.__hold)await new Promise(resolve=>window.__release=resolve);
    if(name==='get_forecast_delivery')return {data:structuredClone(window.__delivery)};
    window.__requests.push(structuredClone(args));
    if(window.__results.has(args.p_request_id))return {data:window.__results.get(args.p_request_id)};
    if(args.p_expected_version!==window.__delivery.version)return {error:{code:'40001'}};
    window.__delivery.version++;
    if(args.p_action==='publish')window.__delivery.readiness='published';else window.__delivery.mode=args.p_action;
    const result={outcome:args.p_action==='publish'?'published':'mode_changed',mode:window.__delivery.mode,version:window.__delivery.version};
    window.__results.set(args.p_request_id,result);
    if(window.__fail){window.__fail=false;throw Error('Lost response after commit');}
    return {data:result};
   }}});CubanForecastDelivery.authorize();
  },publication());
  await page.waitForFunction(()=>!document.getElementById('forecastQuickPublish').disabled);
  assert.equal(await page.locator('#forecastAdvanced').getAttribute('open'),null);
  await page.locator('#forecastQuickPublish').click();
  await page.waitForFunction(()=>document.getElementById('forecastDeliveryStatus').textContent==='Once publicado correctamente.');
  assert.equal(await page.evaluate(()=>__requests.length),1);assert.equal(await page.locator('#forecastQuickPublish').isDisabled(),true);
  assert.equal(await page.locator('#forecastEditPlayers fieldset').count(),0);
  await page.locator('#forecastModeAuto').click();await page.waitForFunction(()=>document.getElementById('forecastModeAuto').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>window.__fail=true);await page.locator('#forecastModeManual').click();await page.waitForSelector('#forecastDeliveryRetry:visible');
  assert.equal(await page.locator('#forecastQuickPublish').isDisabled(),true);assert.equal(await page.locator('#forecastDeliveryReload').isDisabled(),true);
  await page.locator('#forecastDeliveryRetry').click();await page.waitForFunction(()=>document.getElementById('forecastModeManual').getAttribute('aria-pressed')==='true');
  const requests=await page.evaluate(()=>__requests);assert.deepEqual(requests[2],requests[3]);
  await page.evaluate(()=>{__delivery.version++;__delivery.readiness='ready';});
  await page.locator('#forecastModeAuto').click();await page.waitForFunction(()=>document.getElementById('forecastDeliveryStatus').textContent.includes('otra sesión'));
  assert.equal(await page.locator('#forecastQuickPublish').isDisabled(),true);
  await page.locator('#forecastDeliveryReload').click();await page.waitForFunction(()=>!document.getElementById('forecastQuickPublish').disabled);
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:1000});const m=await page.locator('#forecastDelivery').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));assert.ok(m.scroll<=m.client+1,JSON.stringify({width,...m}));
   await page.locator('#forecastDelivery').screenshot({path:path.join(root,'test-results','forecast-delivery-'+width+'.png')});
  }
  await page.evaluate(()=>{__delivery.readiness='blocked';__delivery.preview=null;__delivery.reason='Fuente no disponible';__delivery.limitations=['Se conserva la publicación anterior.'];});
  await page.locator('#forecastDeliveryReload').click();await page.waitForFunction(()=>document.getElementById('forecastDeliveryStatus').textContent.includes('Fuente no disponible'));
  assert.equal(await page.locator('#forecastQuickPublish').isDisabled(),true);assert.equal(await page.locator('#forecastDeliveryPreview .fp-player').count(),0);
  await page.evaluate(()=>{__hold=true;CubanForecastDelivery.refresh();});await page.waitForFunction(()=>!!window.__release);
  await page.evaluate(()=>{CubanForecastDelivery.reset();__release();});
  assert.equal(await page.locator('#forecastDeliveryPreview .fp-player').count(),0);assert.equal(await page.locator('#forecastQuickPublish').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('PASS: one-click publish, no edit/save/dialog, modes, exact retry after lost response, conflict refresh, blocked source, logout race, 320/390/768/1280 layouts. Synthetic responses only.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
