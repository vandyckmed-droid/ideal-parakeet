// Step 5 - build the Research tab's series: $10,000 in the top-50 momentum
// portfolio over the previous four quarters, written to assets/data/research.json.
//
// The rules, exactly as displayed in the app:
//
//   Universe   S&P 500 membership as of each measurement date, reconstructed
//              from the index change log. Point in time: names later removed
//              or delisted are included while they were members. This is the
//              only universe with verifiable historical membership available,
//              which is why it stands in for the app's own 500.
//   Signal     12-1 momentum - total return from 12 months before the
//              measurement date to 1 month before it (the recent month is
//              skipped, the same reversal logic as the app's Skip control).
//   Selection  The 50 highest, equally weighted.
//   Rebalance  Measured at the last trading day of each month, traded at the
//              close of the first trading day of the next month, per
//              docs/rebalancing-standard.md. Held untouched in between.
//   Period     The previous four quarters. $10,000 at the start. Dividends
//              are in via adjusted closes. No taxes or fees.
//   Delisting  A holding that stops trading mid-month is frozen at its last
//              close (equivalent to holding the proceeds in cash) until the
//              next rebalance.
//
// Prices are fetched fresh every run - history is cheap and a cache here would
// be one more way to serve yesterday's answer.

import { writeFileSync } from 'node:fs';
import { fmp, mapPool, progress } from './lib/fmp.mjs';

const TOP = 50;
const START_CASH = 10_000;
const MONTHS_BACK = 12; // previous four quarters
const M = 21; // trading days per month for the momentum lookbacks
const CONCURRENCY = 8;

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
  const windowStart = new Date(today);
  windowStart.setMonth(windowStart.getMonth() - (MONTHS_BACK + 2));
  const need = new Set();
  const probe = new Date(windowStart);
  while (probe <= today) {
    for (const s of rosterAt(iso(probe))) need.add(s);
    probe.setMonth(probe.getMonth() + 1);
  }
  console.log(`  ${need.size} symbols were members at some point in the window`);

  // --- prices ----------------------------------------------------------------
  // The earliest formation needs 12 months of history behind it.
  const from = new Date(today);
  from.setMonth(from.getMonth() - (MONTHS_BACK + 14));
  const to = iso(today);

  const bars = new Map();
  let done = 0;
  const failed = [];
  await mapPool([...need], CONCURRENCY, async (symbol) => {
    try {
      const rows = await fmp('historical-price-eod/dividend-adjusted', {
        symbol,
        from: iso(from),
        to,
      });
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

  // --- formation dates: last trading day of each month -----------------------
  const monthEnds = [];
  for (let i = 1; i < N; i++) if (DATES[i].slice(0, 7) !== DATES[i - 1].slice(0, 7)) monthEnds.push(i - 1);

  // "Previous four quarters" counts whole months: the first entry is the
  // first trading day of the month twelve months back, not a mid-month date.
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
  const cutoffMonth = iso(cutoff).slice(0, 7);
  const formations = monthEnds.filter(
    (i) => i + 1 < N && DATES[i + 1].slice(0, 7) >= cutoffMonth && i - 12 * M >= 0
  );
  if (formations.length < MONTHS_BACK) {
    console.error(`  only ${formations.length} formation dates - not enough history`);
    process.exit(1);
  }

  // --- select and simulate ---------------------------------------------------
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
    if (scored.length < TOP + 50) {
      console.error(`  only ${scored.length} scoreable names at ${DATES[i]}`);
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
  if (series.length < 200) {
    console.error(`  series has only ${series.length} points`);
    process.exit(1);
  }
  for (let i = 1; i < series.length; i++) {
    if (!(series[i][0] > series[i - 1][0]) || !Number.isFinite(series[i][1]) || series[i][1] <= 0) {
      console.error(`  bad series point at ${series[i][0]}`);
      process.exit(1);
    }
  }

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
    series,
    formations: formationLog,
  };
  writeFileSync('assets/data/research.json', JSON.stringify(out));

  const first = series[0], last = series[series.length - 1];
  console.log(`  ${series.length} daily points, ${first[0]} -> ${last[0]}`);
  console.log(`  $${START_CASH.toLocaleString()} -> $${last[1].toLocaleString()} (${(((last[1] / START_CASH) - 1) * 100).toFixed(1)}%)`);
  console.log(`  ${formationLog.length} rebalances, latest holdings: ${formationLog[formationLog.length - 1].holdings.slice(0, 8).join(' ')}...`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
