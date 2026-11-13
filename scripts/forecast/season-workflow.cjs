'use strict';
const {compile,concreteBlock} = require('./editorial-producer.cjs');
const {isDeepStrictEqual:same} = require('node:util');
const {verifyPublication} = require('./season-gateway.cjs');
// The existing dispatcher opens the run. This runner never creates/reopens a run,
// modifies a schedule/mode, or treats an unfinished review as a terminal block.
async function runSeason({gateway,makeCollector,reviewTeam,onEvent=()=>{}}) {
  let reader, collector, completedLoop=false;
  const rows=[], started = await gateway.state();
  if (!started.run) throw Error('Open the authorized run through its existing dispatcher first');
  const expected = started.run.expected;
  if (!Array.isArray(expected) || expected.length > 20 || new Set(expected).size !== expected.length) throw Error('Invalid expected team set');
  if ((started.recovery?.request_id || null) !== gateway.recoveryRequest) throw Error('Recovery context does not match run');
  const windowStart = started.recovery?.created_at || started.run.slot_at;
  const expiresAt = started.recovery?.expires_at || new Date(Date.parse(windowStart)+7200000).toISOString();
  const notBefore = started.observed_at;
  const terminalRun = started.run.finished_at || started.recovery?.closed_at;
  if (![notBefore,windowStart,expiresAt].every(v=>Number.isFinite(Date.parse(v))) || !terminalRun && (Date.parse(notBefore) < Date.parse(windowStart) || Date.parse(notBefore) >= Date.parse(expiresAt))) throw Error('Outside real database execution window');
  const event = value => onEvent(value);
  try {
    for (const team of expected) {
      let fresh=false, projection;
      try {
        let state = await gateway.state(team), attempt = state.attempts.find(a => a.team === team);
        if (['published','ready','blocked'].includes(attempt?.outcome)) {
          if (attempt.outcome === 'published') {
            // A newer public/draft row may supersede this terminal attempt. Do not
            // claim that old publication is current when its exact projection is gone.
            projection = state.draft?.run_key === gateway.runKey+'-'+team ? state.draft.projection : null;
            verifyPublication(state,team,projection);
          }
          rows.push({team,outcome:attempt.outcome,new_publication:false}); continue;
        }
        if (terminalRun) { rows.push({team,outcome:attempt?.outcome || 'missing',reason:'Run already closed'}); continue; }
        if (attempt && attempt.outcome !== 'saved') throw Error('Unknown attempt state: '+attempt.outcome);
        if (!attempt) {
          const plan = await gateway.plan();
          if (plan.run_key !== gateway.runKey) throw Error('Plan no longer matches run');
          const item = plan.teams.find(t => t.team === team);
          if (!item?.fixture) throw Error('Missing next fixture: requires public calendar review');
          if (!collector) ({reader,collector} = await makeCollector({runKey:gateway.runKey,notBefore,expiresAt}));
          const packet = await collector.collect(item);
          const roster = await gateway.roster(team);
          let review;
          for (let followups=0; ; followups++) {
            review = await reviewTeam({packet,roster,window:{notBefore,expiresAt}});
            if (!review?.follow) break;
            if (followups >= 12) throw Error('Additional reading limit reached; review remains missing');
            await collector.follow(packet,review.follow.from,review.follow.url);
          }
          // Missing semantic work or source failures are reported, never bulk-blocked.
          if (!review || review.deferred) throw Error(review?.reason || 'Editorial review incomplete');
          state = await gateway.state(team);
          if (state.attempts.some(a => a.team === team)) throw Error('Concurrent attempt appeared during reading');
          if (review.failure) {
            const failure=concreteBlock(packet,review.failure),before=state.public;
            await gateway.block(team,failure.reason,failure.checks);
            const after=await gateway.state(team),a=after.attempts.find(a=>a.team===team);
            if (a?.outcome!=='blocked' || !same(before?.payload,after.public?.payload) || before?.published_at!==after.public?.published_at) throw Error('Block preservation could not be verified');
            rows.push({team,outcome:'blocked',new_publication:false,reason:failure.reason});event(rows.at(-1));continue;
          }
          const built = compile(packet,review,roster,{notBefore,expiresAt,observedAt:state.observed_at});
          const validation = await gateway.validate(team,built.fixture,built.payload);
          projection = validation.projection;
          const all = [...built.payload.proposal.players,...built.payload.proposal.candidates];
          if (!projection || validation.scores.length !== all.length || all.some(p => validation.scores.filter(s => s.id === p.id && s.probability === p.probability).length !== 1)) throw Error('Server assessment differs from producer');
          await gateway.save(team,built.payload);
          state = await gateway.state(team);
          if (state.attempts.find(a => a.team === team)?.outcome !== 'saved' || state.draft?.run_key !== gateway.runKey+'-'+team ||
            !state.draft.payload) throw Error('Draft save not verified');
          // Structural comparison, independent of jsonb key order.
          if (!same(state.draft.payload,built.payload) || !same(state.draft.projection,projection)) throw Error('Saved draft differs from validated payload');
          fresh=true;
        } else {
          if (state.draft?.run_key !== gateway.runKey+'-'+team || !state.draft.projection) throw Error('Saved draft superseded');
          projection=state.draft.projection; // Preserve method, dates and payload unchanged.
        }
        await gateway.deliver(team);
        state = await gateway.state(team);
        attempt = state.attempts.find(a => a.team === team);
        if (!['published','ready','blocked'].includes(attempt?.outcome)) throw Error('Delivery did not finish');
        if (attempt.outcome==='ready' && (state.draft?.run_key!==gateway.runKey+'-'+team || !same(state.draft.projection,projection) || !['ready','withdrawn'].includes(state.public?.status))) throw Error('Private ready draft could not be verified');
        const published=verifyPublication(state,team,projection,{fresh,notBefore});
        rows.push({team,outcome:attempt.outcome,new_publication:published,reason:attempt.reason || null});
      } catch (error) {
        const state = await gateway.state(team);
        const a = state.attempts.find(a => a.team === team);
        rows.push({team,outcome:a?.outcome || 'missing',verified:false,new_publication:false,reason:error.message});
      }
      event(rows.at(-1));
    }
    completedLoop=true;
  } finally { reader?.close(); }
  const finish = !terminalRun && completedLoop ? await gateway.finish() : null;
  const finalState = await gateway.state();
  if (gateway.audit) {
    const audit=await gateway.audit();
    // jsonb_agg returns SQL NULL for an empty expected set. That is a valid
    // no-work run, never evidence that a lineup was published.
    if (expected.length===0 && audit.teams===null) audit.teams=[];
    if (!Array.isArray(audit.teams)) throw Error('Final audit did not return team results');
    if (audit.teams.length!==expected.length || new Set(audit.teams.map(a=>a.team)).size!==expected.length || audit.teams.some(a=>!expected.includes(a.team))) throw Error('Final audit does not cover the expected team set');
    for (const row of rows) {
      const a=audit.teams.find(a=>a.team===row.team);
      if (a.outcome!==row.outcome || row.outcome==='published' && !a.public_matches) {
        row.verified=false;row.new_publication=false;row.reason='Estado público o intento cambió antes de la verificación final';
      }
    }
    finalState.observed_at=audit.observed_at;
    finalState.attempts=audit.teams.filter(a=>a.outcome!=='missing');
  }
  const counts = {published:0,ready:0,blocked:0,missing:0,saved:0};
  for (const team of expected) {
    const a=finalState.attempts.find(a => a.team === team);
    if (a && Object.hasOwn(counts,a.outcome)) counts[a.outcome]++; else counts.missing++;
  }
  return {run_key:gateway.runKey,started_at:notBefore,finished_at:finalState.observed_at,expected:expected.length,
    counts,verified_publications:rows.filter(r => r.outcome === 'published' && r.verified !== false).length,
    no_eligible_teams:expected.length===0,
    publication_complete:expected.length>0 && counts.published === expected.length && rows.every(r => r.verified !== false),finish,teams:rows,metrics:reader?.stats() || null};
}
module.exports={runSeason};
