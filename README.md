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
Snack](https://snack.expo.dev/Xf5mg4xJK2kuDpMTje_ui), so it can be opened in
Expo Go from a phone alone. Snack cannot host the app as it stands — it caps
file sizes well below the 1.7MB bundled dataset, and it handles expo-router's
file-based routing unevenly — so that build differs in exactly two ways:

- the dataset is fetched from this repository over the network instead of being
  bundled, which means a few seconds of loading and no offline use;
- navigation is plain component state instead of expo-router, and the chart
  scrub uses `PanResponder` instead of `react-native-gesture-handler`, leaving
  only dependencies that Snack preloads.

The maths in `snack/stats.js` mirrors `src/data/stats.ts` and the palette
mirrors `src/theme/theme.ts`. They are duplicated rather than shared because
the two builds have different module systems; if they ever disagree, `src/` is
the source of truth. Re-publish after editing with:

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
- **Return ÷ σ** — a Sharpe-style ratio with no risk-free rate subtracted.

One judgement call worth flagging: **both halves of that ratio are
annualised.** Dividing a raw window return by an annualised σ mixes units, so
identical skill would score differently over one month than over one year and
the column could not be ranked at all. Annualising both makes it comparable
across every window the picker offers. The per-ticker view states this
underneath the table.

Sanity check on the current snapshot — 1-year annualised σ runs 18% at the 5th
percentile, 31% median, 71% at the 95th, with `JNJ` and `KO` at 18% and `TSLA`
at 47%.

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
