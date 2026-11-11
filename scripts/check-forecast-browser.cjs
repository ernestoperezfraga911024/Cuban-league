// Offline browser smoke with synthetic RPC responses. No user credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname!=='preview.test')return route.abort();
   const file=path.join(root,decodeURIComponent(u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   if(u.pathname==='/admin.js')return route.fulfill({contentType:'text/javascript',body:''});
   const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
   await route.fulfill({body:fs.readFileSync(file),contentType:types[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://preview.test/admin.html');
  await page.evaluate(()=>{
   for(const id of ['loadingView','loginView'])document.getElementById(id).hidden=true;
   document.getElementById('panelView').hidden=false;
   const names=['Courtois','Valverde','Konaté','Huijsen','Cucurella','Camavinga','Bernardo Silva','Arda Güler','Bellingham','Diomande','Mbappé'];
   const payload={team:'real-madrid',fixture_key:'test-fixture',matchday:13,kickoff_at:'2026-11-21T20:00:00Z',status:'draft',limitations:['Datos de ejemplo para comprobar el diseño.'],sources:[{id:'fuente-de-prueba',url:'https://example.test/',status:'read',fetched_at:'2026-11-11T16:00:00Z',source_updated_at:null,starters:names}],proposal:{formation:'4-2-3-1',players:names.map((name,i)=>({id:'p-'+i,name,position:i===0?'GK':i<5?'DF':i<10?'MF':'FW',probability:i===4?55:80,alternative:i===4?{id:'reserva',name:'Álvaro Carreras'}:null,reason:'Explicación sintética para revisar legibilidad.'}))}};
   const row={run_key:'pilot-preview',created_at:'2026-11-11T16:48:14Z',team:payload.team,fixture_key:payload.fixture_key,status:'draft',payload};
   window.__forecastCalls=0;
   CubanForecastReview.init({client:{rpc:async(_,args)=>{window.__forecastCalls++;return {data:args.p_run_key?row:[row]};}}});
   CubanForecastReview.authorize();document.getElementById('forecastTool').open=true;
  });
  await page.waitForSelector('.forecast-player');
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:1000});
   const layout=await page.locator('#forecastTool').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,count:e.querySelectorAll('.forecast-player').length}));
   assert.equal(layout.count,11);assert.ok(layout.scroll<=layout.client+1,JSON.stringify(layout));
   await page.locator('#forecastTool').screenshot({path:path.join(root,'test-results','forecast-'+width+'.png')});
  }
  assert.equal(await page.evaluate(()=>window.__forecastCalls),2);
  await page.locator('.forecast-player').first().click();await page.waitForFunction(()=>document.getElementById('forecastPlayerDetail').textContent.includes('sintética'));
  assert.deepEqual(errors,[]);console.log('Browser: 390px and 1280px, 11 players, no overflow, details usable, exactly 2 read requests.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
