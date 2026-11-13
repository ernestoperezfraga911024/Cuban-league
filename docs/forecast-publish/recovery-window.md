# Continuing incomplete lineup runs

`recovery-window.sql` adds private, audited recovery runs. It preserves the scheduled windows, source age checks, fixture checks, identities, probability validation, manual mode and paused teams. It never updates public lineups merely by opening a recovery.

Hourly automation first uses the ordinary `plan()` / `begin_run()` flow. When no scheduled window is open, call `forecast_season.resume_incomplete()`. This considers only the latest scheduled run within 24 hours and returns one of:

- A recovery plan containing `run_key`, `recovery_request`, `expires_at`, teams and existing attempts. Its two-hour deadline begins now; source timestamps remain their actual reading times.
- `complete`: every expected team has a terminal result in that run or its recovery lineage. This is not necessarily successful publication; report published, ready and blocked separately.
- `awaiting_delivery`: deliver the listed saved attempts first, using their exact key and existing payload. Set the listed recovery context when present. Only the current draft with fresh evidence and an active recovery context qualifies. Expired, stale or superseded saved records remain audited; the next recovery reads fresh evidence instead of becoming permanently stuck on an undeliverable record.
- `recovery_in_progress`: an explicit recovery already covers pending teams; leave it to its owner.
- `scheduled_window` or `no_recent_run`: follow the returned ordinary plan or leave the lineup module idle.

Only genuinely missing clubs are retried automatically. Published, ready and blocked results are terminal. Recovery lineage prevents the original incomplete run from causing repeated updates forever. A newer scheduled run becomes the scope; an empty targeted window does not certify that all 20 clubs were published. The daily all-team sweep remains the normal next opportunity.

An explicitly requested correction can open a reviewed subset, including already published teams:

```sql
select forecast_season.begin_recovery(
  '<new-request-uuid>'::uuid,
  '<scheduled-source-run>',
  '["team-one", "team-two"]'::jsonb,
  'Concrete reviewed cause and requested correction.',
  false
);
```

The response supplies the actual run key and expiry. Repeat the same UUID and exact request for idempotency; changing the content with that UUID fails. Recovery context is transaction-local and never changes another scheduled worker's plan. Every subsequent team transaction must explicitly select its context:

```sql
begin;
select set_config('forecast_season.recovery_request','<request-uuid>',true);
select forecast_season.register_fixture('<fresh verified fixture JSON>'::jsonb);
select forecast_season.save_draft('<recovery-run-key>','<fresh proposal JSON>'::jsonb);
select forecast_season.deliver('<recovery-run-key>-<team>');
commit;
```

Keep each team end to end. A source or identity issue on one club does not justify marking untouched clubs blocked. A `40001` concurrency error means newer work exists: reread state and preserve that newer work. It is not a source failure.

Call `finish_run(run_key)` after processing. Missing/saved attempts leave `finished_at` empty. `complete` means all expected attempts are terminal; `publication_complete` means all were published. Then verify actual public rows each contain 11 distinct players and current evidence. Opening or finishing a run is never proof that all lineups were published.

All recovery tables/functions remain private, with invoker security and empty search paths. The audit captures the source run, original attempts and previous scoped draft/public payloads. Later drafts or publications supersede an earlier recovery; older evidence cannot overwrite newer evidence through either ordinary or recovery `save_draft` calls.
