// Calendar-time portfolios: the standard way to test a holding period without
// throwing away 90% of the sample.
//
// The previous test used non-overlapping periods to keep observations
// independent, which is honest but left fifteen numbers to judge a 12-month
// hold on. Jegadeesh-Titman's method recovers the power properly: run H
// overlapping cohorts at once, each holding 1/H of the book, and the strategy's
// *monthly* return series is then a single time series with ~190 observations
// that can be t-tested directly. It is testing a real, implementable portfolio
// rather than a sequence of disconnected bets.
//
// Universe is point-in-time S&P 500 membership at each formation date, so
// bankruptcies and removals are in the loser leg where they belong.
//
// Signals include the ones the previous pass missed - residual momentum, the
// MAX lottery effect, idiosyncratic volatility, volatility-scaled momentum -
// because those are where the more recent evidence sits.

import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'data/research-prices';
const timeline = JSON.parse(readFileSync('data/sp500/timeline.json', 'utf8'))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

// --- calendar: real US sessions only ----------------------------------------
const series = new Map();
const dateCount = new Map();
for (const f of readdirSync(DIR)) {
  const bars = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  if (!bars.length) continue;
  series.set(f.replace('.json', ''), bars);
  for (const [d] of bars) dateCount.set(d, (dateCount.get(d) || 0) + 1);
}
const DATES = [...dateCount.entries()].filter(([, n]) => n >= 100).map(([d]) => d).sort();
const dIdx = new Map(DATES.map((d, i) => [d, i]));
const N = DATES.length;

const px = new Map();
for (const [sym, bars] of series) {
  const a = new Array(N).fill(null);
  for (const [d, c] of bars) if (dIdx.has(d)) a[dIdx.get(d)] = c;
  px.set(sym, a);
}
const SYMS = [...px.keys()];

// daily simple returns, null where either end is missing
const ret1 = new Map();
for (const s of SYMS) {
  const a = px.get(s);
  const r = new Array(N).fill(null);
  for (let i = 1; i < N; i++) if (a[i] != null && a[i - 1] != null) r[i] = a[i] / a[i - 1] - 1;
  ret1.set(s, r);
}

// equal-weighted market, for the market model
const mktR = new Array(N).fill(0);
for (let i = 1; i < N; i++) {
  let s = 0, n = 0;
  for (const sym of SYMS) { const v = ret1.get(sym)[i]; if (v != null) { s += v; n++; } }
  mktR[i] = n ? s / n : 0;
}

const monthEnd = [];
for (let i = 1; i < N; i++) if (DATES[i].slice(0, 7) !== DATES[i - 1].slice(0, 7)) monthEnd.push(i - 1);
const M = 21;

function membersAt(i) {
  const d = DATES[i];
  let best = null;
  for (const s of timeline) { if (s.date <= d) best = s; else break; }
  return best ? best.members.filter((m) => px.has(m)) : [];
}

// --- market-model residuals over a trailing window ---------------------------
// Cached per (symbol, formation index) because several signals want them.
const residCache = new Map();
function residuals(sym, i, win = 12 * M) {
  const key = `${sym}:${i}`;
  if (residCache.has(key)) return residCache.get(key);
  const r = ret1.get(sym);
  const lo = i - win;
  let out = null;
  if (lo >= 1) {
    let sxy = 0, sxx = 0, n = 0, my = 0, mx = 0;
    for (let k = lo; k <= i; k++) if (r[k] != null) { mx += mktR[k]; my += r[k]; n++; }
    if (n > win * 0.6) {
      mx /= n; my /= n;
      for (let k = lo; k <= i; k++) if (r[k] != null) { sxy += (mktR[k] - mx) * (r[k] - my); sxx += (mktR[k] - mx) ** 2; }
      const beta = sxx > 1e-12 ? sxy / sxx : 1;
      const e = [];
      for (let k = lo; k <= i; k++) if (r[k] != null) e.push(r[k] - beta * mktR[k]);
      out = { beta, e };
    }
  }
  residCache.set(key, out);
  return out;
}

const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
function cumRet(sym, a, b) {
  const p = px.get(sym);
  if (a < 0 || p[a] == null) return null;
  if (p[b] != null) return p[b] / p[a] - 1;
  for (let k = Math.min(b, N - 1); k > a; k--) if (p[k] != null) return p[k] / p[a] - 1;
  return null;
}

const SIGNALS = {
  'momentum 12-1': (s, i) => cumRet(s, i - 12 * M, i - M),
  'momentum 12-0': (s, i) => cumRet(s, i - 12 * M, i),
  'momentum 6-1': (s, i) => cumRet(s, i - 6 * M, i - M),
  'momentum 12-2': (s, i) => cumRet(s, i - 12 * M, i - 2 * M),
  'residual momentum': (s, i) => {
    const R = residuals(s, i - M);
    if (!R || R.e.length < 100) return null;
    const tail = R.e.slice(-11 * M);
    const v = sd(tail);
    return v > 1e-9 ? tail.reduce((a, b) => a + b, 0) / v : null;
  },
  'vol-scaled momentum': (s, i) => {
    const m = cumRet(s, i - 12 * M, i - M);
    const R = residuals(s, i);
    if (m === null || !R) return null;
    const v = sd(R.e.slice(-6 * M));
    return v > 1e-9 ? m / v : null;
  },
  'MAX (neg, lottery)': (s, i) => {
    const r = ret1.get(s);
    let mx = -Infinity, n = 0;
    for (let k = i - M + 1; k <= i; k++) if (r[k] != null) { if (r[k] > mx) mx = r[k]; n++; }
    return n > 10 ? -mx : null;
  },
  'idio vol (neg)': (s, i) => {
    const R = residuals(s, i);
    return R && R.e.length > 100 ? -sd(R.e) : null;
  },
  'beta (neg)': (s, i) => { const R = residuals(s, i); return R ? -R.beta : null; },
};

// --- calendar-time evaluation -------------------------------------------------
function evaluate(fn, holdMonths) {
  // Legs formed at each month end.
  const legs = [];
  for (const i of monthEnd) {
    const universe = membersAt(i);
    const rows = [];
    for (const s of universe) {
      const v = fn(s, i);
      if (v != null && Number.isFinite(v)) rows.push({ s, v });
    }
    if (rows.length < 100) { legs.push(null); continue; }
    rows.sort((a, b) => a.v - b.v);
    const q = Math.floor(rows.length / 5);
    legs.push({ win: rows.slice(-q).map((r) => r.s), lose: rows.slice(0, q).map((r) => r.s) });
  }

  // Monthly return of a set of names over month m.
  const monthRet = (names, m) => {
    const a = monthEnd[m - 1], b = monthEnd[m];
    let s = 0, n = 0;
    for (const sym of names) { const r = cumRet(sym, a, b); if (r != null) { s += r; n++; } }
    return n ? s / n : null;
  };

  const monthly = [];   // long/short
  const longOnly = [];  // top quintile minus the equal-weighted index
  for (let m = 1; m < monthEnd.length; m++) {
    const parts = [], lparts = [];
    // What simply owning the whole index returned this month - the benchmark
    // anyone actually has the option of buying instead.
    const bench = monthRet(membersAt(monthEnd[m - 1]), m);
    for (let age = 1; age <= holdMonths; age++) {
      const f = m - age;
      if (f < 0 || !legs[f]) continue;
      const w = monthRet(legs[f].win, m);
      const l = monthRet(legs[f].lose, m);
      if (w != null && l != null) parts.push(w - l);
      if (w != null && bench != null) lparts.push(w - bench);
    }
    if (parts.length === holdMonths) monthly.push(parts.reduce((a, b) => a + b, 0) / parts.length);
    if (lparts.length === holdMonths) longOnly.push(lparts.reduce((a, b) => a + b, 0) / lparts.length);
  }
  if (monthly.length < 36) return null;

  const mu = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  const s = sd(monthly);
  // Worst drawdown of the long/short book, compounded.
  let eq = 1, peak = 1, dd = 0;
  for (const r of monthly) { eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); }
  const lmu = longOnly.reduce((a, b) => a + b, 0) / longOnly.length;
  const ls = sd(longOnly);
  return {
    n: monthly.length,
    annual: mu * 12,
    t: mu / (s / Math.sqrt(monthly.length)),
    sharpe: (mu * 12) / (s * Math.sqrt(12)),
    dd,
    hit: monthly.filter((x) => x > 0).length / monthly.length,
    lAnnual: lmu * 12,
    lT: lmu / (ls / Math.sqrt(longOnly.length)),
    lHit: longOnly.filter((x) => x > 0).length / longOnly.length,
  };
}

console.log('long/short quintile, calendar-time overlapping cohorts, point-in-time S&P 500');
console.log('monthly return series t-tested; ann = annualised mean, dd = worst drawdown\n');
console.log('                            LONG/SHORT                    LONG ONLY vs index');
console.log('signal                 hold     ann       t      dd      ann       t    hit');
const all = [];
for (const [name, fn] of Object.entries(SIGNALS)) {
  for (const h of [1, 3, 6, 12]) {
    const r = evaluate(fn, h);
    if (!r) continue;
    all.push({ name, h, ...r });
    const flag = Math.abs(r.t) >= 2 ? '  <-' : '';
    const lflag = Math.abs(r.lT) >= 2 ? '  <=' : '';
    console.log(
      `${name.padEnd(21)} ${String(h).padStart(3)}m  ${(r.annual * 100).toFixed(1).padStart(6)}%  ${r.t.toFixed(2).padStart(6)}  ${(r.dd * 100).toFixed(0).padStart(5)}%  ${(r.lAnnual * 100).toFixed(1).padStart(7)}%  ${r.lT.toFixed(2).padStart(6)}  ${(r.lHit * 100).toFixed(0).padStart(3)}%${flag}${lflag}`
    );
  }
  console.log('');
}
console.log(`${all.length} cells tested; at 5% roughly ${(all.length * 0.05).toFixed(1)} would clear |t|=2 by chance.`);
