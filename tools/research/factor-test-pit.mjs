// The same factor test, on point-in-time S&P 500 membership.
//
// At every formation date the cross-section is the names that were actually in
// the index on that date - including the ones that later went bankrupt, got
// acquired or were dropped. That is the difference between a backtest and a
// story about winners.
//
// Delisting: when a series ends inside a holding period the return is measured
// to the last available bar. That is still kind to the short leg, because a
// bankruptcy's final print is not zero and the true delisting return is worse,
// so any spread reported here remains a mild overstatement of the bad end.

import { readFileSync, readdirSync, existsSync } from 'node:fs';

const DIR = 'data/research-prices';
const timeline = JSON.parse(readFileSync('data/sp500/timeline.json', 'utf8'))
  .filter((s) => s.date <= '2100-01-01')
  .sort((a, b) => (a.date < b.date ? -1 : 1));

const series = new Map();
const dateCount = new Map();
for (const f of readdirSync(DIR)) {
  const bars = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  if (!bars.length) continue;
  series.set(f.replace('.json', ''), bars);
  for (const [d] of bars) dateCount.set(d, (dateCount.get(d) || 0) + 1);
}
// Real US sessions only. Some names in this set are foreign or long-delisted
// and carry bars on days the US market was shut; letting those into the master
// calendar stretches it to ~295 "sessions" a year, which quietly turns a
// 252-step lookback into ten and a half months instead of twelve.
const BUSY = 100;
const DATES = [...dateCount.entries()].filter(([, n]) => n >= BUSY).map(([d]) => d).sort();
const dIdx = new Map(DATES.map((d, i) => [d, i]));
const N = DATES.length;

const px = new Map();
for (const [sym, bars] of series) {
  const arr = new Array(N).fill(null);
  for (const [d, c] of bars) arr[dIdx.get(d)] = c;
  px.set(sym, arr);
}
console.log(`${px.size} names on disk, ${N} sessions, ${DATES[0]} -> ${DATES[N - 1]}\n`);

/** Index members as of a trading-day index. */
function membersAt(i) {
  const d = DATES[i];
  let best = null;
  for (const s of timeline) { if (s.date <= d) best = s; else break; }
  return best ? best.members : [];
}

const monthEnd = [];
for (let i = 1; i < N; i++) if (DATES[i].slice(0, 7) !== DATES[i - 1].slice(0, 7)) monthEnd.push(i - 1);
const M = 21;

/** Return a->b, falling back to the last bar that exists (delisting). */
function ret(sym, a, b) {
  const arr = px.get(sym);
  if (!arr || a < 0 || arr[a] == null) return null;
  if (arr[b] != null) return arr[b] / arr[a] - 1;
  for (let k = Math.min(b, N - 1); k > a; k--) if (arr[k] != null) return arr[k] / arr[a] - 1;
  return null;
}
function vol(sym, i, n) {
  const arr = px.get(sym); const lo = i - n;
  if (!arr || lo < 1) return null;
  let s = 0, c = 0;
  for (let k = lo + 1; k <= i; k++) if (arr[k] && arr[k - 1]) { s += Math.log(arr[k] / arr[k - 1]) ** 2; c++; }
  return c > n * 0.7 ? Math.sqrt((s / c) * 252) : null;
}

const SIGNALS = {
  'momentum 12-1': (s, i) => ret(s, i - 12 * M, i - M),
  'momentum 12-0': (s, i) => ret(s, i - 12 * M, i),
  'momentum 6-1': (s, i) => ret(s, i - 6 * M, i - M),
  'reversal 1m (neg)': (s, i) => { const r = ret(s, i - M, i); return r === null ? null : -r; },
  'low volatility': (s, i) => { const v = vol(s, i, 12 * M); return v === null ? null : -v; },
  '52-week high prox': (s, i) => {
    const a = px.get(s); if (!a || a[i] == null) return null;
    let hi = 0; for (let k = Math.max(0, i - 252); k <= i; k++) if (a[k] != null && a[k] > hi) hi = a[k];
    return hi > 0 ? a[i] / hi : null;
  },
};

function test(fn, holdMonths) {
  const hold = holdMonths * M;
  const spreads = [];
  for (let m = 0; m < monthEnd.length; m += holdMonths) {
    const i = monthEnd[m], j = i + hold;
    if (j >= N) break;
    const universe = membersAt(i);
    const rows = [];
    for (const s of universe) {
      const v = fn(s, i);
      const r = ret(s, i, j);
      if (v == null || r == null || !Number.isFinite(v) || !Number.isFinite(r)) continue;
      rows.push({ v, r });
    }
    if (rows.length < 100) continue;
    rows.sort((a, b) => a.v - b.v);
    const q = Math.floor(rows.length / 5);
    const mean = (arr) => arr.reduce((a, b) => a + b.r, 0) / arr.length;
    spreads.push(mean(rows.slice(-q)) - mean(rows.slice(0, q)));
  }
  if (spreads.length < 6) return null;
  const mu = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const sd = Math.sqrt(spreads.reduce((a, b) => a + (b - mu) ** 2, 0) / (spreads.length - 1));
  const worst = Math.min(...spreads);
  return { n: spreads.length, mu, t: mu / (sd / Math.sqrt(spreads.length)), hit: spreads.filter((x) => x > 0).length / spreads.length, worst };
}

console.log('point-in-time membership, non-overlapping periods');
console.log('worst = the single worst period, because a mean hides what you had to sit through\n');
console.log('signal                 hold  periods    mean       t     hit     worst');
for (const [name, fn] of Object.entries(SIGNALS)) {
  for (const h of [1, 3, 6, 12]) {
    const r = test(fn, h);
    if (!r) continue;
    const flag = Math.abs(r.t) >= 2 ? '  <-' : '';
    console.log(
      `${name.padEnd(21)} ${String(h).padStart(3)}m ${String(r.n).padStart(7)}  ${(r.mu * 100).toFixed(2).padStart(7)}%  ${r.t.toFixed(2).padStart(6)}  ${(r.hit * 100).toFixed(0).padStart(3)}%  ${(r.worst * 100).toFixed(1).padStart(7)}%${flag}`
    );
  }
  console.log('');
}
