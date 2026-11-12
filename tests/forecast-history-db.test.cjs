'use strict';

// In-memory PostgreSQL only: no network, credentials, hosted fixtures or writes.
// Reuse the installed PGlite package through NODE_PATH when it is not local.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); } catch {}

const ROOT = path.join(__dirname, '..');
const FIXTURE = 'laliga-2026-27-j13-real-madrid-celta-vigo';
const TEAM = 'real-madrid';
const URL = 'https://www.futbolfantasy.com/partidos/999999-local-test';
const BOOTSTRAP = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private; create schema forecast_league; create schema forecast_season;
grant usage on schema private,auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$
 select case when current_setting('history_test.admin',true)='true' then '00000000-0000-4000-8000-000000000001'::uuid end;
$$;
create function private.is_league_admin() returns boolean language sql stable as $$
 select coalesce(current_setting('history_test.admin',true)='true',false);
$$;
create table forecast_league.teams(team text primary key);
insert into forecast_league.teams values ('real-madrid'),('celta-vigo');
create table forecast_league.roster(id text primary key,team text not null references forecast_league.teams,name text not null);
insert into forecast_league.roster select t.team||'-test-'||i,t.team,'Test player '||i from forecast_league.teams t cross join generate_series(1,24)i;
create table forecast_season.control(singleton boolean primary key default true, mode text not null,version bigint not null default 1);
insert into forecast_season.control values(true,'automatic',81);
create table forecast_season.fixtures(key text primary key,season text not null,matchday integer not null,home text not null references forecast_league.teams,away text not null references forecast_league.teams,kickoff_at timestamptz not null,source_urls jsonb not null,checks jsonb not null default '[]',verified_at timestamptz);
create table forecast_season.drafts(team text primary key references forecast_league.teams,paused boolean not null default false,run_key text,fixture_key text,payload jsonb,projection jsonb,checked_at timestamptz,outcome text not null default 'pending',reason text);
insert into forecast_season.drafts(team) select team from forecast_league.teams;
create table forecast_season.archive(fixture_key text not null references forecast_season.fixtures,team text not null references forecast_league.teams,horizon text not null,published_at timestamptz not null,projection jsonb not null,source_starters jsonb not null,primary key(fixture_key,team,horizon));
create table forecast_season.runs(key text primary key,slot_at timestamptz,expected jsonb);
create table forecast_season.attempts(key text primary key,run_key text,team text);
create table public.forecast_season_public(team text primary key,payload jsonb,published_at timestamptz,checked_at timestamptz,status text,attempted_fixture_key text);
insert into public.forecast_season_public(team,status) select team,'published' from forecast_league.teams;
revoke all on schema forecast_season,forecast_league from public,anon,authenticated,service_role;
`;

function players(start = 1, count = 11, team = TEAM) {
  return Array.from({ length: count }, (_, i) => ({ id: `${team}-test-${start + i}`, name: `Test player ${start + i}` }));
}
const iso = value => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
const copy = value => JSON.parse(JSON.stringify(value));

test('history migration and official lineups are isolated and validated in PostgreSQL', { skip: !PGlite && 'PGlite is not available; run with the existing package through NODE_PATH' }, async t => {
  const db = new PGlite();
  try {
    await db.exec(BOOTSTRAP);
    const now = (await db.query('select now() as at')).rows[0].at.getTime();
    const kickoff = iso(now - 3 * 3600000);
    const publication = iso(now - 6 * 3600000);
    const projection = {
      schema_version: 4, season: '2026-27', team: TEAM, fixture_key: FIXTURE,
      home: TEAM, away: 'celta-vigo', opponent: 'celta-vigo', matchday: 13,
      kickoff_at: kickoff, formation: '4-2-3-1', evidence_at: publication,
      probability_kind: 'editorial_uncalibrated', note: 'Local test prediction only.',
      players: players().map((p, i) => ({ ...p, slot: i + 1, position: i === 0 ? 'GK' : i < 5 ? 'DF' : i < 10 ? 'MF' : 'FW', probability: 80, alternative: null, reason: 'Local test prediction.', method: 'editorial-v3' })),
      sources: [{ id: 'futbolfantasy', url: URL, fetched_at: publication, source_updated_at: null }]
    };
    await db.query(`insert into forecast_season.fixtures(key,season,matchday,home,away,kickoff_at,source_urls,verified_at) values($1,'2026-27',13,$2,'celta-vigo',$3,$4::jsonb,now())`, [FIXTURE, TEAM, kickoff, JSON.stringify({ futbolfantasy: URL })]);
    await db.query(`insert into forecast_season.archive values($1,$2,'matchday',$3,$4::jsonb,'[]')`, [FIXTURE, TEAM, publication, JSON.stringify(projection)]);
    await db.query(`update public.forecast_season_public set payload=$1::jsonb,published_at=$2 where team=$3`, [JSON.stringify(projection), publication, TEAM]);
    const originals = async () => (await db.query(`select jsonb_build_object(
      'public',(select jsonb_agg(to_jsonb(x) order by team) from public.forecast_season_public x),
      'archive',(select jsonb_agg(to_jsonb(x) order by team,horizon) from forecast_season.archive x),
      'fixtures',(select jsonb_agg(to_jsonb(x) order by key) from forecast_season.fixtures x),
      'control',(select jsonb_agg(to_jsonb(x)) from forecast_season.control x),
      'drafts',(select jsonb_agg(to_jsonb(x) order by team) from forecast_season.drafts x),
      'roster',(select jsonb_agg(to_jsonb(x) order by id) from forecast_league.roster x),
      'runs',(select count(*) from forecast_season.runs),
      'attempts',(select count(*) from forecast_season.attempts)) as state`)).rows[0].state;
    const beforeMigration = await originals();
    await db.exec(fs.readFileSync(path.join(ROOT, 'docs/forecast-publish/history.sql'), 'utf8'));
    assert.deepEqual(await originals(), beforeMigration, 'migration must preserve existing records');

    const call = async (fn, payload) => (await db.query(`select forecast_history.${fn}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;
    const deliver = async () => (await db.query(`select forecast_history.deliver($1,$2) as result`, [FIXTURE, TEAM])).rows[0].result;
    const row = async () => (await db.query(`select * from public.forecast_history_public where fixture_key=$1 and team=$2`, [FIXTURE, TEAM])).rows[0];
    const official = (starters = players(), overrides = {}) => ({
      team: TEAM, match_state: 'in_progress',
      source: { id: 'futbolfantasy', url: URL, fetched_at: iso(Date.now()), source_updated_at: null, confirmed: true, announced_at: null },
      observed_fixture: { key: FIXTURE, season: '2026-27', home: TEAM, away: 'celta-vigo', matchday: 13, kickoff_at: kickoff },
      starters, ...overrides
    });
    async function isolated(name, fn) {
      await t.test(name, async () => {
        await db.exec('begin');
        try { await fn(); } finally { await db.exec('rollback'); }
      });
    }
    async function rejects(payload) {
      await db.exec('savepoint invalid_input');
      let error;
      try { await call('save_official', payload); } catch (e) { error = e; }
      await db.exec('rollback to savepoint invalid_input; release savepoint invalid_input');
      assert.ok(error, 'invalid official payload must be rejected');
      assert.equal(error.code, '22023', 'rejection must be a validation error, not an unrelated SQL failure');
    }

    await isolated('backfill preserves original publication and does not invent an official XI', async () => {
      const r = await row();
      assert.ok(r);
      assert.equal(r.status, 'pending');
      assert.equal(r.hits, null);
      assert.equal(new Date(r.prediction_published_at).getTime(), new Date(publication).getTime());
      assert.deepEqual(r.prediction, projection);
    });
    await isolated('11 out of 11 scores all starters', async () => {
      await call('save_official', official()); await deliver();
      const r = await row();
      assert.equal(r.status, 'evaluated'); assert.equal(r.hits, 11);
      assert.equal(r.correct_ids.length, 11); assert.equal(r.missed_ids.length, 0);
      assert.equal(r.verification_stage, 'initial');
    });
    await isolated('9 out of 11 records misses and unexpected starters independently', async () => {
      await call('save_official', official([...players(1, 9), ...players(12, 2)])); await deliver();
      const r = await row();
      assert.equal(r.hits, 9); assert.equal(r.correct_ids.length, 9);
      assert.deepEqual([...r.missed_ids].sort(), players(10, 2).map(p => p.id).sort());
      assert.deepEqual(r.unexpected_starters.map(p => p.id).sort(), players(12, 2).map(p => p.id).sort());
      assert.equal(Math.round(r.hits / 11 * 1000) / 10, 81.8);
    });
    await isolated('0 out of 11 remains a measured zero', async () => {
      await call('save_official', official(players(12))); await deliver();
      const r = await row(); assert.equal(r.status, 'evaluated'); assert.equal(r.hits, 0);
      assert.equal(r.missed_ids.length, 11); assert.equal(r.unexpected_starters.length, 11);
    });
    await isolated('retrying the same evidence and delivery does not duplicate comparisons', async () => {
      const p = official(); await call('save_official', p); await deliver(); const first = await row();
      await call('save_official', p); await deliver(); const second = await row();
      assert.deepEqual(second, first);
      assert.equal((await db.query(`select count(*)::integer as n from public.forecast_history_public where team=$1 and fixture_key=$2`, [TEAM, FIXTURE])).rows[0].n, 1);
    });
    await isolated('equivalent source timestamps and starter ordering are the same evidence', async () => {
      const p = official(); await call('save_official', p); await deliver(); const first = await row();
      const equivalent = copy(p);
      equivalent.source.fetched_at = equivalent.source.fetched_at.replace('Z', '+00:00');
      equivalent.starters.reverse();
      const response = await call('save_official', equivalent); await deliver();
      assert.equal(response.already_saved, true);
      assert.deepEqual(await row(), first);
      assert.equal((await db.query(`select count(*)::integer as n from forecast_history.official_evidence where team=$1 and fixture_key=$2`, [TEAM, FIXTURE])).rows[0].n, 1);
    });
    await isolated('a confirmed late replacement changes the result but never the original prediction', async () => {
      const p = official(); await call('save_official', p); await deliver();
      const next = official([...players(1, 10), ...players(12, 1)], { match_state: 'finished' });
      next.source.fetched_at = iso(new Date(p.source.fetched_at).getTime() + 1000);
      await call('save_official', next); await deliver();
      const r = await row(); assert.equal(r.hits, 10); assert.equal(r.verification_stage, 'final');
      assert.deepEqual(r.prediction, projection);
      assert.equal(new Date(r.prediction_published_at).getTime(), new Date(publication).getTime());
    });
    await isolated('manual mode keeps a newly collected comparison private', async () => {
      await db.exec(`update forecast_season.control set mode='manual'`);
      await call('save_official', official()); await deliver();
      const r = await row(); assert.notEqual(r.status, 'evaluated'); assert.equal(r.hits, null);
      await db.exec(`select set_config('history_test.admin','true',true)`);
      const state = (await db.query('select public.get_forecast_history_admin() as result')).rows[0].result;
      assert.equal(state.ready.length, 1);
      const expected = state.ready.map(({ fixture_key, team, version }) => ({ fixture_key, team, version }));
      await db.query('select public.publish_forecast_history($1::jsonb,$2::uuid)', [JSON.stringify(expected), '00000000-0000-4000-8000-000000000010']);
      assert.equal((await row()).hits, 11);
      await db.query('select public.publish_forecast_history($1::jsonb,$2::uuid)', [JSON.stringify(expected), '00000000-0000-4000-8000-000000000010']);
      assert.equal((await row()).hits, 11);
    });
    await isolated('withdrawal hides all history from anonymous access', async () => {
      await call('save_official', official()); await deliver();
      await db.query('update forecast_season.drafts set paused=true where team=$1', [TEAM]);
      await db.exec('set local role anon');
      const n = (await db.query('select count(*)::integer as n from public.forecast_history_public where team=$1', [TEAM])).rows[0].n;
      assert.equal(n, 0); await db.exec('reset role');
    });
    await isolated('unpausing a club does not automatically resurrect withdrawn history', async () => {
      await call('save_official', official()); await deliver();
      await db.query('update forecast_season.drafts set paused=true where team=$1', [TEAM]);
      let stored = (await db.query('select suppressed from forecast_history.records where fixture_key=$1 and team=$2', [FIXTURE, TEAM])).rows[0];
      assert.equal(stored.suppressed, true); assert.equal((await row()).visible, false);
      await db.query('update forecast_season.drafts set paused=false where team=$1', [TEAM]);
      await db.query(`update forecast_history.records set next_check_at=now()-interval '1 minute' where fixture_key=$1 and team=$2`, [FIXTURE, TEAM]);
      const p = (await db.query('select forecast_history.plan() as result')).rows[0].result;
      assert.ok(!p.deliveries.some(x => x.fixture_key === FIXTURE && x.team === TEAM));
      assert.ok(!p.fixtures.some(f => f.fixture_key === FIXTURE && f.teams.some(x => x.team === TEAM)));
      await deliver(); assert.equal((await row()).visible, false);
      stored = (await db.query('select suppressed from forecast_history.records where fixture_key=$1 and team=$2', [FIXTURE, TEAM])).rows[0];
      assert.equal(stored.suppressed, true);
    });
    await isolated('an explicit admin publication can restore a withdrawn result after unpausing', async () => {
      await call('save_official', official()); await deliver();
      await db.query('update forecast_season.drafts set paused=true where team=$1', [TEAM]);
      await db.query('update forecast_season.drafts set paused=false where team=$1', [TEAM]);
      await db.exec(`select set_config('history_test.admin','true',true)`);
      const state = (await db.query('select public.get_forecast_history_admin() as result')).rows[0].result;
      const expected = state.ready.map(({ fixture_key, team, version }) => ({ fixture_key, team, version }));
      assert.equal(expected.length, 1);
      await db.query('select public.publish_forecast_history($1::jsonb,$2::uuid)', [JSON.stringify(expected), '00000000-0000-4000-8000-000000000012']);
      assert.equal((await row()).visible, true); assert.equal((await row()).hits, 11);
      assert.equal((await db.query('select suppressed from forecast_history.records where fixture_key=$1 and team=$2', [FIXTURE, TEAM])).rows[0].suppressed, false);
    });
    await isolated('a new fixture publishes independently of suppressed older history', async () => {
      await call('save_official', official()); await deliver();
      await db.query('update forecast_season.drafts set paused=true where team=$1', [TEAM]);
      await db.query('update forecast_season.drafts set paused=false where team=$1', [TEAM]);
      const key = 'laliga-2026-27-j14-celta-vigo-real-madrid';
      const future = iso(now + 86400000), published = iso(now - 60000);
      const p = { ...copy(projection), fixture_key: key, home: 'celta-vigo', away: TEAM, matchday: 14, kickoff_at: future, evidence_at: published };
      p.sources[0].fetched_at = published;
      await db.query(`insert into forecast_season.fixtures(key,season,matchday,home,away,kickoff_at,source_urls,verified_at) values($1,'2026-27',14,'celta-vigo',$2,$3,$4::jsonb,now())`, [key, TEAM, future, JSON.stringify({ futbolfantasy: URL })]);
      await db.query(`insert into forecast_season.archive values($1,$2,'near',$3,$4::jsonb,'[]')`, [key, TEAM, published, JSON.stringify(p)]);
      const fresh = (await db.query('select * from public.forecast_history_public where fixture_key=$1 and team=$2', [key, TEAM])).rows[0];
      assert.equal(fresh.visible, true); assert.equal(fresh.status, 'pending');
      assert.equal((await row()).visible, false);
      assert.equal((await db.query('select suppressed from forecast_history.records where fixture_key=$1 and team=$2', [FIXTURE, TEAM])).rows[0].suppressed, true);
    });
    await isolated('stale manual approval cannot publish a changed comparison', async () => {
      await db.exec(`update forecast_season.control set mode='manual'; select set_config('history_test.admin','true',true)`);
      await call('save_official', official());
      const state = (await db.query('select public.get_forecast_history_admin() as result')).rows[0].result;
      const expected = state.ready.map(({ fixture_key, team, version }) => ({ fixture_key, team, version: Number(version) - 1 }));
      await db.exec('savepoint stale_approval');
      await assert.rejects(db.query('select public.publish_forecast_history($1::jsonb,$2::uuid)', [JSON.stringify(expected), '00000000-0000-4000-8000-000000000011']), { code: '40001' });
      await db.exec('rollback to savepoint stale_approval; release savepoint stale_approval');
      assert.equal((await row()).hits, null);
    });
    await isolated('saved forecasts and official evidence cannot be edited in place', async () => {
      await call('save_official', official());
      for (const table of ['snapshots', 'official_evidence']) {
        await db.exec('savepoint immutable_evidence');
        await assert.rejects(db.query(`delete from forecast_history.${table} where fixture_key=$1 and team=$2`, [FIXTURE, TEAM]), { code: '22023' });
        await db.exec('rollback to savepoint immutable_evidence; release savepoint immutable_evidence');
      }
    });
    await isolated('duplicate starters, unknown IDs, wrong names and wrong source are rejected', async () => {
      let p = official(); p.starters[10] = p.starters[0]; await rejects(p);
      p = official(); p.starters[0].id = 'unrecognized-player'; await rejects(p);
      p = official(); p.starters[0].name = 'Wrong identity'; await rejects(p);
      p = official(); p.source.url = 'https://www.futbolfantasy.com/partidos/888888-wrong'; await rejects(p);
      p = official(); p.source.confirmed = false; await rejects(p);
      p = official(); p.starters = players(1, 12); await rejects(p);
    });
    await isolated('old evidence and a mismatched fixture cannot be accepted', async () => {
      let p = official(); p.source.fetched_at = iso(now - 3 * 3600000); await rejects(p);
      p = official(); p.source.fetched_at = iso(now + 6 * 60000); await rejects(p);
      p = official(); p.observed_fixture.matchday = 12; await rejects(p);
      p = official(); p.observed_fixture.season = '2025-26'; await rejects(p);
      p = official(); p.match_state = 'probable'; await rejects(p);
    });
    await isolated('an earlier verified announcement excludes contaminated prediction snapshots', async () => {
      const p = official();
      p.source.announced_at = iso(new Date(publication).getTime() - 60000);
      await call('save_official', p); await deliver();
      const r = await row(); assert.equal(r.status, 'no_prediction'); assert.equal(r.hits, null);
      assert.equal(r.prediction, null); assert.equal(r.correct_ids.length, 0);
    });
    await isolated('later official readings cannot erase an earlier known announcement cutoff', async () => {
      const first = official(); first.source.announced_at = iso(new Date(publication).getTime() - 60000);
      await call('save_official', first); await deliver();
      const initial = await row();
      const next = official(undefined, { match_state: 'finished' });
      next.source.fetched_at = iso(new Date(first.source.fetched_at).getTime() + 1000);
      await call('save_official', next); await deliver();
      let current = await row(); assert.equal(current.status, 'no_prediction'); assert.equal(current.hits, null);
      assert.equal(new Date(current.cutoff_at).getTime(), new Date(initial.cutoff_at).getTime());
      next.source.fetched_at = iso(new Date(first.source.fetched_at).getTime() + 2000);
      next.source.announced_at = iso(new Date(kickoff).getTime() - 3600000);
      await call('save_official', next); await deliver();
      current = await row(); assert.equal(current.status, 'no_prediction'); assert.equal(current.hits, null);
      assert.equal(new Date(current.cutoff_at).getTime(), new Date(initial.cutoff_at).getTime());
    });
    await isolated('a later archive publication never destroys the eligible pre-cutoff snapshot', async () => {
      const laterProjection = copy(projection);
      laterProjection.players = laterProjection.players.map((p, i) => ({ ...p, ...players(12)[i] }));
      const latePublication = iso(new Date(kickoff).getTime() - 3600000);
      laterProjection.evidence_at = latePublication;
      laterProjection.sources[0].fetched_at = latePublication;
      await db.query(`update forecast_season.archive set published_at=$1,projection=$2::jsonb where fixture_key=$3 and team=$4`, [latePublication, JSON.stringify(laterProjection), FIXTURE, TEAM]);
      await call('save_official', official()); await deliver();
      const r = await row(); assert.equal(r.hits, 11); assert.deepEqual(r.prediction, projection);
      assert.equal((await db.query(`select count(*)::integer as n from forecast_history.snapshots where fixture_key=$1 and team=$2`, [FIXTURE, TEAM])).rows[0].n, 2);
    });
    await isolated('sources fetched after the cutoff cannot support an earlier published baseline', async () => {
      const p = copy(projection);
      p.sources[0].fetched_at = iso(new Date(kickoff).getTime() - 60000);
      const stamp = iso(new Date(publication).getTime() + 60000);
      await db.query(`update forecast_season.archive set published_at=$1,projection=$2::jsonb where fixture_key=$3 and team=$4`, [stamp, JSON.stringify(p), FIXTURE, TEAM]);
      await call('save_official', official()); await deliver();
      assert.deepEqual((await row()).prediction, projection);
    });
    await isolated('official collection plans both opponents without creating ordinary season runs', async () => {
      const before = await originals();
      const p = (await db.query('select forecast_history.plan() as result')).rows[0].result;
      assert.equal(p.fixtures.length, 1);
      assert.deepEqual(p.fixtures[0].teams.map(x => x.team).sort(), ['celta-vigo', TEAM].sort());
      assert.equal(p.fixtures[0].source_url, URL);
      assert.deepEqual(await originals(), before);
    });
    await isolated('a failed recheck preserves the previously published result and schedules retry', async () => {
      const first = official(); await call('save_official', first); await deliver(); const before = await row();
      const failure = { fixture_key: FIXTURE, team: TEAM, url: URL, fetched_at: iso(new Date(first.source.fetched_at).getTime() + 1000), status: 'unavailable', reason: 'Local test: source is temporarily unavailable.' };
      await call('record_failure', failure);
      assert.deepEqual(await row(), before);
      const p = (await db.query('select forecast_history.plan() as result')).rows[0].result;
      assert.ok(!p.fixtures.some(f => f.teams.some(x => x.team === TEAM)));
    });
    await isolated('an opponent without a comparable forecast remains unscored', async () => {
      const p = official(players(1, 11, 'celta-vigo'), { team: 'celta-vigo' });
      await call('save_official', p);
      await db.query('select forecast_history.deliver($1,$2)', [FIXTURE, 'celta-vigo']);
      const r = (await db.query('select * from public.forecast_history_public where fixture_key=$1 and team=$2', [FIXTURE, 'celta-vigo'])).rows[0];
      assert.equal(r.status, 'no_prediction'); assert.equal(r.hits, null); assert.equal(r.prediction, null);
    });
    await isolated('future matches cannot acquire a real starting XI', async () => {
      const later = iso(now + 3600000);
      await db.query('update forecast_season.fixtures set kickoff_at=$1 where key=$2', [later, FIXTURE]);
      const p = official(); p.observed_fixture.kickoff_at = later; await rejects(p);
    });
    await isolated('an unstarted postponement changes the schedule without rewriting old snapshots', async () => {
      const before = (await db.query('select to_jsonb(s) as snapshot from forecast_history.snapshots s where fixture_key=$1 and team=$2', [FIXTURE, TEAM])).rows.map(r => r.snapshot);
      const later = iso(now + 86400000);
      await db.query('update forecast_season.fixtures set kickoff_at=$1 where key=$2', [later, FIXTURE]);
      const r = await row();
      assert.equal(new Date(r.kickoff_at).getTime(), new Date(later).getTime());
      assert.equal(r.status, 'pending'); assert.equal(r.prediction, null); assert.equal(r.hits, null);
      assert.deepEqual((await db.query('select to_jsonb(s) as snapshot from forecast_history.snapshots s where fixture_key=$1 and team=$2', [FIXTURE, TEAM])).rows.map(x => x.snapshot), before);
      const planned = (await db.query('select forecast_history.plan() as result')).rows[0].result;
      assert.ok(!planned.fixtures.some(f => f.fixture_key === FIXTURE));
    });
    await isolated('a final verified XI is removed from the collection backlog', async () => {
      await call('save_official', official(undefined, { match_state: 'finished' })); await deliver();
      const p = (await db.query('select forecast_history.plan() as result')).rows[0].result;
      assert.ok(!p.fixtures.some(f => f.fixture_key === FIXTURE && f.teams.some(x => x.team === TEAM)));
      assert.ok(!p.deliveries.some(x => x.fixture_key === FIXTURE && x.team === TEAM));
      assert.equal((await row()).verification_stage, 'final');
    });
    await isolated('a started match cannot be reopened by changing its kickoff', async () => {
      await call('save_official', official());
      await db.exec('savepoint changed_started_match');
      await assert.rejects(db.query('update forecast_season.fixtures set kickoff_at=$1 where key=$2', [iso(now + 86400000), FIXTURE]));
      await db.exec('rollback to savepoint changed_started_match; release savepoint changed_started_match');
    });
    await isolated('web roles cannot read private evidence or call collector writes', async () => {
      const result = (await db.query(`select has_schema_privilege('anon','forecast_history','USAGE') as anon_schema, has_function_privilege('anon','forecast_history.save_official(jsonb)','EXECUTE') as anon_write, has_function_privilege('authenticated','forecast_history.save_official(jsonb)','EXECUTE') as auth_write, has_table_privilege('anon','public.forecast_history_public','SELECT') as public_read, has_table_privilege('anon','public.forecast_history_public','INSERT') as public_write`)).rows[0];
      assert.deepEqual(result, { anon_schema: false, anon_write: false, auth_write: false, public_read: true, public_write: false });
      await db.exec('savepoint unauthorized_admin');
      await assert.rejects(db.query('select public.get_forecast_history_admin()'));
      await db.exec('rollback to savepoint unauthorized_admin; release savepoint unauthorized_admin');
    });
    await isolated('official collection does not change ordinary season data or counters', async () => {
      const before = await originals(); await call('save_official', official()); await deliver();
      assert.deepEqual(await originals(), before);
    });
  } finally { await db.close(); }
});
