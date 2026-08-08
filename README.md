# Parakeet

A phone watchlist app for the S&P 500, with a selectable return window and a
risk-adjusted view of that same window.

Built with Expo / React Native. The price data is pulled from Financial
Modeling Prep by the scripts in `tools/` and baked into the app as a single
bundled asset, so the app opens instantly, works offline, and never carries an
API key onto the device.

## Running it

```bash
npm install
npm start          # then scan the QR code with Expo Go
```

`npm run web` opens the same app in a browser, which is handy for a quick look
but not the target: the gestures are built for a touchscreen.

### Without a computer

`snack/` is a second build of the same app that runs on [Expo
Snack](https://snack.expo.dev/JZygnwjqWpPzSeARTQG2Z), so it can be opened in
Expo Go from a phone alone. Snack cannot host the app as it stands — it caps
file sizes well below the 1.7MB bundled dataset, and it handles expo-router's
file-based routing unevenly — so that build differs in exactly two ways:

- the dataset is fetched from this repository over the network instead of being
  bundled, which means a few seconds of loading and no offline use;
- navigation is plain component state instead of expo-router, and the chart
  scrub uses `PanResponder` instead of `react-native-gesture-handler`, leaving
  only dependencies that Snack preloads.

The maths in `snack/stats.js` mirrors `src/data/stats.ts`, `snack/overlap.js`
mirrors `src/data/overlap.ts`, `snack/ranks.js` mirrors `src/data/ranks.ts`,
and the
palette mirrors `src/theme/theme.ts`. They are duplicated rather than shared
because the two builds have different module systems; if they ever disagree,
`src/` is the source of truth.
Re-publish after editing with:

```bash
node tools/publish-snack.mjs
```

## Refreshing the data

The snapshot in `assets/data/market.json` is current as of its `generatedAt`
field. To rebuild it:

```bash
export API_KEY=...   # Financial Modeling Prep
npm run data
```

That runs the stages in order. They are separate scripts because the price
fetch costs ~500 API calls and is worth resuming rather than repeating.

| Stage | Script | What it does |
| --- | --- | --- |
| 1 | `01-build-candidates.mjs` | Takes the S&P 500 constituent list, joins on screener metadata |
| 2 | `02-fetch-prices.mjs` | Pulls ~2 years of adjusted daily closes, one file per symbol |
| 3 | `03-build-dataset.mjs` | Aligns every series to one calendar and packs the app asset |
| 4 | `04-validate-dataset.mjs` | Refuses to ship a misshapen snapshot |
| 5 | `05-build-research.mjs` | Builds the Research tab's backtest series |

Stage 2 skips symbols it has already fetched, so an interrupted run resumes for
free. Pass `--force` to refetch everything — and note that the skip is a real
trap when refreshing rather than resuming: a run that "succeeds" in seconds
has just re-packed yesterday's prices.

### Every weekday, automatically

`.github/workflows/refresh-data.yml` runs the pipeline at **23:00 UTC on
weekdays** and commits `assets/data/market.json` if it changed. That is 19:00
in New York during EDT and 18:00 during EST — both comfortably past the 16:00
close, with room for end-of-day data to settle. 23:00 UTC is still the same
calendar day in New York, so the weekday fields need no shifting.

This is the mechanism that puts fresh prices on a phone: the Snack build
fetches `market.json` from the default branch every launch, so a commit here
*is* the update. Nothing to install, nothing to open.

Two things it does not try to be clever about:

- **Market holidays aren't encoded.** The job runs, finds no new session,
  produces a byte-identical file and commits nothing. A calendar would be one
  more thing to maintain for an outcome already handled.
- **It installs nothing.** Every script under `tools/` imports only `node:`
  built-ins and its own `lib/`, so there is no `npm ci` step — that would spend
  a couple of minutes and a few hundred megabytes of Expo toolchain on a job
  that needs `fetch` and `fs`.

**Stage 4 is the gate.** Stages 1–3 can all succeed and still produce something
wrong: an upstream schema change, a truncated response that survives its
retries, a screener returning half a universe. Run by hand that gets noticed;
run on a schedule and committed to a file every phone fetches, it would not.
So `04-validate-dataset.mjs` asserts the invariants the app actually relies on
and exits non-zero rather than letting a bad snapshot through — no commit
happens, the run fails loudly, and the last good file stays put.

It checks structure and landmarks rather than prices, because "is this close
plausible" needs a second source and would fire on real moves, while "does
every series end on the same session" is answerable from the file alone and
catches the failures that actually happen: a ticker count in the index's
~503-line band, a strictly increasing calendar not dated in the future, every
series ending on the newest session, every close finite and positive, no
duplicate symbols, positive market cap and turnover — plus landmarks: `AAPL`,
`BRK-B`, `MU`, `SO`, `APO` present, both Alphabet share classes present
(`GOOG` *and* `GOOGL`, proof dual classes survive the build), baby-bond
impostors absent (`SOJE`, `SOMN`, `CCZ`, `APOS`, `PPLC`, `STRC`, `STRD`,
`STRK`, `RZC`), and large foreign ADRs absent (`ASML`, `TSM` — big, liquid,
and not index members).

Verified by corrupting a real snapshot seven ways — truncating the universe to
400, dropping one day off a single series, nulling one close, swapping a parent
for its baby bond, dating the file to 2099, unsorting the calendar, and zeroing
a market cap. All seven exit 1 with the specific cause named; the untouched
file exits 0.

Before it can run you need to do two things it cannot do for itself:

1. Add your Financial Modeling Prep key as the repository secret
   **`FMP_API_KEY`** (Settings → Secrets and variables → Actions).
2. Merge the workflow to the default branch. GitHub only schedules workflows
   from there, so on a feature branch it will never fire — `workflow_dispatch`
   lets you run it by hand in the meantime.

One running cost worth knowing. A run costs **~1,228 API calls**: the
constituent list, 3 screener calls and a few profile fills in stage 1, one per
constituent (~503) in stage 2, none in stages 3-4, and ~719 in stage 5 (index
membership plus prices for every name that was a member at any point since
January 2016 — a longer backtest window means more departed members to price).
At five runs a week that is roughly 27,000 a month against your FMP quota.

Narrowing the date range would not change that number.
`historical-price-eod/dividend-adjusted` is a **per-symbol** endpoint, so
asking for one session instead of two years cuts the payload and leaves the
request count exactly where it was. The only thing that would actually reduce
it is a bulk end-of-day endpoint — one call returning every symbol for one date
— which FMP offers on some plans. Whether it is available here is unverified,
and nothing in this repo uses it.

Caching `data/prices/` between runs is likewise not the answer: stage 2 skips
files it already has, so a warm cache would freeze the data rather than speed
anything up.

## How the universe is chosen

It isn't — it's declared. The universe is the **current S&P 500 constituent
list**, taken from the same FMP endpoint the Research tab's backtest uses for
point-in-time membership. That is the point: the Market tab and the backtest
describe one universe, and it is the only universe whose membership is
verifiable rather than the output of a home-grown screen.

An earlier version screened the 500 largest US-traded names itself, which
meant fighting FMP's habit of stamping a parent company's market cap onto its
baby bonds and preferred series (`SOJE` presenting as a $90B company), and
meant `TSM` and `ASML` were in while the backtest's universe excluded them.
Adopting the index dissolves both problems: S&P has already done the
common-stock-only curation, and the two universes can no longer disagree.

Practical consequences:

- **Dual share classes ship.** The index lists both Alphabet lines, both Fox
  lines, both News Corp lines, so the app carries ~503 tickers, not 500.
- **Recent joiners have short histories.** A name added to the index last
  month has a month of bars; the per-ticker calendar offset already handles
  that, and window stats simply start where its series starts.
- **Metadata comes from a join.** The constituent list carries only names and
  sectors, so stage 1 joins it against the exchange screeners (and the profile
  endpoint for the few members those miss) for market cap, industry and
  country. `data/universe.json` is the audit trail.

**Adjusted prices.** Everything uses split- and dividend-adjusted closes. On
raw closes every stock split reads as a 50% crash and every dividend biases the
series downward.

**Partial sessions.** If the newest session is still open, only some symbols
have a bar for it and those bars hold partial volume at an intraday price.
Mixing that into a cross-sectional ranking silently compares live prices
against yesterday's closes, so stage 3 detects such a session by its abnormally
low turnover and drops it everywhere. Every series ends on the same completed
session.

## Ranking by market residual

Alongside **Return** and **Return ÷ σ**, the lists rank by **Residual**: the
window's return with the market's contribution removed.

Each name is regressed on `SPY` over exactly the window on screen, and what is
accumulated is `r − beta × r_market` rather than `r`. Ranking on plain return
quietly favours high-beta names — in a rising market a beta of 1.4 earns 40%
more than the market for taking 40% more of its risk, which is leverage rather
than selection. The residual strips that out and leaves what the name did that
the market does not account for.

The effect is large in this universe. Over the trailing year the top of the
plain-return list runs betas of 2.4 to 4.4, and their residuals are a fraction
of their headline returns: `SNDK` +2779% becomes +1048% residual, `WDC` +490%
becomes +209%. Names with negative beta move the other way — `APA` returned
+116% at a beta of −0.65 and scores +147% residual, since subtracting a
negative beta's market contribution *adds* to it.

Two deliberate choices:

- **No intercept.** Fitting an alpha term over the very window being measured
  would absorb the drift into it and leave a residual summing to zero for every
  name, which is precisely the quantity being ranked.
- **Beta over the displayed window**, so the figure answers "over *this*
  stretch" for every window the picker offers. The Research tab's backtest uses
  a fixed three-year beta instead, because it has fifteen years of history to
  regress against; the bundled dataset holds about two. Same idea, different
  measurement, and worth knowing before comparing a number on one screen to a
  number on the other.

`SPY` is packed into `market.json` beside the universe as a `market` field — it
is the yardstick, not a constituent, and stage 4 fails the build if it ever
appears among the ranked names. It adds about 3KB to the asset.

## The numbers

Every series is aligned to one master trading calendar, so a date window is a
pair of integer indices and window maths is pure index arithmetic.

- **Return** — simple return between the start and stop close.
- **Ann σ** — sample standard deviation of daily log returns, scaled by
  √252. Log returns because compounding is then additive and σ scales cleanly
  with √time; Bessel-corrected because these are a sample. Windows shorter
  than 10 observations report a return but no risk figure, since annualising a
  σ from a handful of points produces a number that looks authoritative and
  means very little.
- **Return ÷ σ** — a Sharpe-style ratio with no risk-free rate subtracted. The
  divisor is floored at **12.5%** annualised; see below.

One judgement call worth flagging: **both halves of that ratio are
annualised.** Dividing a raw window return by an annualised σ mixes units, so
identical skill would score differently over one month than over one year and
the column could not be ranked at all. Annualising both makes it comparable
across every window the picker offers. The per-ticker view states this
underneath the table.

Sanity check on the current snapshot — 1-year annualised σ runs 18% at the 5th
percentile, 31% median, 71% at the 95th, with `JNJ` and `KO` at 18% and `TSLA`
at 47%.

### The volatility floor

The ratio's divisor is floored at 12.5% annualised (`VOL_FLOOR`). A genuinely
quiet name divides by a small number and scores enormously for reasons that
have nothing to do with skill.

The floor applies to the **divisor only**. The σ column keeps showing the true
measurement, marked with `*` where the floor bound, because a displayed risk
figure that silently read high would be worse than the problem being solved.

It binds rarely, and it is worth knowing on what. In the current snapshot it
touches exactly one name — `EA`, trading in a tight band near an announced
acquisition price, so its realised vol collapses because the price tracks a deal
rather than a business:

| Window | EA σ | Ratio before | Ratio after |
| --- | --- | --- | --- |
| 1M | 3.8% | +7.74 | +2.37 |
| 3M | 3.7% | +4.59 | +1.36 |
| 6M | 6.3% | +1.02 | +0.52 |

At 1Y and Max, **no name in the universe** falls below 12.5% — the quietest is
`FTS` at 13.6% — so the floor is inert on the longer windows.

**It does not cap large ratios in general.** The biggest values come from the
annualised *numerator*, not a small denominator: annualising a one-month move
scales it by roughly 12, so the largest 1M ratio is around 54 with a perfectly
ordinary σ, and the floor leaves it untouched. Damping that would mean not
annualising the return on short windows, which is a different trade-off — it
would break comparability across window lengths, the property the annualisation
exists to provide.

### Skipping the recent tail

The **Skip** control drops the most recent trading days from every window.
Whatever moved hardest in the last few weeks tends to give some of it back, so
a ranking measured right up to the newest close partly ranks noise that is
about to unwind. Dropping the tail is the standard fix; Fama-French's momentum
factor is built from the prior 2-12 month return for the same reason.

The skip is derived from the window's **length**, not its preset name, so a
hand-picked custom window gets a sensible one too:

| Window | Sessions | Skipped |
| --- | --- | --- |
| 1M | ≤ 21 | 5 |
| 3M | ≤ 63 | 10 |
| 6M | ≤ 126 | 15 |
| 9M | ≤ 189 | 17 |
| 1Y and longer | > 189 | 20 |

`9M`'s 17 is interpolated between the 6M and 1Y steps, keeping the ladder
smooth rather than jumping straight to 20 at the six-month mark.

Deliberately sublinear: reversal is roughly a fixed one-month effect rather
than a fixed fraction of the lookback, so a proportional skip would gut the
short windows and under-correct the long ones.

**It truncates the end; it does not shift the window.** "1Y" still starts a
year ago, it just stops measuring 20 sessions early. Shifting instead would
quietly make the start date mean something other than the label. On a short
custom window the skip is clamped so at least 10 sessions survive, and the
control shows the number actually in force rather than the one asked for.

Two places make the exclusion visible rather than silent: the per-ticker chart
draws the skipped days in grey past a dashed divider, so the excluded move is
still on screen, and the per-window table tags each row with the days it drops.
Sparklines end where the measurement ends, so a row's shape and its number
always describe the same stretch of time.

Effect on the current snapshot: the 1-year winners chosen with the skip carry
a mean last-20-day return of +1.0%, against +2.4% without it — the ranking
leans measurably less on the recent move that tends to unwind. Short windows
reshuffle most, which is expected, since the dropped tail is a larger fraction
of them.

### Windows follow the calendar, not the refresh

With the skip armed, windows are anchored to **today's date on the device**,
not to the newest bar in the snapshot. The skip creates slack, and anchoring to
the snapshot would throw it away: with 20 sessions skipped and data three days
old, every price a 12-1 measurement needs is already present, because the
measurement ends 20 sessions back — well behind the last refresh. Anchoring to
the last bar instead would slide the whole window backwards a day for every day
the data ages.

So a snapshot three days stale still measures exactly `today − 252` to
`today − 20`, with the full 232-session window intact. Staleness only costs
anything once it exceeds the skip. Past that the target end is genuinely
unreachable, so the end clamps to the newest bar and the start moves with it to
preserve the window's length — a correct-length window ending as close to the
target as the data allows — and the range line says `Nd short` rather than
quietly measuring something shorter than its label.

Two deliberate exclusions: with the skip **off** there is no slack to spend, so
the newest bar is the best possible end regardless of today's date, and nothing
changes. And a **custom** window names explicit days, so its own stop day is the
anchor and today is irrelevant.

Session counting is weekend-aware but has no holiday calendar. A market holiday
inside the gap overcounts by one session, which moves the measurement date by a
day and changes a multi-month return negligibly.

## Overlap

Both screens flag names that would add little a portfolio doesn't already
have: the Watchlist screen flags redundant holdings, the Market screen flags
redundant *candidates* - names not currently held that would be no more
diversifying if added.

Every name is scored against your watchlist as the comparison basket. A
current holding's score is a leave-one-out correlation (Pearson r) - its own
daily returns against the equal-weighted average daily return of every
*other* holding, on the same days. A name you don't hold has nothing to leave
out, so it is correlated directly against the full basket average instead.
Both describe the same thing: how much a name's daily moves resemble the
basket as a whole. That is **not** a claim that any two flagged names are
correlated with each other - two names can each score high independently by
each tracking the group, without moving together at all. `AMD` at 68% beside
`MU` at 67% is two names each redundant with the group, not a pair that moves
in lockstep.

Every name scoring **65% or higher** is flagged with a `⇄ 68%` badge on its
own row - on the Watchlist screen among your holdings, on the Market screen
among all 500. There is no cap on how many can flag: a watchlist of 6
correlated names can flag all 6, and a search for a sector you're already
concentrated in can turn up a dozen matches. `OVERLAP_THRESHOLD` in
`src/data/overlap.ts` is the number to change if 65% flags more or less than
you want.

### What the headers don't say

The Watchlist screen has **nothing at all** between its title and its search
box - no count, no date line, no overlap summary, no portfolio card. The Market
screen keeps one line, and only ever a precondition.

Three things were removed in turn, each for the same reason. The Watchlist
header listed its flagged holdings ("Most overlap: ASX 69%, MU 69%, ADI 68%,
..."), which was the same symbols and percentages printed twice - once at the
top in the screen's loudest colour, wrapping onto a second line, and again on
each row a few pixels below. The Market header carried a running count ("26
names would overlap your watchlist by 65% or more"), which had a better
excuse - you cannot see 500 rows at once - but was still a permanent orange
banner restating what the badges already say, and the Overlap sort puts exactly
those names in order on demand, which beats a number. Then the rest of the
Watchlist header went with them.

What survives, on the Market screen only:

- *the calculation couldn't run, and here's what would fix it* - "Watchlist
  needs 1 more name to screen for overlap", "Widen the window to screen for
  overlap". These matter because in those states the Overlap sort chip is
  simply absent, and a control that vanishes with nothing said reads as a
  missing feature rather than an unmet precondition.
- *the live filter count* - "500 names · through Aug 5", which is feedback for
  the search and sector chips rather than a claim about the market.

Everything else is a finding, and findings live on the row they belong to. With
no findings left in any header, the warn-orange branch became unreachable and
was removed - captions are now always the faint tone. `describeOverlap`, which
only ever produced the Watchlist line, is gone entirely; `computeOverlap` still
runs on that screen to drive the row badges and the Overlap sort.

One cost, stated plainly: the Watchlist no longer shows what date its numbers
run through. With Skip on or a custom window the explicit range line below the
controls still says so ("2026-02-04 → 2026-07-16 · data 2d behind"); with Skip
off and a preset window, nothing on that screen names the date. The Market tab
always shows it.

65% rather than a round 70%: on the default 1Y window, real watchlists fall
into a natural gap. Loosely related sets - REITs, a mix of megacap tech
business models - top out around 55-58%. Genuinely concentrated ones sit at
68% and up: six major semiconductor names (`NVDA` `AMD` `MU` `AVGO` `INTC`
`QCOM`) reach 68%, regional banks 86%, oil majors 89%, utilities 90%. 65%
falls in that gap rather than on either edge, so it catches the semiconductor
case without also catching REITs or diversified tech.

**It uses the full selected window, not the skip-adjusted one.** The skip
exists to exclude short-term reversal from a *return* measurement; it has no
bearing on how two return series co-move across the window as a whole, so
switching Skip on does not change the overlap computed here.

**Shorter windows are more sensitive, for everything.** Correlation this way
is naturally stricter over longer windows: idiosyncratic day-to-day noise
dominates a 252-day correlation more than a 21-day one. The semiconductor set
above flags two names (`AMD` 68%, `MU` 67%) on the 1Y default; the same set on
a 1M window pushes those to `AMD` 93% and `INTC` 91%. That sensitivity isn't
limited to genuinely concentrated sets, though - REITs (58% on 1Y) cross the
threshold on a 1M window too (69%), and so does a mixed-business megacap tech
set (54% on 1Y, 66% on 1M). A short window and a shared bad month can make
almost any same-industry-ish list look concentrated, correctly: a REIT-heavy
watchlist genuinely does move together in a real-estate selloff, whatever the
year-long picture says. The one set that stays quiet at every window length is
a genuinely cross-sector one - the diversified example above tops out at 57%
even on 1M, well short of the threshold.

At least 3 names in the watchlist are needed to run the calculation at all -
"the rest of the list" isn't meaningful for one comparison - and at least 20
aligned daily returns, below which a correlation is mostly sampling noise.
This 3-name minimum gates Market-screen candidate flags too, even though
scoring a candidate against a smaller basket is mathematically no different:
a basket that small barely qualifies as "a basket" to screen candidates
against in the first place, not a limit of the maths.

Both headers explain whichever of these applies rather than showing a blank
result. The Market screen used to stay quiet on the grounds that the guidance
belonged on the screen with the watchlist on it, which was wrong once the
Overlap sort existed: the chip is simply *absent* while the basket doesn't
qualify, and a control that vanishes with nothing said reads as a missing
feature rather than an unmet precondition. It now says
"Watchlist needs 1 more name to screen for overlap" (or 2, or
"Widen the window..."), in muted grey rather than the warn colour a flag
count gets — it's guidance, not a finding.

The one case Market still stays quiet on is an **empty** watchlist. That tab
is where the app opens, so prompting someone to feed a feature they haven't
met yet is noise; from one name on, the prompt describes something already
begun. The Watchlist screen has no such problem — it shows its own empty
state instead.

A recently listed *holding* shortens the comparison window for everyone:
every basket member needs a close on every day measured, so the window
clamps to whichever one listed most recently. A recently listed *candidate*
does not - it isn't part of the basket, so there is nothing to clamp for it.
It simply cannot be scored over a window it doesn't fully cover, and gets no
badge for that window rather than shortening the comparison for the other 499
names. A longer window (or Max) makes more candidates eligible.

Computed with a leave-one-out identity rather than literally excluding each
holding and re-averaging: the per-day sum across the basket is taken once,
giving both a holding's "rest of the basket" average
(`(daySum - own) / (n - 1)`) and the full basket average for every candidate
outside it (`daySum / n`) directly. Verified bit-identical against a
brute-force implementation that does perform the literal exclusion.

**Sorting by it.** Both screens carry an "Overlap" sort chip alongside
Return, Size, and A-Z, once the watchlist itself qualifies for a score (the
chip is absent under the same conditions the header explains - too few
names, too short a window). It defaults to ascending, unlike Return and Size:
the useful direction is lowest correlation first, so the top of the list is
whichever name would add the most diversification - literally true on the
Market screen (add this candidate, since it moves least like your basket),
and the equivalent read on the Watchlist screen (this holding is the least
redundant with the rest of what you own).

While this sort is active every row shows its own number, not just the ones
that clear the 65% flag threshold - a badge that only appeared on the
*worst* names would leave the names at the top of an ascending sort with
nothing to look at. Tone still marks the threshold: orange for a flagged
name, neutral gray otherwise. A worked example, an 8-name semiconductor/tech
watchlist (`SNDK` `MU` `LITE` `WDC` `BE` `STX` `RVMD` `INTC`) sorted by
Overlap ascending on the default 1Y window:

| Rank | Symbol | Overlap |
| --- | --- | --- |
| 1 | RVMD | 19% |
| 2 | INTC | 56% |
| 3 | BE | 62% |
| 4 | LITE | 62% |
| 5 | STX | 76% |
| 6 | MU | 77% |
| 7 | WDC | 79% |
| 8 | SNDK | 79% |

`RVMD` (a biotech) is the one name in this list not tracking the rest of it;
`SNDK` and `WDC` (storage, same sub-industry as `MU` and `STX`) sit at the
redundant end. Re-sorting the full 500-name Market universe the same way surfaces
`RSG` (waste management) at -47% - a real negative correlation to this
particular basket, not just a low positive one, which is a stronger
diversification signal than anything scoring near 0% would be.

## The rank table

The Market tab has two views, switched by a Card / Table control under the
title. **Card** is the original list - one window at a time, with the
sparkline, price and overlap badge that need the room. **Table** trades all of
that for four horizons side by side: every name's rank at 3M, 6M, 9M and 12M,
as a heatmap.

The card view answers "how is this name doing over the window I picked." The
table answers the question that needs several windows at once - whether a name
is strong *everywhere* or only lately - which is invisible when you can see one
horizon at a time and have to hold the others in your head. Two rows from the
current snapshot, ranked on Return:

| Symbol | 3M | 6M | 9M | 12M |
| --- | --- | --- | --- | --- |
| SNDK | 375 | 17 | **1** | **1** |
| DELL | **2** | **1** | 7 | 13 |

`SNDK` is the best name in the market over 9 and 12 months and near the bottom
third over the last quarter; `DELL` is the reverse, strongest recently and
mid-table over a year. The card view shows one of those columns at a time and
cannot tell the two situations apart. Sorting by 3M worst-first fills a screen
with the first kind - `LITE` 475 → 20/2/3, `CIEN` 492 → 39/16/9, `INTC`
411 → 10/9/8: names in the bottom decile of the last quarter that are still
top-20 over a year.

**There is no 1M column, deliberately.** A one-month rank is dominated by
short-horizon reversal - whatever moved hardest recently tends to give some of
it back - which is the same effect `skipForLength` exists to strip out of a
measurement in the first place. A column built on it reorders itself every few
weeks and points the opposite way from what it appears to say, so it was
removed rather than shown beside four horizons that carry signal. 3M is the
shortest horizon here for that reason.

**Ranks are market-wide and stay that way.** Filtering to one sector or
searching does not renumber them - a rank that meant "best of the eleven names
still visible" would answer a different question on every filter and could not
be compared against the unfiltered view. The header says so when a filter is
active ("37 of 500 · ranks stay market-wide").

**Each horizon carries its own skip.** `skipForLength` is sublinear on
purpose, so with Skip on the four columns drop 10 / 15 / 17 / 20 sessions
respectively, and the header states that rather than showing one day count
that would be wrong for three of the four columns. The Return / Return ÷ σ
toggle applies too - the ranks are on whichever metric is selected.

**Sorting is the column headers**, tapping one sorts by that horizon and
tapping it again flips direction. There is nothing else in this view to sort
by, so a separate row of sort chips would have been a second way to say the
same thing. It opens on 12M, the horizon where a rank is least noisy.

### The heatmap

`rankHeat` maps a rank to a distance from the middle of the pack and a
direction, and the cell renders that as a background tint (peaking at 26%
alpha) plus a text colour blended from `textMuted` toward the pole. Both
channels move together, so the ramp is continuous rather than banded.

It is **diverging**, not sequential: the top of the market and the bottom both
read loudly, and the wide middle stays quiet. That matters at 500 names, where
rank 240 and rank 260 mean the same thing and a linear ramp would leave most
of the table tinted - colour implying information that isn't there. The
`HEAT_GAMMA` of 1.5 is what pushes the middle back down; rank 25 of 500 still
reads at 0.86 strength while rank 200 falls to 0.09.

**One judgement call worth flagging:** the poles are the palette's `up` and
`down` - the same green and red the app uses for gains and losses everywhere
else. That is a deliberate overload. A rank of 400 does not mean the name lost
money, and colouring it red implies something the number doesn't say. Two
things argued for it anyway: the cell contains an integer with a month label
above it, so "bad rank" is the natural reading rather than "lost money"; and
rank and return sign are correlated enough in practice that the implication is
rarely wrong. The alternative - a sequential green-to-neutral fade with no red
- avoids the overload but makes rank 480 and rank 300 look identical, which
loses exactly the signal the `LITE` / `CIEN` / `INTC` examples above turn on:
a name being in the *bottom decile* of a quarter is the interesting half of
"bottom decile at 3M, top 20 at 12M", and a fade cannot show it.

### Cost

Four horizons over 500 names is 2,000 `computeWindowStats` calls, which run in
**9-19ms** on this dataset - measured across all four metric × skip
combinations. The memo is keyed only on metric, skip and staleness, so typing,
filtering, sorting and scrolling never rebuild it.

It reuses `computeWindowStats` rather than a faster rank-specific path for the
same reason the portfolio card did: a rank that disagreed with the number the
card view shows for the same name and window would be a bug with no single
place to fix it. Verified against exactly that - the ranks were checked
against an independently computed card-view ordering for every horizon and
both metrics, with and without skip, and matched on all 8,000 comparisons.
The 9M column with Skip on reproduces the card view's leaderboard digit for
digit (`SNDK` +19.26, `MU` +8.48, `LITE` +6.82, `WDC` +6.81 over
2025-11-03 → 2026-07-14).

Names with no measurement at a horizon are ranked `null` and shown as `—`,
sorting to the bottom in either direction rather than posing as the best or
worst of a window they weren't in. Every name in the current 500 has at least
a year of history by construction, so this path is defensive: it is exercised
by the code but not by this dataset.

The table shows no overlap badges and no overlap count. Overlap warns about
redundancy against your watchlist, which is a different question from momentum
persistence, and at this row density the badges would crowd out the ranks.

## Portfolio summary (removed)

The Watchlist screen used to lead with a card treating your holdings as one
equal-weighted position - Ann sigma, Return / sigma, and a diversification
ratio with an `ⓘ` explaining it. It went when everything between that screen's
title and its search box went, and its code has since been deleted rather than
left unreferenced. `git log` has it if it should ever come back.

Two pieces of reasoning from it are worth keeping, because they still describe
how this app thinks:

- **A watchlist's backtested return is close to a tautology.** You assemble one
  by opening a list ranked on past return and tapping names near the top, so
  measuring the return of what you kept mostly measures the ranking you picked
  from. One real 45-name watchlist read +106% over nine months. Nobody held
  that. The same caveat applies, more weakly, to any Return / sigma you read
  off your own watchlist rows - it has that return in its numerator. On the
  Market tab, ranking all 500, there is no such problem.
- **The 12.5% vol floor never applied to the portfolio figure.** The floor
  exists to stop one quiet *name* dominating a ranking; a well-diversified
  basket sits under 12.5% as the intended result of diversification, not an
  anomaly. `computeWindowStats` briefly carried an `applyFloor` argument for
  that one caller. With the card gone nothing passes it, so the argument has
  been removed too - every remaining caller floors, which is correct for
  individual names.

## The Research tab

A third tab graphs **$10,000 in the top-50 momentum portfolio since January
2016 against $10,000 held in SPY**, updated by the same nightly job that
refreshes prices. Every rule that produces the lines is displayed on the screen
with them:

| Rule | Setting |
| --- | --- |
| Universe | S&P 500 members as of each measurement date — point in time, so names later removed or delisted are included while they were members |
| Signal | Switchable: **total return** 12-1 momentum, or **market residual** (see below) |
| Selection | Top 50, equally weighted |
| Rebalance | Measured at the last trading day of each month, traded at the next trading day's close (per `docs/rebalancing-standard.md`), held untouched in between |
| Period | Since January 2016, $10,000 at the start — or the selected window, re-based |
| Benchmarks | `SPY` (cap-weighted) and `RSP` (equal-weighted), each bought once at the same start and held |
| Dividends | Reinvested on every side, via adjusted closes |
| Costs | No taxes or fees |
| Delistings | Frozen at the last close until the next rebalance |

### Two signals

The signal is a toggle on the screen, and both are built by the same pipeline
over the same eligibility test, so switching changes the signal and nothing
else — not the universe, not the selection size, not the rebalance.

**Total return** is plain 12-1 momentum: the return from twelve months before
the measurement date to one month before it.

**Market residual** measures the same window on what the market does *not*
explain. Each name is regressed on `SPY` over the trailing three years of daily
log returns, giving an alpha and a beta, and the signal accumulates
`r − alpha − beta × market` instead of `r`.

Why it matters is visible in the realised beta of the two portfolios. Ranking
on raw return quietly favours high-beta names, so total momentum ran at a beta
of **1.18** at top-25 — a chunk of what looked like stock picking was leveraged
market exposure. The residual version ran at **1.03** and still returned more:

| Since Jan 2016, top 50 | Final | CAGR | Ann σ | Sharpe | Max DD | Beta |
| --- | --- | --- | --- | --- | --- | --- |
| Total return | $41,665 | 14.4% | 22.5% | 0.51 | −36.5% | 1.07 |
| Market residual | $43,665 | 14.9% | 21.1% | 0.56 | −37.0% | 1.00 |

At a top-25 concentration the gap is much wider — 18.2% CAGR and 0.62 Sharpe
for residual against 15.2% and 0.45 for total, measured separately — but the
app ships the top-50 rule unchanged so the toggle isolates one variable.

Requiring three years of history to estimate a beta costs a little coverage:
the worst formation scores 452 of 505 members rather than 456. Both signals are
held to that same restricted universe, so the comparison stays honest.

### The head-to-head

The strategy is drawn against **two** buy-and-hold references over the
identical window, on one shared axis — lines scaled independently would let any
set of series look neck and neck. All three use dividend-adjusted closes, so
this is total return against total return; benchmarking a dividend-reinvesting
strategy against a price-return index would hand it a couple of free points a
year it never earned.

A window selector (`3M / 6M / 9M / 1Y / 3Y / 5Y / Max`) re-bases **every** line
to $10,000 at the start of the selected window, so each window asks the same
question rather than mixing a re-based line with an absolute one. The Period
rule restates whichever window is showing, so the stated rules never describe a
different graph from the one on screen.

**Why there are two benchmarks.** SPY alone answers the wrong question. This
portfolio holds 50 names in equal amounts; SPY is weighted by company size, and
over this particular decade a handful of megacaps did most of the index's work.
Measured against SPY, the weighting scheme and the stock selection are tangled
together and the signal takes the blame for both. `RSP` is the same index
equally weighted, so it isolates the part the strategy actually chose: *which*
50 names, not how to size them.

That distinction decides the answer rather than decorating it:

| Since Jan 2016 | Value | Return | Max drawdown |
| --- | --- | --- | --- |
| Top-50 momentum | $43,783 | +337.8% | −36.5% |
| SPY, held (cap-weighted) | $45,625 | +356.3% | −33.7% |
| RSP, held (equal-weighted) | $34,698 | +247.0% | −39.0% |

Against SPY the strategy **trails by 18.4 points**. Against its like-for-like
benchmark it **leads by 90.9 points**, and did so while drawing down less than
RSP did. The apparent failure was mostly a weighting effect, not a verdict on
momentum — which is exactly why one benchmark was not enough. It leads over
every shorter window against both, except the trailing 3 months where it trails
both.

Worth keeping in view: the deficit against SPY is real too. Equal-weighting 50
momentum names beat equal-weighting the index, and still did not beat owning
the index the ordinary cap-weighted way over the same decade.

Two choices worth stating. The universe is the same S&P 500 the Market tab
tracks, held to point-in-time membership because avoiding selection bias
requires knowing who was in the index *then*, not who survived until today.
And the series is built entirely by the pipeline
(`tools/05-build-research.mjs`, ~719 API calls per run, prices fetched fresh
every time); the app only displays it, so the graph, the current 50 holdings
and the rules can never disagree with each other.

### Why the window starts in 2016

Not because the history runs out. The index change log reaches 1957, and
surviving companies price back to the 1970s once you work around the
endpoint's undocumented 5,000-row cap. What runs out is **the ability to price
companies that died** — and a backtest that cannot price them does not exclude
them honestly, it excludes them silently.

Measured against the reconstructed point-in-time roster, the share of members
that can actually be scored at a formation date:

| Formation date | Roster scoreable |
| --- | --- |
| 2026 / 2023 | 100% |
| 2020 / 2017 | 99% |
| 2014 | 90% |
| 2011 | 77% |
| 2008 | 76% |
| 2005 | 63% |
| 2002 | 59% |
| 1999 | 50% |

The direction of the loss is what rules out the earlier years. Of the mid-2008
members that *cannot* be priced, 18% are still in the index today; of the ones
that can, 70% are. The unpriceable set is the casualty list — GM, General
Growth, Weatherford, Monsanto, Tyco, Anadarko — while Lehman, Enron,
Washington Mutual and old GM return no data at all. A 2008 backtest built on
this source would not show a harsher crash; it would show a flattered one,
with a quarter of the wreckage missing.

There is a second trap the longer window has to dodge: **recycled tickers**.
Ask this API for Wachovia today and you get Weibo's history from 2014;
`SUNW` returns a solar company from 2010, `CC` returns Chemours, `KODK` the
relisted Kodak. Feeding those into a backtest would hand a dead company's slot
to a different company's returns.

So the pipeline records the roster coverage at every formation and **exits
non-zero if any month falls below 85%** (`COVERAGE_FLOOR`), writing the worst
observed value into `research.json` as `minCoverage`. Current run: 98.1% mean,
90.3% worst — the weakest month is the first, whose lookback reaches furthest
into thinning history. It also fails loudly if any price response comes back
at exactly 5,000 rows, since that is the cap silently truncating history
rather than a real answer.

Going meaningfully earlier needs a survivorship-bias-free dataset such as CRSP
— the academic standard — which this data source does not offer.

## Using it

**Tap a row to add it to your watchlist. Press and hold to open it.** That is
the reverse of the usual convention, so the affordance carries itself: watched
rows show an accent bar, a coloured symbol and a trailing dot, and the two
gestures fire different haptics.

A footer under the Market list says so in words. It appears **only there**: on
the Watchlist screen a tap *removes* the row it lands on, so the same sentence
would describe the opposite of what the gesture does, and by the time you have
a watchlist to look at, the convention it exists to teach has already been
learned by using it.

- **Market** — all 500, in two views. *Card* is the list; *Table* ranks every
  name at 3M / 6M / 9M / 12M as a heatmap. Both searchable and filterable by
  sector.
- **Window** — presets from 1M to Max, or *Custom* for an explicit start and
  stop day. Days are picked from the trading calendar itself, so a weekend is
  never a selectable answer that silently snaps elsewhere.
- **Return / Return ÷ σ** — switches what the list shows and ranks by.
- **Skip** — drops the recent tail of every window, scaled to its length. See
  *Skipping the recent tail* above. The setting persists across launches.
- **Overlap** — an amber `⇄` badge on a row means that name is redundant with
  your watchlist: on the Watchlist screen, a current holding that adds little
  the others don't already provide; on the Market screen, a candidate that
  wouldn't diversify anything if added. See *Overlap* above for what the
  score does and doesn't mean.
- **Research** — the $10,000 top-50 momentum backtest above, with its rules
  and current holdings.
- **Per-ticker** — a scrubbable chart (drag across it and the header figures
  follow your finger), every window's return, σ and ratio at once, and
  swipe left/right to move through the list you came from in the order you
  were looking at it.

### The chart

Three details that are easy to get wrong:

**A drag is a scrub, not a page turn.** Both gestures are horizontal, and the
ticker pager sits underneath the chart, so a drag used to flick through to the
next ticker instead of moving the crosshair. The chart now claims the touch
first and the pager stops accepting drags for as long as a finger is down.

**Scrub updates are coalesced to one per frame.** A drag delivers touch events
faster than the screen repaints, and each one previously set state and
re-rendered the whole screen, so the crosshair lurched along behind the thumb.
The reported index is unchanged — it just stops doing the work more often than
it can be seen.

**The line draws itself in, and the newest point breathes.** On open, one
animated clip sweeps left to right so the fill, the baseline and every line
arrive together rather than as separate effects; it replays when the window
changes but not while a finger is dragging. The most recent point carries a
solid marker with a slow halo, which stops during a scrub — a beating dot
competing with the crosshair is noise, and the frames are better spent on the
drag. The plot is inset ten pixels on the right so that marker isn't sliced in
half by the frame, and the finger-to-index mapping uses the same inset width so
the crosshair still lands where it looks like it lands.

SVG ids are per-chart (`pcFill3`, `pcClip3`) rather than fixed strings. Ids
share one document-wide namespace and the pager keeps three charts mounted, so
fixed ones would have had all three sharing the first chart's gradient and clip.

In the per-ticker table, *Max* clamps to the name's own listing date, so a 2025
listing reports its full history rather than a dash. The other presets do not
clamp — six months of a recent listing under a "1Y" heading would overstate the
horizon — and the Market tab never clamps at all, because a cross-sectional
ranking is only meaningful when every name is measured from the same day.

Light and dark are both first-class and follow the system setting; the control
in the header cycles system → light → dark. The dark scheme is true black so
the numbers float on an OLED panel; the light scheme uses a deeper, more
desaturated green that stays legible against white.
