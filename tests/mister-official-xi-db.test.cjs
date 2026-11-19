const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const migration = 'supabase/migrations/20261119120000_mister_official_xi.sql';

async function setup(db) {
  // Provide the Supabase auth boundary and the builtin SHA256 in the disposable database.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text);
    insert into auth.users(email) values ('ernestoperezfraga911024@gmail.com');
    create function auth.uid() returns uuid language sql as $$select id from auth.users limit 1$$;
    create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
    create function extensions.digest(bytea,text) returns bytea language sql as $$select sha256($1)$$;
  `);
  const files = ['supabase-setup.sql', ...[57,59,65,114,116,124].map(n=>fs.readdirSync(root).find(f=>f.startsWith('SUPABASE-V'+n+'-'))),
    'supabase-v163-negative-balance.sql', 'supabase-v170-cup-mister-order.sql', migration, 'supabase/migrations/20261119170338_official_xi_portraits.sql',
    'supabase/migrations/20261119180500_mister_player_goals.sql'];
  for (const file of files) {
    let sql = read(file);
    if (file.startsWith('SUPABASE-V124')) {
      // Cron setup is unrelated to synchronous save/publish/undo/restore.
      sql = sql.split('do $$\ndeclare\n  existing_job record;')[0].replace(/^create extension[^;]*;/gm,'') + '\ncommit;';
    }
    await db.exec(sql);
  }
}

test('Mister XI follows real V124 draft, publish, correction, undo and backup restore', async()=>{
  const db = new PGlite();
  const one = async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  try {
    await setup(db);
    const xi = {season:'2026/27', leagueId:'649733', matchday:11, gameweekId:4052,
      players:['PT','DF','DF','DF','MC','MC','MC','MC','MC','DL','DL'].map((position,i)=>({
        misterPlayerId:String(300+i), playerId:'player-'+i, playerName:'Jugador '+i, position, points:10+i
      }))};
    const rows = [{participant_name:'Ernesto',points:91,goals:1,clean_sheets:0,red_cards:0,
      lineup:xi.players.map((p,i)=>({player_id:i===3?'otro':p.playerId,player_name:p.playerName,club_id:'club',
        club_name:'Club',slot_number:i+1,position:p.position,displayed_points:8,is_captain:i===10,captain_multiplier:i===10?2:1}))}];
    const get = async()=> (await one("select public.get_published_official_xi('2026/27',11) as xi")).xi;
    const state = async()=>one("select restore_generation, data_revision, (select write_revision from private.matchday_write_state where season='2026/27' and matchday=11) as revision from private.league_backup_state");
    const rpc = async (name, snapshot, revision) => {
      const current = await state();
      const args = ['2026/27',11,JSON.stringify(rows),true,'2026-11-01',false,false,current.restore_generation,
        revision===undefined ? current.revision : revision];
      if(snapshot)args.push(JSON.stringify(snapshot));
      return (await one('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).result;
    };
    const save = (x,revision)=>rpc('save_matchday_draft_with_official_xi',x,revision);
    const publish = ()=>rpc('publish_matchday_revision_v124');
    const backup = async()=> (await one("select private.capture_league_backup('manual',null) as id")).id;
    const restore = async id=>{
      const s=await state();
      await one("select public.restore_league_backup($1,'RESTAURAR',$2,$3)",[id,s.restore_generation,s.data_revision]);
    };
    const old = await backup();
    assert.equal(await get(),null);
    await assert.rejects(save({...xi,matchday:12}),/context/);
    await assert.rejects(save({...xi,players:xi.players.slice(1)}),/players/);
    await db.exec('set role anon');
    assert.equal(await get(),null);
    await assert.rejects(db.query("select public.save_matchday_draft_with_official_xi(null,null,null,null,null,null,null,null,null,null)"),/permission denied/);
    await db.exec('reset role');
    await save(xi);
    const draftBackup = await backup();
    assert.equal(await get(),null);
    await assert.rejects(save(xi,null),/revision changed/i);
    await rpc('save_matchday_draft_v124');
    await publish();
    let publicXi=await get();
    assert.equal(publicXi.length,11);
    assert.deepEqual(publicXi[3].participants,[]);
    assert.deepEqual(publicXi[10],{playerId:'player-10',misterPlayerId:'310',position:'DL',playerName:'Jugador 10',points:20,participants:['Ernesto']});
    const confirmed = await backup();
    await db.exec('set role anon');
    assert.deepEqual(await get(),publicXi);
    await db.exec('reset role');
    // A correction imported with an older client keeps the official choices and follows the revised historical XI.
    rows[0].lineup[3].player_id='player-3';
    await rpc('save_matchday_draft_v124');
    await publish();
    assert.deepEqual((await get())[3].participants,['Ernesto']);
    const corrected = structuredClone(xi);
    corrected.players[0].points=18;
    await save(corrected);
    await publish();
    assert.equal((await get())[0].points,18);
    const latest=await one('select id from public.matchday_change_log where not undone order by created_at desc,id desc limit 1');
    const s=await state();
    await one("select public.undo_last_matchday_publication_v124('2026/27',11,$1,$2,$3)",[s.restore_generation,s.revision,latest.id]);
    assert.equal((await get())[0].points,10);
    await restore(draftBackup);
    assert.equal(await get(),null);
    rows.splice(0,rows.length,...(await db.query("select * from public.matchday_drafts where season='2026/27' and matchday=11")).rows);
    await publish();
    assert.deepEqual(await get(),publicXi);
    await restore(old);
    assert.equal(await get(),null);
    await restore(confirmed);
    assert.deepEqual(await get(),publicXi);
  } finally { await db.close(); }
});

test('individual goals survive draft backups, older clients and partial reimports, and follow publication and undo',async()=>{
  const db=new PGlite();
  try {
    await setup(db);
    const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
    const generation=await scalar('select restore_generation from private.league_backup_state');
    const lineup=['PT','DF','DF','DF','MC','MC','MC','MC','DL','DL','DL'].map((position,i)=>({
      position,slot_number:i+1,player_id:'p'+i,player_name:'Jugador '+i,club_id:'club',club_name:'Club',
      displayed_points:4,is_captain:i===10,captain_multiplier:i===10?2:1
    }));
    const rows=[{participant_name:'Ernesto',points:44,goals:5,clean_sheets:0,red_cards:0,lineup}];
    const rev=async()=> (await db.query("select write_revision from private.matchday_write_state where season='2026/27' and matchday=12")).rows[0]?.write_revision||null;
    const run=async(name,packet)=>{
      const gen=await scalar('select restore_generation from private.league_backup_state');
      const args=['2026/27',12,JSON.stringify(rows),true,'2026-11-01',false,false,gen,await rev()];
      if(packet)args.push(JSON.stringify(packet));
      return scalar('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
    };
    const ctx={season:'2026/27',matchday:12,gameweekId:4053,leagueId:'649733'};
    const save=players=>run('save_matchday_draft_with_player_goals',{...ctx,players});
    const publish=()=>run('publish_matchday_revision_v124');
    const get=()=>scalar("select (select public.player_goals(s) from public.matchday_stats s where published limit 1)");
    await assert.rejects(run('save_matchday_draft_with_player_goals',{...ctx,matchday:11,players:{p0:1}}),/context/);
    await assert.rejects(save({p0:null}),/Invalid player goals/);
    await save({p0:2,p3:0,p10:3});
    assert.equal(await get(),null);
    const backup=await scalar("select private.capture_league_backup('manual',null)");
    await run('save_matchday_draft_v124');
    await publish();
    const expected={p0:2,p3:0,p10:3};
    await db.exec('set role anon');
    assert.deepEqual(await get(),expected);
    await assert.rejects(db.exec('select public.save_matchday_draft_with_player_goals(null,null,null,null,null,null,null,null,null,null)'),/permission denied/);
    await db.exec('reset role');
    await save({p10:0}); // A genuine correction, followed by an incomplete reread.
    await save({p4:1});
    assert.deepEqual(await get(),expected);
    await publish();
    assert.deepEqual(await get(),{...expected,p4:1,p10:0});
    assert.equal(await scalar("select goals from public.matchday_stats where published"),5);
    const id=await scalar('select id from public.matchday_change_log where not undone order by created_at desc,id desc limit 1');
    await scalar("select public.undo_last_matchday_publication_v124('2026/27',12,$1,$2,$3)",[generation,await rev(),id]);
    assert.deepEqual(await get(),expected);
    const dataRevision=await scalar('select data_revision from private.league_backup_state');
    await scalar("select public.restore_league_backup($1,'RESTAURAR',$2,$3)",[backup,generation,dataRevision]);
    assert.equal(await get(),null);
    await publish();
    assert.deepEqual(await get(),expected);
  } finally {await db.close();}
});
