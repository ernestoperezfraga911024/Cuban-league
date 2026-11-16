'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');
const article=(key='atletico-lookman-molestias-nigeria-20261113',rest={})=>({key,season:'2026-27',team:'atletico-madrid',category:'injury',certainty:'reported',title:'Lookman pendiente de las pruebas de su club',summary:'Información original verificada para probar la identidad de un mismo acontecimiento.',impact:'Seguir las pruebas del club antes de confirmar la disponibilidad del jugador.',players:[{id:'a-lookman',name:'A. Lookman'}],sources:[{name:'FutbolFantasy',kind:'media',url:'https://www.futbolfantasy.com/laliga/noticias/154704-lookman-cae-lesionado-con-nigeria',fetched_at:new Date().toISOString(),published_at:null}],...rest});
test('news duplicate prevention guards new keys without merging distinct stories or altering stored data',async t=>{
 const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const save=p=>q("select league_news.save_draft('news-local-dup',$1::jsonb) result",[JSON.stringify(p)]);
 const candidates=p=>q('select league_news.duplicate_candidates($1::jsonb) result',[JSON.stringify(p)]);
 const sub=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 const rejected=async fn=>{await db.exec('savepoint rejected');try{await assert.rejects(fn,e=>e.code==='23505');}finally{await db.exec('rollback to rejected;release rejected');}};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema forecast_league;
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function private.is_league_admin() returns boolean language sql as $$select false$$;
  create table forecast_league.teams(team text primary key);insert into forecast_league.teams values('atletico-madrid'),('real-madrid');
  create table forecast_league.roster(id text primary key,team text,name text);insert into forecast_league.roster values('a-lookman','atletico-madrid','A. Lookman'),('a-sorloth','atletico-madrid','A. Sørloth'),('third-player','atletico-madrid','Other player');`);
  await db.exec(read('docs/news/migration.sql'));await db.exec(read('docs/news/coverage.sql'));
  await q("select league_news.initialize_run('news-local-dup','Local regression test only')");
  await save(article());await q("select league_news.deliver('atletico-lookman-molestias-nigeria-20261113')");
  const before={items:(await db.query('select * from league_news.items order by key')).rows,public:(await db.query('select * from public.news_public order by key')).rows,ledger:(await db.query('select * from league_news.run_events order by key')).rows,
   fn:await q("select oid,prosecdef,proacl::text,proconfig from pg_proc where oid='league_news.save_draft(text,jsonb)'::regprocedure"),acl:await q("select relacl::text,relrowsecurity from pg_class where oid='public.news_public'::regclass")};
  assert.equal((await q("select md5(pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure)) h")).h,'6f328c212c1b0b27cd5912b154a1fdf5');
  const installation=await db.exec(read('docs/news/duplicate-prevention.sql'));
  const proof=installation.flatMap(x=>x.rows||[]).find(x=>x.result)?.result;
  assert.equal(proof.protected_state_unchanged,true);assert.match(proof.save_draft_md5,/^[a-f0-9]{32}$/);assert.equal(proof.snapshot.control.mode,'automatic');
  await sub('migration preserves all stored rows and public/function privileges',async()=>{
   assert.deepEqual((await db.query('select * from league_news.items order by key')).rows,before.items);assert.deepEqual((await db.query('select * from public.news_public order by key')).rows,before.public);assert.deepEqual((await db.query('select * from league_news.run_events order by key')).rows,before.ledger);
   assert.deepEqual(await q("select oid,prosecdef,proacl::text,proconfig from pg_proc where oid='league_news.save_draft(text,jsonb)'::regprocedure"),before.fn);assert.deepEqual(await q("select relacl::text,relrowsecurity from pg_class where oid='public.news_public'::regclass"),before.acl);
   for(const role of ['anon','authenticated','service_role'])for(const signature of ['article_identity(text)','duplicate_candidates(jsonb)'])assert.equal((await q('select has_function_privilege($1,$2,\'EXECUTE\') yes',[role,'league_news.'+signature])).yes,false);
  });
  await sub('Lookman key permutation rejected before ledger, item or publication writes',async()=>{
   const p=article('atletico-lookman-nigeria-molestias-20261113');assert.equal((await candidates(p)).result[0].key,article().key);await rejected(()=>save(p));
   assert.deepEqual((await db.query('select * from league_news.run_events order by key')).rows,before.ledger);assert.deepEqual((await db.query('select * from league_news.items order by key')).rows,before.items);assert.deepEqual((await db.query('select * from public.news_public order by key')).rows,before.public);
  });
  await sub('Sorloth exact article with different slug/title still conflicts',async()=>{
   const p=article('atletico-sorloth-juventus-rumor-20261112',{category:'transfer',certainty:'rumor',players:[{id:'a-sorloth',name:'A. Sørloth'}],sources:[{...article().sources[0],name:'Comuniate',url:'https://www.comuniate.com/noticias/38991/sorloth-vuelve-a-sonar'}]});await save(p);
   await rejected(()=>save({...p,key:'atletico-sorloth-juventus-20261112',title:'Otro título para el mismo rumor publicado',sources:[{...p.sources[0],url:'https://comuniate.com/noticias/38991/slug-actualizado?utm_source=reader#fragment'}]}));
  });
  await sub('canonical identity strips tracking but keeps meaningful query and rejects index/foreign URLs',async()=>{
   const id=async u=>(await q('select league_news.article_identity($1) x',[u])).x;
   assert.equal(await id('https://www.jornadaperfecta.com/blog/lookman-lesion/?utm_medium=x&fbclid=y#part'),'jornadaperfecta:/blog/lookman-lesion');
   assert.equal(await id('https://jornadaperfecta.com/blog/lookman-lesion?lang=es&utm_source=x'),'jornadaperfecta:/blog/lookman-lesion?lang=es');
   for(const u of ['https://www.comuniate.com/noticias/','https://www.futbolfantasy.com/laliga/noticias','https://www.jornadaperfecta.com/blog/','https://evil.example/blog/lookman','https://user@www.comuniate.com/noticias/38991/title'])assert.equal(await id(u),null);
  });
  await sub('distinct source, player, club or category is never automatically merged',async()=>{
   const cases=[{sources:[{...article().sources[0],url:'https://www.futbolfantasy.com/laliga/noticias/154999-another-event'}]},{players:[{id:'a-sorloth',name:'A. Sørloth'}]},{team:'real-madrid'},{category:'recovery'},{players:[]}];
   for(let i=0;i<cases.length;i++){const p=article('distinct-event-'+i,cases[i]);assert.deepEqual((await candidates(p)).result,[]);assert.equal((await save(p)).result.outcome,'saved');}
  });
  await sub('exact nonempty player sets compare irrespective of order; partial overlap is distinct',async()=>{
   const p=article('two-players-original',{players:[{id:'a-sorloth',name:'A. Sørloth'},{id:'third-player',name:'Other player'}]});await save(p);
   await rejected(()=>save({...p,key:'two-players-copy',players:[...p.players].reverse()}));assert.deepEqual((await candidates({...p,key:'two-players-more',players:[...p.players,...article().players]})).result,[]);
  });
  await sub('same key updates normal timeline; a suppressed event stays private and prevents resurrection by new key',async()=>{
   const p=article();assert.equal((await save({...p,summary:p.summary+' Se actualiza la evolución.',change_note:'Se revisa la evolución del mismo acontecimiento.'})).result.outcome,'saved');
   await db.query('update league_news.items set suppressed=true where key=$1',[p.key]);await db.query('update public.news_public set visible=false where key=$1',[p.key]);
   assert.equal((await candidates({...p,key:'suppressed-copy-attempt'})).result[0].suppressed,true);await rejected(()=>save({...p,key:'suppressed-copy-attempt'}));
   assert.equal((await q('select league_news.deliver($1) result',[p.key])).result.outcome,'ready');assert.equal((await q('select visible from public.news_public where key=$1',[p.key])).visible,false);
  });
  await sub('multiple old candidates are reported and never selected or merged automatically',async()=>{
   const old=article('legacy-duplicate-seeded');await db.query("insert into league_news.items(key,payload,version,outcome) values($1,$2,1,'ready')",[old.key,JSON.stringify(old)]);
   const found=(await candidates(article('ambiguous-new-key'))).result;assert.equal(found.length,2);await rejected(()=>save(article('ambiguous-new-key')));
  });
  // PGlite serializes its queued calls. The actual installed function also holds
  // the existing control-row FOR UPDATE lock before either duplicate scan/write.
  await t.test('queued competing new keys yield one save and one conflict under the existing control-lock path',async()=>{
   const p=article('competing-key-one',{sources:[{...article().sources[0],url:'https://www.comuniate.com/noticias/999999/concurrent'}]});
   const results=await Promise.allSettled([save(p),save({...p,key:'competing-key-two'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'23505');
   const source=(await q("select pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure) src")).src;assert.ok(source.indexOf('league_news.control for update')<source.indexOf('league_news.duplicate_candidates(p)'));assert.ok(source.indexOf('league_news.duplicate_candidates(p)')<source.indexOf('perform league_news.track_saved'));
  });
  await t.test('a changed installed function aborts migration without overwriting it',async()=>{
   const before=(await q("select pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure) src")).src;
   await assert.rejects(db.exec(read('docs/news/duplicate-prevention.sql')),/changed/);await db.exec('rollback');
   assert.equal((await q("select pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure) src")).src,before);
  });
 }finally{await db.close();}
});
