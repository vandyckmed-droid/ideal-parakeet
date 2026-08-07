// What actually predicts 1-12 month returns in this universe?
//
// Monthly formation, quintile spreads, market-relative, on ~16 years of daily
// closes. Reports every signal tried, including the ones that fail.
//
// Two things done deliberately rather than conveniently:
//
//   Non-overlapping periods. A 12-month holding period sampled every month
//   gives twelve overlapping observations per independent one, which inflates
//   a t-stat by roughly sqrt(12). Each horizon here steps its formation dates
//   by the holding length, so the observations really are independent. That
//   buys honesty at the cost of sample size - fifteen observations for the
//   12-month test - and the hit rate is reported alongside the mean because a
//   mean over fifteen numbers is easy to be fooled by.
//
//   Point-in-time earnings. Trailing EPS at a formation date uses only reports
//   whose announcement date had already passed, so no figure is known before
//   it was published.
//
// The bias that cannot be fixed here: this is today's 500 largest, so anything
// that went bankrupt or got acquired is missing. That inflates absolute
// returns badly. It hurts quintile *spreads* less, since both legs are drawn
// from the same survivor pool, but the bottom-quintile leg is the one most
// distorted - the genuinely distressed names are simply absent. Treat every
// spread below as an optimistic reading of the short leg.

import { readFileSync, readdirSync, existsSync } from 'node:fs';

const DIR = 'data/research-prices';
if (!existsSync(DIR)) {
  console.error('  run tools/research/fetch-deep-prices.mjs first');
  process.exit(1);
}

// --- master calendar ---------------------------------------------------------
const series = new Map();
const dateSet = new Set();
for (const f of readdirSync(DIR)) {
  const bars = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  if (bars.length < 300) continue;
  series.set(f.replace('.json', ''), bars);
  for (const [d] of bars) dateSet.add(d);
}
const DATES = [...dateSet].sort();
const dIdx = new Map(DATES.map((d, i) => [d, i]));
const N = DATES.length;

// aligned close arrays, null before listing
const px = new Map();
for (const [sym, bars] of series) {
  const arr = new Array(N).fill(null);
  for (const [d, c] of bars) arr[dIdx.get(d)] = c;
  px.set(sym, arr);
}
const SYMS = [...px.keys()];
console.log(`${SYMS.length} names, ${N} sessions, ${DATES[0]} -> ${DATES[N - 1]}\n`);

// --- earnings, point in time -------------------------------------------------
const earnings = new Map();
if (existsSync('data/earnings')) {
  for (const f of readdirSync('data/earnings')) {
    const sym = f.replace('.json', '');
    if (!px.has(sym)) continue;
    const rows = JSON.parse(readFileSync(`data/earnings/${f}`, 'utf8'))
      .filter((r) => r.epsActual !== null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    earnings.set(sym, rows);
  }
}
/** Sum of the last `n` EPS actuals announced strictly before `date`. */
function trailingEps(sym, date, n = 4) {
  const rows = earnings.get(sym);
  if (!rows) return null;
  let sum = 0;
  let got = 0;
  for (let i = rows.length - 1; i >= 0 && got < n; i--) {
    if (rows[i].date < date) { sum += rows[i].epsActual; got++; }
  }
  return got === n ? sum : null;
}

// --- month ends --------------------------------------------------------------
const monthEnd = [];
for (let i = 1; i < N; i++) if (DATES[i].slice(0, 7) !== DATES[i - 1].slice(0, 7)) monthEnd.push(i - 1);
monthEnd.push(N - 1);

const M = 21; // trading days per month, near enough

// --- signals -----------------------------------------------------------------
// Each returns a number where HIGHER is the prediction of a higher return.
const SIGNALS = {
  'momentum 12-1': (s, i) => ret(s, i - 12 * M, i - M),
  'momentum 12-0': (s, i) => ret(s, i - 12 * M, i),
  'momentum 6-1': (s, i) => ret(s, i - 6 * M, i - M),
  'reversal 1m (neg)': (s, i) => { const r = ret(s, i - M, i); return r === null ? null : -r; },
  'low volatility': (s, i) => { const v = vol(s, i, 12 * M); return v === null ? null : -v; },
  '52-week high prox': (s, i) => {
    const a = px.get(s); const lo = Math.max(0, i - 252);
    if (a[i] === null) return null;
    let hi = 0; for (let k = lo; k <= i; k++) if (a[k] !== null && a[k] > hi) hi = a[k];
    return hi > 0 ? a[i] / hi : null;
  },
  'earnings yield': (s, i) => {
    const e = trailingEps(s, DATES[i]); const a = px.get(s)[i];
    return e === null || !a ? null : e / a;
  },
  'eps growth (4q/4q)': (s, i) => {
    const now = trailingEps(s, DATES[i], 4);
    const rows = earnings.get(s);
    if (now === null || !rows) return null;
    let sum = 0, got = 0, skipped = 0;
    for (let k = rows.length - 1; k >= 0 && got < 4; k--) {
      if (rows[k].date < DATES[i]) { if (skipped < 4) { skipped++; continue; } sum += rows[k].epsActual; got++; }
    }
    if (got < 4 || Math.abs(sum) < 1e-9) return null;
    return (now - sum) / Math.abs(sum);
  },
};

function ret(s, a, b) {
  if (a < 0) return null;
  const arr = px.get(s);
  return arr[a] && arr[b] ? arr[b] / arr[a] - 1 : null;
}
function vol(s, i, n) {
  const arr = px.get(s);
  const lo = i - n;
  if (lo < 1) return null;
  let sum = 0, cnt = 0;
  for (let k = lo + 1; k <= i; k++) if (arr[k] && arr[k - 1]) { sum += Math.log(arr[k] / arr[k - 1]) ** 2; cnt++; }
  return cnt > n * 0.7 ? Math.sqrt((sum / cnt) * 252) : null;
}

// --- evaluation --------------------------------------------------------------
function test(name, fn, holdMonths) {
  const hold = holdMonths * M;
  const spreads = [];
  // Step by the holding length so periods do not overlap.
  for (let m = 0; m < monthEnd.length; m += holdMonths) {
    const i = monthEnd[m];
    const j = i + hold;
    if (j >= N) break;
    const rows = [];
    for (const s of SYMS) {
      const v = fn(s, i);
      const r = ret(s, i, j);
      if (v === null || r === null || !Number.isFinite(v) || !Number.isFinite(r)) continue;
      rows.push({ v, r });
    }
    if (rows.length < 100) continue;
    const mkt = rows.reduce((a, b) => a + b.r, 0) / rows.length;
    rows.sort((a, b) => a.v - b.v);
    const q = Math.floor(rows.length / 5);
    const lo = rows.slice(0, q), hi = rows.slice(-q);
    const mean = (arr) => arr.reduce((a, b) => a + b.r, 0) / arr.length;
    spreads.push((mean(hi) - mkt) - (mean(lo) - mkt));
  }
  if (spreads.length < 6) return null;
  const mu = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const sd = Math.sqrt(spreads.reduce((a, b) => a + (b - mu) ** 2, 0) / (spreads.length - 1));
  const t = mu / (sd / Math.sqrt(spreads.length));
  const hit = spreads.filter((x) => x > 0).length / spreads.length;
  return { n: spreads.length, mu, t, hit };
}

const HOLDS = [1, 3, 6, 12];
console.log('top-minus-bottom quintile spread per holding period, non-overlapping');
console.log('hit = share of periods the spread was positive\n');
console.log('signal                 hold    periods    mean       t     hit');
for (const [name, fn] of Object.entries(SIGNALS)) {
  for (const h of HOLDS) {
    const r = test(name, fn, h);
    if (!r) continue;
    const flag = Math.abs(r.t) >= 2 ? '  <-' : '';
    console.log(
      `${name.padEnd(21)} ${String(h).padStart(3)}m ${String(r.n).padStart(9)}  ${(r.mu * 100).toFixed(2).padStart(7)}%  ${r.t.toFixed(2).padStart(6)}  ${(r.hit * 100).toFixed(0).padStart(3)}%${flag}`
    );
  }
  console.log('');
}
