# Parakeet

A phone watchlist app for the 500 largest US-traded equities, with a
selectable return window and a risk-adjusted view of that same window.

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
Snack](https://snack.expo.dev/jvxt31bzruVzqTjT2ON_M), so it can be opened in
Expo Go from a phone alone. Snack cannot host the app as it stands — it caps
file sizes well below the 1.7MB bundled dataset, and it handles expo-router's
file-based routing unevenly — so that build differs in exactly two ways:

- the dataset is fetched from this repository over the network instead of being
  bundled, which means a few seconds of loading and no offline use;
- navigation is plain component state instead of expo-router, and the chart
  scrub uses `PanResponder` instead of `react-native-gesture-handler`, leaving
  only dependencies that Snack preloads.

The maths in `snack/stats.js` mirrors `src/data/stats.ts`, `snack/overlap.js`
mirrors `src/data/overlap.ts`, `snack/portfolio.js` mirrors
`src/data/portfolio.ts`, and the palette mirrors `src/theme/theme.ts`. They are
duplicated rather than shared because the two builds have different module
systems; if they ever disagree, `src/` is the source of truth.
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

That runs the three stages in order. They are separate scripts because the
middle one costs ~800 API calls and is worth resuming rather than repeating.

| Stage | Script | What it does |
| --- | --- | --- |
| 1 | `01-build-candidates.mjs` | Screens NYSE / NASDAQ / AMEX into ~800 candidates |
| 2 | `02-fetch-prices.mjs` | Pulls ~2 years of adjusted daily closes, one file per symbol |
| 3 | `03-build-dataset.mjs` | Filters to exactly 500 and packs the app asset |

Stage 2 skips symbols it has already fetched, so an interrupted run resumes for
free. Pass `--force` to refetch everything.

## How the 500 are chosen

The goal is 500 *companies you can actually trade*, which turns out to be the
hard part of this project rather than an afterthought.

**Adjusted prices.** Everything uses split- and dividend-adjusted closes. On
raw closes every stock split reads as a 50% crash and every dividend biases the
series downward.

**Instruments that impersonate common stock.** A market-cap screen alone
produces a badly polluted list, because FMP stamps the *parent company's*
market cap onto that company's baby bonds and preferred series. `SOJE` and
`SOMN` (Southern Company junior subordinated notes) present as $90B companies;
so do `CCZ`, `APOS`, `PPLC`, `RZC`, and Strategy's `STRC` / `STRD` / `STRK`
preferred series. Several wear innocent four-letter tickers, so no symbol
pattern catches them.

What separates them is that nobody trades them. They turn over a few hundred
thousand dollars a day against the common stock's hundreds of millions, so the
filter that matters is **median daily dollar volume**, not size. Median rather
than mean, because a single index-rebalance print can otherwise float an
untraded instrument over the threshold.

Three passes, in order:

1. **Shape and name** — symbols must look like common stock (`AAPL`, `BRK-B`);
   a `-P<letter>` suffix marks a preferred series, `-W` a warrant, `-U` a unit.
   Names matching depositary / notes / debenture / warrant and similar are
   dropped, as are shell and blank-check companies.
2. **Tradability** — at least one year of history and a median turnover of
   $10M/day. This is the pass that removes the baby bonds.
3. **One line per company** — company names are normalised down to their stem
   (`Alphabet Inc. Class C` → `alphabet`) and only the most-traded member of
   each group survives. That keeps `GOOGL` over `GOOG` and `BRK-B` over
   `BRK-A`, and sweeps up any bond that shared its parent's name.

The survivors are ranked by market cap and cut at 500. In the current snapshot
that cut lands at about $26B, and every name in the set trades over $100M a day.
`data/universe.json` is the audit trail of what made it.

**Partial sessions.** If the newest session is still open, only some symbols
have a bar for it and those bars hold partial volume at an intraday price.
Mixing that into a cross-sectional ranking silently compares live prices
against yesterday's closes, so stage 3 detects such a session by its abnormally
low turnover and drops it everywhere. Every series ends on the same completed
session.

**"US-traded" is read literally** — listed on a US exchange, not domiciled in
the US. `TSM`, `ASML` and other ADRs are in; the set is currently about 73% US
by domicile. There is no $5 price floor, because large ADRs such as `ABEV` and
`WIT` legitimately trade in low single digits; liquidity does that job better.

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
each tracking the group, without moving together at all. "Most overlap: AMD
68%, MU 67%" names two names that are each redundant with the group, not a
pair that moves in lockstep.

Every name scoring **65% or higher** is flagged - on the Watchlist screen,
shown as a badge and named in the header; on the Market screen, shown as a
badge on every matching row among all 500, with a count in the header ("12
names would overlap your watchlist by 65% or more"). There is no cap on how
many can flag: a watchlist of 6 correlated names can flag all 6, and a search
for a sector you're already concentrated in can turn up a dozen matches.
`OVERLAP_THRESHOLD` in `src/data/overlap.ts` is the number to change if 65%
flags more or less than you want.

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
against in the first place, not a limit of the maths. The Watchlist header
explains whichever of these applies instead of showing a blank result; the
Market screen just stays quiet, since that guidance belongs on the screen
with the watchlist on it.

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
redundant end, matching the header's own "Most overlap" line for this basket.
Re-sorting the full 500-name Market universe the same way surfaces
`RSG` (waste management) at -47% - a real negative correlation to this
particular basket, not just a low positive one, which is a stronger
diversification signal than anything scoring near 0% would be.

## Portfolio summary

The Watchlist screen leads with one card: the watchlist's own Return, Ann σ,
Return ÷ σ and diversification ratio, treated as a single equal-weighted
position instead of N separate rows. It answers a question the row list
can't: not "how did each holding do," but "how did the *combination* do" -
which isn't the average of the row-level numbers, because volatility doesn't
average linearly and correlation between holdings changes the real combined
risk. A user eyeballing the individual rows and mentally averaging their σ
figures would get a meaningfully wrong number for exactly that reason.

Built by constructing a synthetic ticker - $1 invested equally across the
watchlist, rebalanced daily - shaped exactly like any other ticker in the
dataset, then running it through the *same* `computeWindowStats` every
individual row already uses. That is a deliberate choice over a bespoke
calculation: it guarantees the portfolio figure uses the same annualisation
and the same Bessel correction as every number already on screen, with no
second implementation to keep in sync.

**The 12.5% vol floor does not apply here** (`computeWindowStats`'s fourth
argument, `applyFloor`, defaults to `true` for every existing call site and is
passed `false` only for the portfolio ticker). The floor exists to stop a
single quiet *name* dominating a ranking for reasons unrelated to skill - the
`EA` case, a price pinned near an announced deal. That reasoning does not
carry over to a portfolio: a well-diversified basket routinely produces σ
under 12.5% as the *ordinary, intended result* of combining
imperfectly-correlated holdings, not an anomaly to correct for. Checking a
handful of cross-sector baskets against the current snapshot, most land under
the floor:

| Basket | Portfolio σ | Would floor at 12.5%? |
| --- | --- | --- |
| JNJ+XOM+JPM+NVDA+WMT+FTS+PLD | 9.6% | yes |
| MSFT+JNJ+XOM+V+PLD | 11.2% | yes |
| AAPL+BRK-B+XOM+JNJ | 11.3% | yes |
| GOOGL+JPM+XOM+PLD+KO+DUK+V+UNH | 10.7% | yes |
| KO+PG+UNH+HD+V+DUK | 13.5% | no |

A floor that fires on most well-built portfolios isn't screening out an
anomaly, it's screening out the thing the card exists to show.

**Diversification ratio** answers the question directly, and is unaffected by
the floor question either way: the equal-weighted average of each holding's
own annualised σ, divided by the portfolio's own annualised σ - both taken
from `computeWindowStats`'s never-floored `annualizedVol` field, not its
(possibly floor-adjusted) `ratio`. 1.0x means combining these names bought
nothing; 2.0x means the combined risk is half what the average holding
carries alone. An `ⓘ` button next to the label opens that explanation in the
app itself, so the number is never shown without access to what it means.
Measured against the current snapshot:

| Watchlist | Avg. individual σ | Portfolio σ | **Diversification ratio** |
| --- | --- | --- | --- |
| Diversified (7 sectors) | 23.3% | 9.6% | **2.43x** |
| Semiconductors (6, concentrated) | 60.6% | 45.5% | **1.33x** |
| Utilities (6, concentrated) | 15.6% | 13.5% | **1.15x** |

**Respects Skip; ignores nothing Overlap ignores.** Unlike Overlap, which
deliberately uses the unskipped window because correlation structure isn't a
return question, the portfolio card uses the skip-adjusted window - this *is*
a return question, the same one every row below it is answering, so it should
exclude the same reversal tail.

The card needs at least 2 names to appear at all - a "portfolio" of one
holding is just that holding, redundant with the row already showing it - and
like any ticker, it can return "not enough shared history in this window" if
the selected window starts before the watchlist's most-recently-added member
existed. Never shown on the Market screen: `universe` there is the full 500,
not something to treat as a position.

## Using it

**Tap a row to add it to your watchlist. Press and hold to open it.** That is
the reverse of the usual convention, so the affordance carries itself: watched
rows show an accent bar, a coloured symbol and a trailing dot, and the two
gestures fire different haptics.

- **Market** — all 500, searchable, filterable by sector, sortable by the live
  metric, by size, or alphabetically.
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
- **Portfolio summary** — the card above the Watchlist row list: your holdings
  as one equal-weighted position, not N separate numbers. See *Portfolio
  summary* above.
- **Per-ticker** — a scrubbable chart (drag across it and the header figures
  follow your finger), every window's return, σ and ratio at once, and
  swipe left/right to move through the list you came from in the order you
  were looking at it.

In the per-ticker table, *Max* clamps to the name's own listing date, so a 2025
listing reports its full history rather than a dash. The other presets do not
clamp — six months of a recent listing under a "1Y" heading would overstate the
horizon — and the Market tab never clamps at all, because a cross-sectional
ranking is only meaningful when every name is measured from the same day.

Light and dark are both first-class and follow the system setting; the control
in the header cycles system → light → dark. The dark scheme is true black so
the numbers float on an OLED panel; the light scheme uses a deeper, more
desaturated green that stays legible against white.
