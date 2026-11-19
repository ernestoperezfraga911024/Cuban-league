const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('public matchday loads only on opening, separates pending from error and discards a stale response',async()=>{
  const dom=new JSDOM(read('index.html'),{runScripts:'outside-only'});
  const w=dom.window;
  try{
    w.CUBAN_LEAGUE_SUPABASE={url:'https://league.test',publishableKey:'test',season:'2026/27'};
    w.eval(read('app.js').replace(/init\(\);\s*$/,'window.bindXi=bindOfficialMatchdayXi;'));
    const requests=[];
    w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,day:JSON.parse(options.body).p_matchday,resolve}));
    const panel=w.document.getElementById('officialMatchdayXi');
    const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
    w.bindXi(11);
    assert.equal(requests.length,0);
    panel.open=true;
    await tick();
    assert.equal(requests[0].day,11);
    w.bindXi(12);
    requests[1].resolve({ok:true,json:async()=>null});
    requests[0].resolve({ok:false});
    await tick();
    assert.match(panel.textContent,/Todavía no hay/);
    w.bindXi(11);
    requests[2].resolve({ok:false});
    await tick();
    assert.match(panel.textContent,/reintentar/);
    panel.open=false;await tick();panel.open=true;await tick();
    const players=['PT','DF','DF','DF','MC','MC','MC','MC','MC','DL','DL'].map((position,i)=>({
      position,playerName:'Jugador '+i,points:i,participants:i?[]:['Ernesto']
    }));
    players[1].playerName='<img src=x>';
    requests[3].resolve({ok:true,json:async()=>players});await tick();
    assert.equal(panel.querySelectorAll('li').length,11);
    assert.match(panel.querySelector('li').textContent,/PTJugador 0Ernesto0 pts/);
    assert.equal(panel.querySelector('img'),null);
    assert.match(panel.textContent,/Sin coincidencia en los XI publicados/);
  }finally{dom.window.close();}
});
