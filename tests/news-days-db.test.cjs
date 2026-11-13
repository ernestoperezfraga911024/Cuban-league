'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('News days: source dates, additive migration, publication and indexed pagination',async t=>{
 const db=new PGlite();
 const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const q=async(sql,args=[])=>(await rows(sql,args))[0];
 const exec=sql=>db.exec(sql);
 const day=async payload=>(await q('select league_news.news_day($1::jsonb)::text as day',[JSON.stringify(payload)])).day;
 const sourceDay=source=>day({sources:[source]});
 const rejected=async fn=>{await exec('savepoint invalid_case');try{await assert.rejects(fn);}finally{await exec('rollback to savepoint invalid_case;release savepoint invalid_case');}};
 const sub=(name,fn)=>t.test(name,async()=>{await exec('begin');try{await fn();}finally{await exec('rollback');}});
 try{
  await exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create schema private;create schema forecast_league;
   grant usage on schema private,auth to authenticated;
   create function auth.uid() returns uuid language sql as $$select case when current_setting('news_test.admin',true)='true' then '00000000-0000-4000-8000-000000000001'::uuid end$$;
   create function private.is_league_admin() returns boolean language sql as $$select coalesce(current_setting('news_test.admin',true)='true',false)$$;
   create table forecast_league.teams(team text primary key);insert into forecast_league.teams values('real-madrid'),('barcelona');
   create table forecast_league.roster(id text primary key,team text,name text);`);
  await exec(read('docs/news/migration.sql'));
  await exec(read('docs/news/coverage.sql'));
  await exec(`insert into public.news_public(key,payload,updated_at,visible) values
   ('older-imported-today','{"team":"real-madrid","sources":[{"published_label":"10/11/2026, 13:11 (zona no especificada)","published_at":null,"fetched_at":"2026-11-13T18:00:00Z"}]}','2026-11-13T18:00:00Z',true),
   ('hidden-newer-news','{"team":"barcelona","sources":[{"published_label":"13/11/2026 (sin hora publicada)"}]}','2026-11-13T19:00:00Z',false),
   ('legacy-unknown-date','{"team":"real-madrid","sources":{"published_label":"13/11/2026"}}','2026-11-13T20:00:00Z',true);`);
  const originalRows=await rows('select * from public.news_public order by key');
  const originalFunctions=await rows("select oid,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where pronamespace in ('league_news'::regnamespace,'private'::regnamespace) order by oid");
  const originalPrivate=await rows('select to_jsonb(c) as control,(select jsonb_agg(r) from league_news.runs r) as runs,(select jsonb_agg(i) from league_news.items i) as items from league_news.control c');
  await exec(read('docs/news/by-day.sql'));

  await sub('migration preserves payloads, timestamps, publication state and existing functions',async()=>{
   assert.deepEqual(await rows('select key,payload,published_at,updated_at,visible from public.news_public order by key'),originalRows);
   assert.deepEqual(await rows('select oid,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where oid=any($1::oid[]) order by oid',[originalFunctions.map(f=>f.oid)]),originalFunctions);
   assert.deepEqual(await rows('select to_jsonb(c) as control,(select jsonb_agg(r) from league_news.runs r) as runs,(select jsonb_agg(i) from league_news.items i) as items from league_news.control c'),originalPrivate);
   assert.deepEqual(await rows('select key,news_day::text from public.news_public order by key'),[
    {key:'hidden-newer-news',news_day:'2026-11-13'},{key:'legacy-unknown-date',news_day:null},{key:'older-imported-today',news_day:'2026-11-10'}]);
   const fn=await q("select provolatile,prosecdef,proparallel,proacl::text,proconfig from pg_proc where oid='league_news.news_day(jsonb)'::regprocedure");
   assert.equal(fn.provolatile,'i');assert.equal(fn.prosecdef,false);assert.equal(fn.proparallel,'s');assert.equal(fn.proacl,'{postgres=X/postgres}');assert.deepEqual(fn.proconfig,['search_path=""']);
   assert.equal((await q("select attgenerated from pg_attribute where attrelid='public.news_public'::regclass and attname='news_day'")).attgenerated,'s');
   await rejected(()=>q("update public.news_public set news_day='2026-11-13' where key='older-imported-today'"));
  });

  await sub('recognizes actual source labels, all Spanish months and only the publication date',async()=>{
   for(const [label,expected] of [
    ['10/11/2026, 13:11 (zona no especificada)','2026-11-10'],
    ['12/11/2026 (sin hora publicada)','2026-11-12'],
    ['10/11/2026 13:05; zona horaria no especificada','2026-11-10'],
    ['11/11/2026 (sin hora ni zona horaria especificadas)','2026-11-11'],
    ['13/11/2026, 01:53; sesión del 12/11 (zona no especificada)','2026-11-13'],
    ['Viernes, 13 de noviembre del 2026 a las 15:21 (zona horaria no especificada)','2026-11-13'],
    ['Miércoles, 11 de noviembre del 2026 a las 00:55 (zona horaria no especificada)','2026-11-11'],
    ['  SÁBADO, 29 DE FEBRERO DE 2020  ','2020-02-29'],
    ['1/1/2026','2026-01-01'],['3 de setiembre de 2026','2026-09-03']
   ])assert.equal(await sourceDay({published_label:label}),expected,label);
   for(const [index,month] of ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'].entries()){
    assert.equal(await sourceDay({published_label:'1 de '+month+' del 2026'}),'2026-'+String(index+1).padStart(2,'0')+'-01',month);
   }
  });

  await sub('ISO timestamps use Miami, preserve DST boundaries and take the newest valid source update',async()=>{
   for(const [stamp,expected] of [
    ['2026-11-13T04:59:59Z','2026-11-12'],['2026-11-13T05:00:00Z','2026-11-13'],
    ['2026-06-01T03:59:59Z','2026-05-31'],['2026-06-01T04:00:00Z','2026-06-01'],
    ['2026-03-08T06:59:59Z','2026-03-08'],['2026-03-08T07:00:00Z','2026-03-08'],
    ['2026-11-01T05:30:00Z','2026-11-01'],['2026-11-01T06:30:00Z','2026-11-01'],
    ['2026-11-13T01:00:00+02:00','2026-11-12'],['2026-11-13T23:30:00-0600','2026-11-14'],
    ['2026-11-13 05:00Z','2026-11-13'],['2026-11-13t04:59:59.123456z','2026-11-12']
   ])assert.equal(await sourceDay({published_at:stamp}),expected,stamp);
   assert.equal(await sourceDay({published_at:'2026-11-13T01:00:00Z',published_label:'13/11/2026'}),'2026-11-12','explicit timestamp wins over an unzoned label');
   assert.equal(await sourceDay({published_at:'2026-11-10T15:00:00Z',source_updated_at:'2026-11-12T15:00:00Z'}),'2026-11-12');
   assert.equal(await sourceDay({published_at:'2026-11-12T15:00:00Z',source_updated_at:'2026-11-10T15:00:00Z'}),'2026-11-12');
   assert.equal(await sourceDay({published_at:'bad',source_updated_at:'2026-11-12T15:00:00Z'}),'2026-11-12');
   assert.equal(await day({sources:[{published_label:'10/11/2026'},null,{published_at:'2026-11-12T15:00:00Z'},{published_label:'11/11/2026'},{}]}),'2026-11-12');
   for(const setting of ["set local timezone='Pacific/Auckland';set local datestyle='German, DMY'","set local timezone='America/Los_Angeles';set local datestyle='SQL, MDY'"]){
    await exec(setting);
    assert.equal((await q("select to_char(league_news.news_day($1::jsonb),'YYYY-MM-DD') as day",[JSON.stringify({sources:[{published_at:'2026-11-13T04:59:59Z'}]})])).day,'2026-11-12');
    assert.equal((await q("select to_char(league_news.news_day($1::jsonb),'YYYY-MM-DD') as day",[JSON.stringify({sources:[{published_label:'13/11/2026'}]})])).day,'2026-11-13');
   }
  });

  await sub('invalid or absent metadata stays unknown and never borrows collection or event dates',async()=>{
   for(const payload of [null,{},[],{sources:null},{sources:{}},{sources:'13/11/2026'},{sources:[null,17,'13/11/2026',[]]},{published_at:'2026-11-13T12:00:00Z',sources:[]},
    {key:'news-20261113',updated_at:'2026-11-13T12:00:00Z',timeline:[{at:'2026-11-13T12:00:00Z'}],sources:[{fetched_at:'2026-11-13T12:00:00Z'}]}])assert.equal(await day(payload),null,JSON.stringify(payload));
   for(const value of ['','now','infinity','-infinity','2026-11-13','2026-11-13T12:00:00','2026-02-30T12:00:00Z','2026-11-13T25:00:00Z','2026-11-13T24:00:00Z','2026-11-13T23:60:00Z','2026-11-13T12:00:00+99:99','0000-11-13T12:00:00Z','0001-01-01T00:00:00Z','9999-12-31T23:59:00-06:00']){
    assert.equal(await sourceDay({published_at:value,source_updated_at:value}),null,value);
    assert.equal(await sourceDay({published_at:value,source_updated_at:value,published_label:'10/11/2026'}),'2026-11-10','valid label fallback: '+value);
   }
   for(const label of ['31/02/2026','29/02/2026','00/11/2026','10/13/2026','10/11/0000','10/11/20260','13/11/2026x','La sesión fue el 13/11/2026','31 de abril del 2026','13 de unknown del 2026','Fecha original desconocida'])assert.equal(await sourceDay({published_label:label}),null,label);
   await q('insert into public.news_public(key,payload) values($1,$2::jsonb)',['bad-source-date',JSON.stringify({sources:[{published_at:'2026-02-30T12:00:00Z',published_label:'31/02/2026'}]})]);
   assert.equal((await q("select news_day from public.news_public where key='bad-source-date'")).news_day,null);
  });

  await sub('normal and manual publication, retries, withdrawal and restore keep working',async()=>{
   await exec("insert into league_news.runs(key) values('days-local-run')");
   const payload={key:'days-publication-test',season:'2026-27',team:'real-madrid',category:'training',certainty:'reported',title:'Training evidence for the local publication test',summary:'Verified original training information for this local test.',impact:'Follow the next available training report.',players:[],sources:[{name:'FutbolFantasy',kind:'media',url:'https://www.futbolfantasy.com/laliga/noticias/days-local-test',fetched_at:new Date().toISOString(),published_at:null,published_label:'10/11/2026'}]};
   const save=p=>q("select league_news.save_draft('days-local-run',$1::jsonb) as r",[JSON.stringify(p)]);
   const deliver=()=>q("select league_news.deliver('days-publication-test') as r");
   const published=()=>q("select payload,news_day::text,visible,updated_at from public.news_public where key='days-publication-test'");
   assert.equal((await save(payload)).r.outcome,'saved');assert.equal((await deliver()).r.outcome,'published');
   const initial=await published();assert.equal(initial.news_day,'2026-11-10');
   assert.equal((await save(payload)).r.outcome,'unchanged');assert.equal((await deliver()).r.outcome,'unchanged');assert.deepEqual(await published(),initial);
   let request=2;
   const command=async(action,key=null)=>{
    await exec("set local news_test.admin='true';set local role authenticated");
    const state=(await q("select public.news_admin('read') as r")).r;
    const result=await q('select public.news_admin($1,$2,$3,$4) as r',[action,key,state.version,'00000000-0000-4000-8000-'+String(request++).padStart(12,'0')]);
    await exec('reset role');return result;
   };
   await command('withdraw',payload.key);assert.equal((await published()).visible,false);
   const updated={...payload,summary:'A new verified fact requires updating the original article.',sources:[{...payload.sources[0],published_label:'12/11/2026'}]};
   await save(updated);assert.equal((await deliver()).r.outcome,'ready');assert.equal((await published()).news_day,'2026-11-10');
   await command('manual');await command('restore',payload.key);assert.equal((await published()).visible,true);assert.equal((await deliver()).r.outcome,'ready');
   await command('publish');assert.equal((await published()).news_day,'2026-11-12');assert.equal((await published()).payload.summary,updated.summary);
  });

  await sub('public readers can select the stored day but cannot invoke its parser or write news',async()=>{
   for(const role of ['anon','authenticated']){
    await exec('set local role '+role);
    assert.deepEqual(await rows('select key,news_day::text from public.news_public order by key'),[{key:'legacy-unknown-date',news_day:null},{key:'older-imported-today',news_day:'2026-11-10'}]);
    await rejected(()=>q("select league_news.news_day('{\"sources\":[]}'::jsonb)"));
    await rejected(()=>q("update public.news_public set payload='{}'"));
    await exec('reset role');
   }
  });

  await sub('feed and club indexes support deterministic pages including ties and unknown dates',async()=>{
   await exec('delete from public.news_public');
   const fixtures=Array.from({length:97},(_,i)=>({key:'page-'+String(i).padStart(3,'0'),payload:{team:i%2?'real-madrid':'barcelona',category:i%3?'training':'injury',sources:[i<85?{published_label:(i<50?'13':i<75?'12':'10')+'/11/2026'}:{}]},updated_at:'2026-11-13T20:00:00.'+(i%3===0?'123456':'123455')+'Z',visible:i!==4}));
   await q('insert into public.news_public(key,payload,updated_at,visible) select key,payload,updated_at,visible from jsonb_to_recordset($1::jsonb) as x(key text,payload jsonb,updated_at timestamptz,visible boolean)',[JSON.stringify(fixtures)]);
   const order='news_day desc nulls last,updated_at desc,key asc';
   for(const club of [null,'real-madrid']){
    const expected=await rows('select key,news_day::text,updated_at::text from public.news_public where visible and ($1::text is null or payload->>\'team\'=$1) order by '+order,[club]);
    const seen=[];let cursor=null;
    for(let pageNumber=0;pageNumber<30;pageNumber++){
     const args=[club];let predicate='';
     if(cursor){
      args.push(cursor.updated_at,cursor.key);
      if(cursor.news_day!==null){args.push(cursor.news_day);predicate=' and (news_day<$4::date or news_day is null or (news_day=$4::date and (updated_at<$2::timestamptz or (updated_at=$2::timestamptz and key>$3))))';}
      else predicate=' and news_day is null and (updated_at<$2::timestamptz or (updated_at=$2::timestamptz and key>$3))';
     }
     const page=await rows('select key,news_day::text,updated_at::text from public.news_public where visible and ($1::text is null or payload->>\'team\'=$1)'+predicate+' order by '+order+' limit 7',args);
     seen.push(...page);if(page.length<7)break;cursor=page.at(-1);
    }
    assert.deepEqual(seen,expected);assert.equal(new Set(seen.map(x=>x.key)).size,seen.length);assert.ok(seen.some(x=>x.news_day===null));
   }
   const indexes=await rows("select indexname,indexdef from pg_indexes where tablename='news_public' and indexname in ('news_visible_day_cursor','news_visible_club_day_cursor') order by indexname");
   assert.equal(indexes.length,2);assert.ok(indexes.every(x=>x.indexdef.includes('news_day DESC NULLS LAST, updated_at DESC, key')&&x.indexdef.endsWith('WHERE visible')));
   await exec('analyze public.news_public;set local enable_seqscan=off');
   const feedPlan=JSON.stringify(await rows('explain (format json) select key,news_day,updated_at from public.news_public where visible order by '+order+' limit 41'));
   const clubPlan=JSON.stringify(await rows("explain (format json) select key,news_day,updated_at from public.news_public where visible and payload->>'team'='real-madrid' order by "+order+' limit 41'));
   assert.match(feedPlan,/news_visible_day_cursor/);assert.match(clubPlan,/news_visible_club_day_cursor/);
  });
 }finally{await db.close();}
});
