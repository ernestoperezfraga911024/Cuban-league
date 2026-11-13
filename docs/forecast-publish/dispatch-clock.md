# Early dispatch incident and news schedule

Observed on 2026-11-13 (America/New_York): the scheduler event for 14:00 started at 13:55:05 and ended at 13:55:36 with status completed. Neither the 14:00 news run nor the 14:00 lineup run existed when investigated. At 14:27 both database plans offered those runs normally. The clock mismatch explains the missed opening: the news window was not open at 13:55, and the lineup plan still referred to 13:00. The scheduler did not expose a detailed worker result, so its internal reason for the early launch is unknown.

Apply dispatch-clock.sql and prepend dispatch-clock-automation.txt to the existing hourly worker. The private dispatch_gate entry point checks the real database wall clock against the scheduled instant. Early starts wait outside database transactions in chunks of at most 45 seconds, then query both plans anew. Missing schedule context uses a bounded near-hour inference and pins its first result. Late launches use existing recovery. No application bundle, public endpoint, data row, probability formula, permissions grant or external service is added.

The user separately requested moving news from 14:00 to 15:00. Apply ../news/schedule-1500.sql after the coverage migration and use the revised news protocol: 08:00, 11:00 and 15:00 Miami. Lineups remain 06:00/13:00/14:00/18:00. The hourly worker schedule already includes 15:00 and needs no new task. Existing 14:00 audit records remain intact and pending work remains resumable.

Validation: eight focused database checks cover the incident boundary, missing context, late delivery, invalid future contexts, Miami DST, season end, private invoker permissions and preservation of an existing news run. The full suite before the news-schedule addition passed 388/389; the sole failure is the pre-existing catalog hash fixture in editorial-redesign.test.cjs. No catalog files changed.

This guards the worker against early dispatch; it cannot guarantee the scheduler starts precisely on time. A scheduler completed flag never proves publication. Verify actual public rows and coverage ledgers after recovery.
