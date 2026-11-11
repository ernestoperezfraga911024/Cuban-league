// Real browser, controlled responses; never writes to Supabase.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),fixture=require('../tests/fixtures/forecast-round.cjs'),old=require('../tests/fixtures/forecast-publication.cjs');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:1000}});let reads=0,withdraw=false;
  const real=process.env.FORECAST_REAL_BATCH?JSON.parse(fs.readFileSync(process.env.FORECAST_REAL_BATCH,'utf8')):null;
  const all=real||[...fixture.rows(),{team:'real-madrid',payload:old.publication(),published_at:'2026-11-11T20:00:00Z'}];
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.hostname.endsWith('.supabase.co')){if(u.pathname.includes('forecast_')){reads++;return route.fulfill({json:withdraw?[]:u.pathname.endsWith('/forecast_public')?all.filter(x=>x.team==='real-madrid'):all.filter(x=>x.team!=='real-madrid')});}return route.fulfill({json:[]});}
   if(u.hostname!=='preview.test')return route.abort();const f=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!f.startsWith(root+path.sep)||!fs.existsSync(f))return route.fulfill({status:404,body:''});
   const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};return route.fulfill({body:fs.readFileSync(f),contentType:types[path.extname(f)]||'application/octet-stream'});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://preview.test/index.html');assert.equal(reads,0);
  await page.waitForFunction(()=>document.getElementById('currentRows')?.children.length>0||document.querySelector('.player-card'));
  await page.locator('[data-editorial-menu]:visible').last().click();await page.locator('#editorialMenu [data-go="forecasts"]').click();
  await page.waitForSelector('#forecasts .fp-player');assert.equal(reads,2);assert.equal(await page.locator('[data-forecast-team]').count(),20);
  for(const row of all){await page.locator('[data-forecast-team="'+row.team+'"]').click();assert.equal(await page.locator('#forecasts .fp-player').count(),11);assert.equal(await page.locator('#forecasts .fp-formation').textContent(),row.payload.formation);const expected=row.payload.players.map(p=>p.name).sort(),actual=await page.locator('#forecasts .fp-player .fp-name').allTextContents();assert.deepEqual(actual.sort(),expected);}
  assert.equal(reads,2);fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:1000});
   for(const team of ['real-madrid','alaves','espanyol','celta-vigo']){
    await page.locator('[data-forecast-team="'+team+'"]').click();const m=await page.locator('#forecasts').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth,field:e.querySelector('.fp-field').getBoundingClientRect().height,card:e.querySelector('.fp-card').getBoundingClientRect().width}));assert.ok(m.scroll<=m.client+1,JSON.stringify({width,team,...m}));assert.ok(m.field<650,JSON.stringify({width,team,...m}));assert.ok(m.card<=880);if(team==='alaves')await page.locator('#forecasts').screenshot({path:path.join(root,'test-results','forecast-round-'+width+'.png')});
   }
  }
  await page.locator('#forecasts .fp-player').first().click();assert.equal(await page.locator('#forecasts .fp-player[aria-pressed=true]').count(),1);
  withdraw=true;await page.locator('#forecastPublicReload').click();await page.waitForFunction(()=>document.getElementById('forecastPublicStatus').textContent.includes('no hay'));assert.equal(await page.locator('#forecasts .fp-player').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS: 20 teams / 220 names, two lazy public reads, no selection requests, 320–1280px, 3/4/5 defensive lines, details and withdrawal. '+(real?'Real prepared payloads; responses intercepted.':'Synthetic payloads.'));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
