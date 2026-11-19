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
    players[1].misterPlayerId='invalid/path';
    players[0].misterPlayerId='58954';
    requests[3].resolve({ok:true,json:async()=>players});await tick();
    assert.equal(panel.querySelectorAll('li').length,11);
    const lines=[...panel.querySelectorAll('.xi-field > ul')];
    assert.deepEqual(lines.map(row=>row.getAttribute('aria-label')),['Delanteros','Centrocampistas','Defensas','Portero']);
    assert.deepEqual(lines.map(row=>row.children.length),[2,5,3,1]);
    assert.equal(panel.querySelector('.xi-formation').textContent,'3–5–2');
    assert.equal(panel.querySelector('.xi-total').textContent,'55 pts');
    const keeper=lines[3].firstElementChild;
    assert.equal(keeper.querySelector('.xi-name').textContent,'Jugador 0');
    assert.equal(keeper.querySelector('.xi-owner').textContent,'Ernesto');
    assert.equal(keeper.querySelector('.xi-points').textContent,'0 pts');
    assert.equal(lines[2].firstElementChild.querySelector('.xi-name').textContent,'<img src=x>');
    assert.equal(panel.querySelectorAll('img').length,1);
    const photo=keeper.querySelector('img');
    assert.equal(photo.src,'https://cdn-mister.mundodeportivo.com/file/cdn-common/players/58954.png');
    photo.dispatchEvent(new w.Event('error'));
    assert.equal(keeper.querySelector('img'),null);
    assert.equal(keeper.querySelector('.fp-initials').hidden,false);
    assert.ok(panel.querySelector('[aria-label="Sin coincidencia en los XI publicados"]'));
  }finally{dom.window.close();}
});

test('Clasificación → Jornada follows its own selector and keeps the summary XI independent',async()=>{
  const dom=new JSDOM(read('index.html'),{runScripts:'outside-only'});
  const w=dom.window, doc=w.document;
  try{
    w.CUBAN_LEAGUE_SUPABASE={url:'https://league.test',publishableKey:'test',season:'2026/27'};
    w.eval(read('app.js').replace(/init\(\);\s*$/, `
      DATA={currentSeason:'2026/27',participants:[]};
      PUBLISHED_MATCHDAYS=[1,12];
      setupStandingsSwitcher();
      renderClassificationMatchday();
      bindOfficialMatchdayXi(1);
    `));
    const calls=[];
    w.fetch=async(url,options)=>{
      const day=JSON.parse(options.body).p_matchday;
      calls.push(day);
      return {ok:true,json:async()=>Array.from({length:11},(_,i)=>({
        position:i===0?'PT':i<5?'DF':i<9?'MC':'DL',playerName:'J'+day+' jugador '+i,points:i,participants:[]
      }))};
    };
    const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
    doc.querySelector('#standingsTabMatchday').click();
    const panel=doc.querySelector('#currentMatchdayPanel .official-matchday-xi');
    const summary=doc.querySelector('#officialMatchdayXi');
    assert.equal(doc.querySelector('#currentMatchdayPanel').hidden,false);
    assert.deepEqual(calls,[]);
    panel.querySelector('summary').click();await tick();
    assert.equal(panel.querySelectorAll('li').length,11);
    assert.match(panel.textContent,/J12 jugador/);
    assert.equal(summary.querySelectorAll('li').length,0);
    const select=doc.querySelector('#classificationMatchdaySelect');
    select.value='1';select.dispatchEvent(new w.Event('change'));await tick();
    assert.deepEqual(calls,[12,1]);assert.match(panel.textContent,/J1 jugador/);
    assert.doesNotMatch(panel.textContent,/J12 jugador/);
    summary.querySelector('summary').click();await tick();
    assert.match(summary.textContent,/J1 jugador/);
    select.value='12';select.dispatchEvent(new w.Event('change'));await tick();
    assert.match(summary.textContent,/J1 jugador/);
    assert.match(panel.textContent,/J12 jugador/);
  }finally{w.close();}
});
