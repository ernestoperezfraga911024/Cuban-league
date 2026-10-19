const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const CSSOM=require('rrweb-cssom');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const bytes=file=>fs.readFileSync(path.join(root,file));
const images={
  'icon-f05-192.png':192,'icon-f05-512.png':512,
  'icon-f05-maskable-512.png':512,'apple-touch-icon-f05.png':180,'favicon-f05-32.png':32
};

test('public and admin headers, installation dialogs and browser icons use F05',()=>{
  for(const file of ['index.html','admin.html']){
    const dom=new JSDOM(read(file)),doc=dom.window.document;
    try{
      assert.ok(doc.body.classList.contains('f05-theme'),file);
      const logo=doc.querySelector('.logo img,.admin-brand img');
      assert.equal(logo.getAttribute('src'),'cuban-league-f05-logo.svg');
      assert.equal(logo.getAttribute('width'),'48');
      assert.equal(logo.getAttribute('height'),'48');
      assert.equal(doc.querySelector('link[rel=icon]').getAttribute('href'),'favicon-f05-32.png');
      assert.equal(doc.querySelector('link[rel=apple-touch-icon]').getAttribute('href'),'apple-touch-icon-f05.png');
      assert.equal(doc.querySelector('meta[name=theme-color]').content,'#071910');
      assert.ok(doc.querySelector('link[href="brand-f05.css?v=182-20261018-f05-2"]'));
      assert.doesNotMatch(read(file),/cuban-league-(?:green|football)-logo|(?:apple-touch-icon|favicon)-green/);
      const modal=doc.querySelector('#installModal img,#adminInstallModal img');
      assert.equal(modal.getAttribute('src'),'apple-touch-icon-f05.png');
    }finally{dom.window.close();}
  }
});

test('F05 is a small self-contained vector without fonts, external images or effects',()=>{
  const svg=read('cuban-league-f05-logo.svg');
  const dom=new JSDOM(svg,{contentType:'image/svg+xml'});
  try{
    assert.equal(dom.window.document.documentElement.getAttribute('viewBox'),'0 0 512 512');
    assert.match(svg,/#075638/);assert.match(svg,/#f4efdc/);assert.match(svg,/#071910/);
    assert.ok(bytes('cuban-league-f05-logo.svg').length<3000);
    assert.equal(dom.window.document.querySelectorAll('image,script,foreignObject,text,filter,linearGradient,radialGradient').length,0);
    assert.equal(dom.window.document.querySelectorAll('[href],[style]').length,0);
  }finally{dom.window.close();}
});

test('generated icons have exact PNG dimensions and a bounded total download size',()=>{
  let total=0;
  for(const [name,size] of Object.entries(images)){
    const png=bytes(name);total+=png.length;
    assert.equal(png.subarray(1,4).toString(),'PNG',name);
    assert.equal(png.readUInt32BE(16),size,name+' width');
    assert.equal(png.readUInt32BE(20),size,name+' height');
  }
  assert.ok(total<140000,`${total} icon bytes`);
});

test('both installed apps retain their IDs, scope, launches and separate safe-zone icon',()=>{
  for(const [file,id,start] of [['manifest.json','./','./?source=pwa'],['admin-manifest.json','./admin.html','./admin.html?source=admin-pwa']]){
    const m=JSON.parse(read(file));
    assert.equal(m.id,id);assert.equal(m.scope,'./');assert.equal(m.start_url,start);
    assert.equal(m.background_color,'#071910');assert.equal(m.theme_color,'#071910');
    assert.deepEqual(m.icons.map(i=>i.src),['icon-f05-192.png','icon-f05-512.png','icon-f05-maskable-512.png']);
    assert.equal(m.icons.find(i=>i.purpose==='maskable').sizes,'512x512');
    for(const icon of m.icons)assert.ok(fs.existsSync(path.join(root,icon.src)));
  }
  assert.match(read('scripts/build-brand-icons.cjs'),/translate\(51\.2 51\.2\) scale\(\.8\)/);
});

test('F05 stylesheet changes paint only, without layout, hiding, external libraries or extra photos',()=>{
  const css=read('brand-f05.css');
  assert.ok(bytes('brand-f05.css').length<8500);
  const allowed=new Set(['color','background','background-color','background-image','border-color','box-shadow','text-shadow','outline-color','filter','object-fit']);
  function check(rules){for(const rule of rules){
    if(rule.cssRules){check(rule.cssRules);continue;}
    if(!rule.style)continue;
    for(let i=0;i<rule.style.length;i++){
      const property=rule.style[i];
      assert.ok(property.startsWith('--')||allowed.has(property),`${rule.selectorText}: ${property}`);
    }
    if(rule.selectorText.includes('img'))assert.match(rule.selectorText,/\.logo img|\.admin-brand img/);
  }}
  check(CSSOM.parse(css).cssRules);
  assert.doesNotMatch(css,/@import|https?:|data:|#6cff73|#50e6d0|display\s*:|visibility\s*:|opacity\s*:/);
  for(const [,asset] of css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g))assert.equal(asset,'home-stadium-night.jpg');
});

test('cream, muted labels, accents and active controls retain accessible contrast',()=>{
  function lum(hex){
    const v=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    return v[0]*.2126+v[1]*.7152+v[2]*.0722;
  }
  for(const [fg,bg] of [['#f4efdc','#071910'],['#f4efdc','#075638'],['#a6b4aa','#0c2117'],['#a6b4aa','#142e21'],['#9ed8b6','#0c2117'],['#b9d7c4','#0c2117']]){
    const a=lum(fg),b=lum(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg} on ${bg}`);
  }
});

test('service worker precaches every active logo, icon and palette version',()=>{
  const sw=read('sw.js'),app=read('app.js');
  assert.match(sw,/cuban-league-v185-captain-details/);
  assert.match(sw,/brand-f05\.css\?v=182-20261018-f05-2/);
  assert.match(app,/APP_VERSION='185-20261019-captain-details'/);
  for(const name of ['cuban-league-f05-logo.svg',...Object.keys(images)])assert.ok(sw.includes(`'./${name}'`),name);
  assert.doesNotMatch(sw,/cuban-league-green-logo|icon-green-|favicon-green|apple-touch-icon-green/);
});

test('all share card types use the F05 shell without requesting any other logo',async()=>{
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only'});
  const requested=[],drawn=[],colors=[];
  try{
    const w=dom.window;
    w.Image=class{constructor(){this.width=this.height=this.naturalWidth=this.naturalHeight=512;}set src(value){this.url=value;requested.push(value);this.onload();}};
    w.fetch=()=>{throw new Error('Network forbidden');};
    w.eval(read('app.js').replace(/init\(\);\s*$/,`window.f05Test={drawShareCardBase};`));
    const gradient=()=>({addColorStop(_stop,color){colors.push(color);}});
    const ctx=new Proxy({
      createLinearGradient:gradient,createRadialGradient:gradient,
      measureText:text=>({width:String(text).length*8}),drawImage:img=>drawn.push(img.url)
    },{get(target,key){return key in target?target[key]:()=>{};}});
    for(const badge of ['LIGA','PODIO','JUGADOR DEL MES','CHAMPIONS'])await w.f05Test.drawShareCardBase(ctx,{eyebrow:'Ejemplo',title:'Cuban League',subtitle:'Temporada',badge});
    assert.deepEqual(requested,['cuban-league-f05-logo.svg']);
    assert.equal(drawn.length,4);
    assert.ok(drawn.every(src=>src==='cuban-league-f05-logo.svg'));
    assert.ok(colors.includes('#071910'));
  }finally{dom.window.close();}
});
