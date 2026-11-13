-- One-time, user-authorized recovery of an incomplete collector, not a source failure.
-- Execute as one transaction. Expired windows, changed data or a second execution abort.
BEGIN;
DO $recovery$
DECLARE
 target text := 'season-20261113-0600';
 diagnostic text := 'No se completó la resolución segura de todos los candidatos observados contra el catálogo; no se fabricó la propuesta.';
 audit_id uuid := 'bd8eb043-618e-4775-9595-f108186269f3';
 snapshot jsonb;
 public_hash text;
BEGIN
 PERFORM 1 FROM forecast_season.control FOR UPDATE;
 IF forecast_season.plan()->>'run_key' IS DISTINCT FROM target
    OR NOT EXISTS (SELECT 1 FROM forecast_season.control WHERE mode='automatic' AND version=183)
    OR EXISTS (SELECT 1 FROM forecast_season.commands WHERE request_id=audit_id)
    OR NOT EXISTS (SELECT 1 FROM forecast_season.runs WHERE key=target AND jsonb_array_length(expected)=20 AND finished_at='2026-11-13T11:22:11.846308Z')
 THEN RAISE EXCEPTION 'Recovery preconditions changed'; END IF;
 IF (SELECT count(*) FROM forecast_season.attempts WHERE run_key=target)<>20
    OR (SELECT count(*) FROM forecast_season.attempts a JOIN forecast_season.drafts d USING(team)
      WHERE a.run_key=target AND a.outcome='blocked' AND a.reason=diagnostic
      AND a.checked_at='2026-11-13T11:22:07.976329Z' AND a.published_at IS NULL
      AND d.run_key=a.key AND d.outcome='blocked' AND d.reason=diagnostic
      AND d.projection IS NULL AND NOT d.paused)<>20
 THEN RAISE EXCEPTION 'Recovery refuses changed or deliverable attempts'; END IF;
 SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY team)::text) INTO public_hash FROM public.forecast_season_public p;
 SELECT jsonb_build_object(
   'run',(SELECT to_jsonb(r) FROM forecast_season.runs r WHERE key=target),
   'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY team) FROM forecast_season.attempts a WHERE run_key=target),
   'drafts',(SELECT jsonb_agg(to_jsonb(d) ORDER BY team) FROM forecast_season.drafts d WHERE run_key=target||'-'||team),
   'public_hash',public_hash,'control',(SELECT to_jsonb(c) FROM forecast_season.control c)
 ) INTO snapshot;
 INSERT INTO forecast_season.commands(request_id,request,result) VALUES
 (audit_id,jsonb_build_object('action','recover_incomplete_collector','run_key',target,'reason',diagnostic),
 jsonb_build_object('before',snapshot,'reopened',20,'published',0));
 DELETE FROM forecast_season.attempts WHERE run_key=target;
 UPDATE forecast_season.drafts SET run_key=NULL,fixture_key=NULL,payload=NULL,projection=NULL,checked_at=NULL,outcome='pending',reason=NULL
 WHERE run_key=target||'-'||team;
 UPDATE forecast_season.runs SET finished_at=NULL WHERE key=target;
 UPDATE forecast_season.control SET version=version+1;
 IF public_hash IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY team)::text) FROM public.forecast_season_public p)
 THEN RAISE EXCEPTION 'Public data changed during recovery'; END IF;
END;
$recovery$;
COMMIT;
