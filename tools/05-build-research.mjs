// Step 5 - build the Research tab's series: $10,000 in the top-50 momentum
// portfolio since January 2016, written to assets/data/research.json.
//
// The rules, exactly as displayed in the app:
//
//   Universe   S&P 500 membership as of each measurement date, reconstructed
//              from the index change log. Point in time: names later removed
//              or delisted are included while they were members. The Market
//              tab tracks the same index (tools/01-build-candidates.mjs), so
//              the backtest and the app describe one universe.
//   Signal     12-1 momentum - total return from 12 months before the
//              measurement date to 1 month before it (the recent month is
//              skipped, the same reversal logic as the app's Skip control).
//   Selection  The 50 highest, equally weighted.
//   Rebalance  Measured at the last trading day of each month, traded at the
//              close of the first trading day of the next month, per
//              docs/rebalancing-standard.md. Held untouched in between.
//   Period     From January 2016 to the latest session. $10,000 at the start.
//              Dividends are in via adjusted closes. No taxes or fees.
//   Delisting  A holding that stops trading mid-month is frozen at its last
//              close (equivalent to holding the proceeds in cash) until the
//              next rebalance.
//
// Why the window starts in 2016 and not earlier. The index change log reaches
// 1957 and surviving companies price back to the 1970s, so neither of those
// binds. What binds is that companies which died can no longer be priced, and
// a backtest that cannot price them silently drops them from the selection
// universe. Measured against the point-in-time roster, the share of members
// that can be scored is ~99% back to 2017 and ~90% at 2014, but only ~76% at
// 2008 and ~59% at 2002. Worse, the missing names are the casualties: of the
// mid-2008 members that cannot be priced, 18% are still in the index today
// against 70% of the ones that can. Extending past 2016 would not show a
// harsher crash, it would show a flattered one. COVERAGE_FLOOR below is what
// stops that happening by accident.
//
// Prices are fetched fresh every run - history is cheap and a cache here would
// be one more way to serve yesterday's answer.

import { writeFileSync } from 'node:fs';
import { fmp, mapPool, progress } from './lib/fmp.mjs';

const TOP = 50;
const START_CASH = 10_000;
// Fixed anchor rather than a rolling window: the $10,000 goes in once and the
// track record accumulates, so yesterday's chart is still a prefix of today's.
const START_MONTH = '2016-01';
const M = 21; // trading days per month for the momentum lookbacks
const CONCURRENCY = 8;

// The share of a formation date's roster that must be scoreable. Below this
// the selection universe has quietly become the set of companies that
// survived, which is the one bias this whole construction exists to avoid.
//
// Observed: ~98% on average, with the weakest formation at the very start of
// the window (~90%, since the oldest lookback reaches furthest into thinning
// history). The floor sits below that on purpose - it is here to catch a
// material slide toward survivors, not to fail the nightly job over one
// symbol going missing. For scale, 2011 measures 77% and 2005 63%.
const COVERAGE_FLOOR = 0.85;

// historical-price-eod/dividend-adjusted truncates at 5000 rows (~20 years)
// without saying so. The window is ~12 years today, comfortably inside it, but
// a fixed start date means the span grows every year - so a response landing
// exactly on the cap is treated as truncation rather than trusted.
const ROW_CAP = 5000;

// SPY is the familiar reference; RSP is the like-for-like one, since this
// portfolio is equally weighted too. Both are held from the same start.
const BENCHMARKS = [
  { symbol: 'SPY', name: 'S&P 500, cap-weighted' },
  { symbol: 'RSP', name: 'S&P 500, equal-weighted' },
];

function iso(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const today = new Date();

  // --- point-in-time index membership ---------------------------------------
  const current = await fmp('sp500-constituent');
  const changes = (await fmp('historical-sp500-constituent'))
    .filter((c) => c.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  let members = new Set(current.map((c) => c.symbol).filter(Boolean));
  const snapshots = [{ date: '2999-12-31', members: new Set(members) }];
  for (const c of changes) {
    if (c.symbol) members.delete(c.symbol);
    if (c.removedTicker) members.add(c.removedTicker);
    snapshots.push({ date: c.date, members: new Set(members) });
  }
  snapshots.sort((a, b) => (a.date < b.date ? -1 : 1));
  const rosterAt = (date) => {
    let best = null;
    for (const s of snapshots) {
      if (s.date <= date) best = s;
      else break;
    }
    return best ? best.members : new Set();
  };

  // Every name that was a member at any point in the window, so the union
  // includes the ones that have since dropped out - that is the entire point.
  const windowStart = new Date(`${START_MONTH}-01T00:00:00Z`);
  windowStart.setMonth(windowStart.getMonth() - 2);
  const need = new Set();
  const probe = new Date(windowStart);
  while (probe <= today) {
    for (const s of rosterAt(iso(probe))) need.add(s);
    probe.setMonth(probe.getMonth() + 1);
  }
  console.log(`  ${need.size} symbols were members at some point since ${START_MONTH}`);

  // --- prices ----------------------------------------------------------------
  // The earliest formation needs 12 months of history behind it.
  const from = new Date(`${START_MONTH}-01T00:00:00Z`);
  from.setMonth(from.getMonth() - 14);
  const to = iso(today);

  const bars = new Map();
  let done = 0;
  const failed = [];
  const truncated = [];
  await mapPool([...need], CONCURRENCY, async (symbol) => {
    try {
      const rows = await fmp('historical-price-eod/dividend-adjusted', {
        symbol: symbol.replace(/\./g, '-'),
        from: iso(from),
        to,
      });
      if (Array.isArray(rows) && rows.length >= ROW_CAP) truncated.push(symbol);
      const clean = (Array.isArray(rows) ? rows : [])
        .filter((r) => r.date && Number.isFinite(r.adjClose) && r.adjClose > 0)
        .map((r) => [r.date, r.adjClose])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (clean.length) bars.set(symbol, clean);
    } catch {
      failed.push(symbol);
    }
    progress('prices', ++done, need.size);
  });

  // Silent truncation would lop off the oldest years and quietly shorten the
  // backtest. Fetch in date chunks if this ever fires.
  if (truncated.length) {
    console.error(
      `\n  ${truncated.length} symbol(s) hit the ${ROW_CAP}-row cap ` +
        `(${truncated.slice(0, 5).join(' ')}) - history is being truncated`
    );
    process.exit(1);
  }
  console.log(`\n  priced ${bars.size}/${need.size}${failed.length ? ` (${failed.length} unavailable, long delisted)` : ''}`);

  // --- master calendar: real US sessions only --------------------------------
  // A long-delisted or foreign line can carry bars on days the US market was
  // shut; letting those in would stretch every lookback.
  const dateCount = new Map();
  for (const b of bars.values()) for (const [d] of b) dateCount.set(d, (dateCount.get(d) || 0) + 1);
  const DATES = [...dateCount.entries()].filter(([, n]) => n >= 100).map(([d]) => d).sort();
  const dIdx = new Map(DATES.map((d, i) => [d, i]));
  const N = DATES.length;

  const px = new Map();
  for (const [sym, b] of bars) {
    const a = new Array(N).fill(null);
    for (const [d, c] of b) if (dIdx.has(d)) a[dIdx.get(d)] = c;
    px.set(sym, a);
  }

  // --- benchmarks: $10,000 held, over the identical window -------------------
  // Dividend-adjusted like everything else, so this compares total return with
  // total return. A price-return benchmark would hand the strategy a free few
  // points a year that it did not earn.
  //
  // Two of them, because one alone answers the wrong question. This portfolio
  // holds 50 names in equal amounts; SPY does not - it is dominated by
  // whichever companies are largest, and over this particular decade those did
  // most of the market's work. Measured against SPY alone the weighting scheme
  // and the momentum signal are tangled together, and the signal takes the
  // blame for both. RSP is the same index equally weighted, so it isolates the
  // part this strategy actually chose: which 50 names, not how to size them.
  for (const b of BENCHMARKS) {
    const rows = await fmp('historical-price-eod/dividend-adjusted', {
      symbol: b.symbol,
      from: iso(from),
      to,
    });
    const byDate = new Map(
      (Array.isArray(rows) ? rows : [])
        .filter((r) => r.date && Number.isFinite(r.adjClose) && r.adjClose > 0)
        .map((r) => [r.date, r.adjClose])
    );
    if (byDate.size < 200) {
      console.error(`  ${b.symbol} returned only ${byDate.size} usable bars`);
      process.exit(1);
    }
    // Forward-filled onto the master calendar so a missing print never leaves
    // a hole the comparison would have to guess at.
    const filled = new Array(N).fill(null);
    let carried = null;
    for (let i = 0; i < N; i++) {
      const v = byDate.get(DATES[i]);
      if (v != null) carried = v;
      filled[i] = carried;
    }
    b.aligned = filled;
  }

  // --- formation dates: last trading day of each month -----------------------
  const monthEnds = [];
  for (let i = 1; i < N; i++) if (DATES[i].slice(0, 7) !== DATES[i - 1].slice(0, 7)) monthEnds.push(i - 1);

  // Whole months: the first entry is the first trading day of START_MONTH,
  // not a mid-month date.
  const formations = monthEnds.filter(
    (i) => i + 1 < N && DATES[i + 1].slice(0, 7) >= START_MONTH && i - 12 * M >= 0
  );
  // One formation per month between the start and now, less a little slack.
  const [sy, sm] = START_MONTH.split('-').map(Number);
  const expected = (today.getUTCFullYear() - sy) * 12 + (today.getUTCMonth() + 1 - sm);
  if (formations.length < expected * 0.9) {
    console.error(
      `  only ${formations.length} formation dates, expected ~${expected} - not enough history`
    );
    process.exit(1);
  }

  // --- select and simulate ---------------------------------------------------
  // Coverage is recorded at every formation, not just checked: if the share of
  // the roster that can be scored ever sags, the backtest is drifting toward
  // survivors and the number it prints stops meaning what it says.
  const coverage = [];
  const pick = (i) => {
    const roster = rosterAt(DATES[i]);
    const scored = [];
    for (const sym of roster) {
      const a = px.get(sym);
      if (!a) continue;
      const then = a[i - 12 * M];
      const near = a[i - M];
      if (then == null || near == null || then <= 0) continue;
      scored.push({ sym, mom: near / then - 1 });
    }
    scored.sort((a, b) => b.mom - a.mom);
    const share = roster.size ? scored.length / roster.size : 0;
    coverage.push({ date: DATES[i], share, scored: scored.length, roster: roster.size });
    if (share < COVERAGE_FLOOR) {
      console.error(
        `  ${DATES[i]}: only ${scored.length}/${roster.size} ` +
          `(${(share * 100).toFixed(0)}%) of the roster is scoreable, ` +
          `floor is ${(COVERAGE_FLOOR * 100).toFixed(0)}%`
      );
      process.exit(1);
    }
    return scored.slice(0, TOP).map((s) => s.sym);
  };

  const lastPriceUpTo = (sym, i) => {
    const a = px.get(sym);
    for (let k = i; k >= 0; k--) if (a[k] != null) return a[k];
    return null;
  };

  const series = [];
  const formationLog = [];
  let units = null; // Map symbol -> units held
  let value = START_CASH;

  for (let f = 0; f < formations.length; f++) {
    const formIdx = formations[f];
    const entryIdx = formIdx + 1;
    const holdings = pick(formIdx);
    formationLog.push({ measured: DATES[formIdx], entered: DATES[entryIdx], holdings });

    // Re-cut the book into 50 equal slices at the entry close.
    units = new Map();
    const alloc = value / TOP;
    for (const sym of holdings) {
      const p = lastPriceUpTo(sym, entryIdx);
      units.set(sym, p ? alloc / p : 0);
    }

    // Walk daily until the next entry day (or the end of the data).
    const stop = f + 1 < formations.length ? formations[f + 1] + 1 : N - 1;
    for (let i = entryIdx; i <= stop; i++) {
      let v = 0;
      for (const [sym, u] of units) {
        const p = lastPriceUpTo(sym, i);
        v += p ? u * p : 0;
      }
      value = v;
      // The stop day is the next month's entry: it gets pushed by the next
      // loop iteration after the rebalance, not twice.
      if (i < stop || f + 1 === formations.length) {
        series.push([DATES[i], Math.round(value * 100) / 100]);
      }
    }
  }

  // --- sanity, then write ----------------------------------------------------
  // ~252 sessions a year since START_MONTH, less generous slack.
  const minPoints = Math.floor(expected * 21 * 0.9);
  if (series.length < minPoints) {
    console.error(`  series has only ${series.length} points, expected ~${expected * 21}`);
    process.exit(1);
  }
  for (let i = 1; i < series.length; i++) {
    if (!(series[i][0] > series[i - 1][0]) || !Number.isFinite(series[i][1]) || series[i][1] <= 0) {
      console.error(`  bad series point at ${series[i][0]}`);
      process.exit(1);
    }
  }

  // Each benchmark rides the same dates as the portfolio, so it is stored as
  // bare values positionally aligned to `series` - alignment by construction
  // rather than by two date columns that could drift apart.
  const benchmarks = BENCHMARKS.map((b) => {
    const base = b.aligned[dIdx.get(series[0][0])];
    if (!(base > 0)) {
      console.error(`  no ${b.symbol} price at the start date ${series[0][0]}`);
      process.exit(1);
    }
    const values = series.map(([d]) => {
      const v = b.aligned[dIdx.get(d)];
      return Math.round(START_CASH * (v / base) * 100) / 100;
    });
    if (values.length !== series.length || values.some((v) => !Number.isFinite(v) || v <= 0)) {
      console.error(`  ${b.symbol} series is misaligned or has bad values`);
      process.exit(1);
    }
    return { symbol: b.symbol, name: b.name, values };
  });

  const out = {
    // The last covered session, not the wall clock: a run that adds no new
    // session then produces a byte-identical file and the nightly job commits
    // nothing.
    generatedAt: series[series.length - 1][0],
    startValue: START_CASH,
    top: TOP,
    signal: '12-1 momentum',
    universe: 'S&P 500, point-in-time membership',
    rebalance: 'monthly',
    // The worst roster coverage any formation ran at - the honest reader's
    // first question about a backtest this long.
    minCoverage: Math.round(Math.min(...coverage.map((c) => c.share)) * 1000) / 1000,
    benchmarks,
    series,
    formations: formationLog,
  };
  writeFileSync('assets/data/research.json', JSON.stringify(out));

  const first = series[0], last = series[series.length - 1];
  console.log(`  ${series.length} daily points, ${first[0]} -> ${last[0]}`);
  console.log(`  $${START_CASH.toLocaleString()} -> $${last[1].toLocaleString()} (${(((last[1] / START_CASH) - 1) * 100).toFixed(1)}%)`);
  console.log(`  ${formationLog.length} rebalances, latest holdings: ${formationLog[formationLog.length - 1].holdings.slice(0, 8).join(' ')}...`);

  // Peak-to-trough on the daily series: the crashes are the reason for the
  // longer window, so they get printed rather than left to the eye.
  const drawdown = (vals) => {
    let peak = vals[0], mdd = 0, at = 0;
    vals.forEach((v, i) => {
      if (v > peak) peak = v;
      const dd = v / peak - 1;
      if (dd < mdd) { mdd = dd; at = i; }
    });
    return { mdd, at };
  };
  const pd = drawdown(series.map(([, v]) => v));
  console.log(`  max drawdown ${(pd.mdd * 100).toFixed(1)}% (trough ${series[pd.at][0]})`);
  for (const b of benchmarks) {
    const end = b.values[b.values.length - 1];
    const bd = drawdown(b.values);
    console.log(
      `  ${b.symbol} $${START_CASH.toLocaleString()} -> $${end.toLocaleString()} ` +
        `(${(((end / START_CASH) - 1) * 100).toFixed(1)}%), ` +
        `max drawdown ${(bd.mdd * 100).toFixed(1)}% (trough ${series[bd.at][0]})`
    );
  }

  const worst = coverage.reduce((a, b) => (b.share < a.share ? b : a));
  const mean = coverage.reduce((s, c) => s + c.share, 0) / coverage.length;
  console.log(
    `  roster coverage: mean ${(mean * 100).toFixed(1)}%, ` +
      `worst ${(worst.share * 100).toFixed(1)}% at ${worst.date} ` +
      `(${worst.scored}/${worst.roster})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
