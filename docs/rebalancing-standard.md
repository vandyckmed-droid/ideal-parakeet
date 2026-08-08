# Rebalancing standard

The measurement and rebalance convention for any future feature that re-forms
a list on a schedule. **Nothing in the app currently uses this** — it is
recorded here so the choice is already made if the need arises.

| Frequency | Interval | Measurement date | Rebalance |
| --- | --- | --- | --- |
| Weekly | 5 trading days | Friday close / last trading day of week | Next trading day |
| Monthly | ~21 trading days | Last trading day of month | First trading day of next month |
| Quarterly | ~63 trading days | Last trading day of Mar / Jun / Sep / Dec | First trading day of next quarter |

The pattern in one sentence: measure at the period's final close, act on the
next trading day.
