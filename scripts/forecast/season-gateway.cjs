'use strict';
// execute is the existing connected execute_sql capability, NOT a DB credential.
// Every call is one transaction; recovery context never leaks across calls.
const {isDeepStrictEqual:same} = require('node:util');
const DESTINATION = Object.freeze({link_id:'link_6aad67ea13208191b8315f9bb7f2cce7',project_id:'pyahosamoisqcbpvzwka'});
const literal = value => {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  let tag = '$forecast$';
  while (body.includes(tag)) tag = tag.slice(0,-1) + 'x$';
  return tag + body + tag;
};
class SeasonGateway {
  constructor({execute,runKey,recoveryRequest=null}) {
    if (!/^season-[a-z0-9-]+$/.test(runKey) || recoveryRequest !== null && !/^[a-f0-9-]{36}$/.test(recoveryRequest)) throw Error('Invalid run context');
    this.execute = execute; this.runKey = runKey; this.recoveryRequest = recoveryRequest;
  }
  async query(sql) {
    const query = `BEGIN;\nSELECT set_config('forecast_season.recovery_request',${literal(this.recoveryRequest || '')},true);\n${sql}\nCOMMIT;`;
    // Adapter returns the row named result; rejects transport or SQL errors.
    return this.execute({...DESTINATION,query});
  }
  async state(team=null) {
    return this.query(`SELECT jsonb_build_object('observed_at',clock_timestamp(),'run',(SELECT to_jsonb(r) FROM forecast_season.runs r WHERE key=${literal(this.runKey)}),
      'recovery',(SELECT to_jsonb(q) FROM forecast_season.recovery_requests q WHERE run_key=${literal(this.runKey)}),
      'attempts',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM forecast_season.attempts a WHERE run_key=${literal(this.runKey)}),'[]'::jsonb),
      'draft',(SELECT to_jsonb(d) FROM forecast_season.drafts d WHERE team=${literal(team)}),
      'public',(SELECT to_jsonb(p) FROM public.forecast_season_public p WHERE team=${literal(team)})) AS result;`);
  }
  plan() { return this.query('SELECT forecast_season.plan() AS result;'); }
  roster(team) { return this.query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'team',team) ORDER BY id),'[]'::jsonb) AS result FROM forecast_league.roster WHERE team=${literal(team)};`); }
  guard(team, allowed='missing') {
    if (!/^[a-z0-9-]+$/.test(team)) throw Error('Invalid team ID');
    const attempt = allowed === 'saved' ? `NOT EXISTS(SELECT 1 FROM forecast_season.attempts WHERE key=${literal(this.runKey+'-'+team)} AND outcome='saved')` : `EXISTS(SELECT 1 FROM forecast_season.attempts WHERE run_key=${literal(this.runKey)} AND team=${literal(team)})`;
    return `DO $guard$ BEGIN
      PERFORM 1 FROM forecast_season.control FOR UPDATE;
      PERFORM forecast_season.check_attempt(${literal(this.runKey)},${literal(team)});
      IF ${attempt} THEN RAISE EXCEPTION 'Attempt changed; reread before mutation' USING ERRCODE='40001'; END IF;
      IF EXISTS(SELECT 1 FROM forecast_season.recovery_requests q JOIN forecast_season.runs r ON r.key=q.run_key
        WHERE q.closed_at IS NULL AND q.expires_at>clock_timestamp() AND q.run_key<>${literal(this.runKey)} AND r.expected ? ${literal(team)})
        THEN RAISE EXCEPTION 'Overlapping active recovery' USING ERRCODE='40001'; END IF;
    END $guard$;`;
  }
  async validate(team, fixture, payload) {
    const assessments = [...payload.proposal.players,...payload.proposal.candidates].map(p => ({id:p.id,assessment:p.assessment}));
    return this.query(`${this.guard(team)}
      SELECT forecast_season.register_fixture(${literal(fixture)}::jsonb);
      SELECT jsonb_build_object('scores',(SELECT jsonb_agg(jsonb_build_object('id',x->>'id','probability',forecast_publish.assess(x->'assessment'))) FROM jsonb_array_elements(${literal(assessments)}::jsonb) x),
      'projection',forecast_season.build_team(${literal(payload)}::jsonb,interval '2 hours')) AS result;`);
  }
  save(team,payload) { return this.query(`${this.guard(team)} SELECT forecast_season.save_draft(${literal(this.runKey)},${literal(payload)}::jsonb) AS result;`); }
  deliver(team) { return this.query(`${this.guard(team,'saved')} SELECT forecast_season.deliver(${literal(this.runKey+'-'+team)}) AS result;`); }
  block(team,reason,checks) { return this.query(`${this.guard(team)} SELECT forecast_season.block_team(${literal(this.runKey)},${literal(team)},${literal(reason)},${literal(checks)}::jsonb) AS result;`); }
  audit() { return this.query(`SELECT jsonb_build_object('observed_at',clock_timestamp(),'teams',(
    SELECT jsonb_agg(jsonb_build_object('team',e.team,'outcome',coalesce(a.outcome,'missing'),'public_matches',coalesce(
      a.outcome='published' AND p.status='published' AND p.payload=d.projection AND d.run_key=a.key
      AND p.published_at=a.published_at AND p.published_at>=r.started_at
      AND p.payload->>'fixture_key'=a.fixture_key AND p.payload->>'team'=e.team
      AND jsonb_array_length(p.payload->'players')=11
      AND (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p.payload->'players') x)=11,false)) ORDER BY e.team)
    FROM forecast_season.runs r CROSS JOIN LATERAL jsonb_array_elements_text(r.expected) e(team)
    LEFT JOIN forecast_season.attempts a ON a.run_key=r.key AND a.team=e.team
    LEFT JOIN forecast_season.drafts d ON d.team=e.team LEFT JOIN public.forecast_season_public p ON p.team=e.team
    WHERE r.key=${literal(this.runKey)})) AS result;`); }
  finish() { return this.query(`SELECT forecast_season.finish_run(${literal(this.runKey)}) AS result;`); }
}
function verifyPublication(state,team,projection,{fresh=false,notBefore}={}) {
  const a = state.attempts.find(a => a.team === team), p = state.public;
  if (a?.outcome !== 'published') return false;
  if (!projection || p?.status !== 'published' || !same(p.payload,projection) ||
    p.payload.team !== team || p.payload.fixture_key !== a.fixture_key ||
    Date.parse(p.published_at) !== Date.parse(a.published_at) ||
    !Number.isFinite(Date.parse(p.published_at)) || Date.parse(p.published_at) < Date.parse(state.run.started_at) ||
    p.payload.players?.length !== 11 || new Set(p.payload.players.map(x => x.id)).size !== 11) throw Error(team + ': la fila pública no coincide con la entrega');
  if (fresh && (p.payload.method_version !== 'editorial-v5' || !Array.isArray(p.payload.candidates) ||
    new Set(p.payload.candidates.map(x => x.id)).size !== p.payload.candidates.length ||
    p.payload.candidates.some(x => p.payload.players.some(y => y.id === x.id)) ||
    !Number.isFinite(Date.parse(p.payload.evidence_at)) || Date.parse(p.payload.evidence_at) < Date.parse(notBefore))) throw Error(team + ': publicación nueva sin evidencia/candidatos válidos');
  return true;
}
module.exports = {SeasonGateway,verifyPublication,literal,DESTINATION};
