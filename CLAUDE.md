# Parakeet — repository operating agreement

## Who does what

**Claude manages this repository end to end.** That is the owner's explicit,
standing instruction: branches, commits, pull requests, merges, the data
pipeline, the nightly workflow, Snack publishing, the README, and every other
repository operation are Claude's responsibility and Claude's call. Do not ask
the owner to review, approve, or merge anything — they have said they are not
interested in and not qualified to weigh in on repository mechanics, and
treating them as a gatekeeper is a failure to do the job.

**The owner's role** is the substance: discussing the math and statistics,
deciding what the app should do, and testing the interface on a real device.
App-visible features and analytical rules change at the owner's request;
how those changes reach `main` is Claude's problem.

The dividing line, stated once: *what the app does* is the owner's domain;
*how the repository gets it done* is Claude's.

## Repository conventions

- **Squash-merge pull requests** (the convention set by #1 and #2). Write the
  squash title and body as a real changelog entry. Merge when the work is
  verified — verification, not permission, is the bar.
- **Work on `claude/*` feature branches.** After a branch's PR merges, restart
  the branch from the new `main` for follow-up work; never stack commits on
  merged history.
- **Commit messages explain why**, not just what. Findings, dead ends, and
  bugs caught in verification belong in the message — the history is the
  project's lab notebook.
- **Both builds ship together.** `src/` (TypeScript, expo-router) is the
  source of truth; `snack/` (plain JS, state navigation) mirrors it. No
  change is done until it exists in both and they behave identically.
- **Verify before shipping.** Export both builds, drive them headless
  (Playwright, executablePath `/opt/pw-browsers/.../chrome`), and check the
  actual numbers against an independent computation where one exists.
  Screenshots are part of verification — several real bugs here were caught
  only by looking.

## The data pipeline

Five stages under `tools/`, run in order by `npm run data`; only `node:`
built-ins, no npm install needed. The nightly workflow
(`.github/workflows/refresh-data.yml`) runs them at 23:00 UTC weekdays on
`main` and commits changed data files. Stage 4 is the gate: it exits non-zero
rather than shipping a misshapen snapshot, and the last good file stays put.
Secret: `FMP_API_KEY`. A full run costs ~1,230 FMP calls.

The Snack build fetches `assets/data/market.json` and `research.json` from
`main` at launch — a commit to `main` *is* the deployment.

## Snack publishing

`node tools/publish-snack.mjs` publishes anonymously and mints a **new URL
every time**; update the README link after each publish. The script redraws
ids ending in `_` or `-` (auto-linkers swallow trailing punctuation and the
link 404s on phones).

## Analytical integrity rules

These are owner-level decisions already made; do not relax them in passing:

- The universe is the S&P 500 constituent list — declared, not screened.
- Backtests use point-in-time membership; roster coverage is measured at
  every formation and the run fails below its floor rather than drifting
  toward survivors.
- Benchmarks are total-return and like-for-like (RSP exists because SPY
  alone confounds weighting with selection).
- Research-tab series are built entirely by the pipeline; the app only
  displays them, so the graph and its stated rules cannot disagree.
- SPY is packed beside the universe as the market reference and must never
  appear among ranked constituents (stage 4 enforces this).

## Session conventions

- Keep replies to the owner short, plain-language, non-technical; put the
  technical detail in commit messages and this repo's docs instead.
- End commits with the Claude Code attribution footer and session link.
- The model identifier in use must not appear in commits, PRs, or code.
