# Player source explanations

`source-summary.sql` adds a small `source_summary` to the public projection of each evaluated starter and candidate. It copies only source ID, observed prediction, raw percentage and Predicted11 votes/complete ballots. The existing builder validates the assessment against the saved evidence before this projection. It never publishes internal reasons, author records or the entire draft.

The shared public/admin renderer displays these observations above the health context. Missing source percentages stay qualitative; they are not replaced with the editorial model's fallback. Legacy payloads without the field retain their original reason. The weights below are explicitly labelled as calculation weights.

Deployment order:

1. Apply `source-summary.sql` through the migration tool (guarded function version).
2. Preview `build_team(payload, interval '24 hours')` against current drafts and check that removing `source_summary` yields exactly the saved projection.
3. Run `source-summary-refresh.sql` in one transaction. It locks matching current draft/public pairs, validates them and aborts if any other field would change. Dates, raw evidence and historical records are untouched. This is a one-time refresh, not a scheduled job.
4. Deploy the renderer and cache v227. Older renderer versions safely ignore the extra field.

Rollback: `source-summary-rollback.sql` restores the exact previous builder only if its reviewed hash still matches. Revert the frontend commit if needed. Existing summaries are harmless and are retained; no forecast data needs to be deleted.

Verification on 2026-11-14: all 20 matching current publications received summaries (220 starters, 76 candidates). Removing only the new field reproduced the original public payload hashes for every team. All draft data and publication metadata hashes also remained identical. The `catalog/players.json` hash assertion in the full test suite was already failing before this change; the catalogue itself is unchanged.
