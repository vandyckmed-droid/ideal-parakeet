// What should SUE be divided by, and over how many quarters?
//
// The denominator is the whole idea - it is what makes a $0.05 beat mean one
// thing for a steady name and another for a wild one. The 8-quarter analyst-
// error window used in the first pass was a convention, not a finding, so this
// sweeps the two textbook denominators across five lookbacks and three
// horizons and reports every cell.
//
//   forecast-error SUE   (actual - estimate) / SD(prior forecast errors)
//   time-series SUE      (EPS_t - EPS_t-4)   / SD(prior seasonal differences)
//
// The second is Foster-Olsen-Shevlin's original and needs no analyst estimate
// at all, so it reaches the 19% of reports that carry no consensus.
//
// Run from the repo root, after stage 5.

import { readFileSync, readdirSync } from 'node:fs';

const ROOT = process.cwd();
const ds = JSON.parse(readFileSync(`${ROOT}/assets/data/market.json`, 'utf8'));
const DATES = ds.dates;
const LAST = DATES.length - 1;
const idxOf = new Map(DATES.map((d, i) => [d, i]));

function tIdx(d) {
  if (idxOf.has(d)) return idxOf.get(d);
  let lo = 0, hi = LAST;
  while (lo < hi) { const m = (lo + hi) >> 1; if (DATES[m] < d) lo = m + 1; else hi = m; }
  return DATES[lo] >= d ? lo : -1;
}

const tk = new Map(ds.tickers.map((t) => [t.s, t]));
const cAt = (t, i) => { const k = i - t.o; return k >= 0 && k < t.p.length ? t.p[k] : null; };

const mkt = new Array(DATES.length).fill(0);
for (let i = 1; i <= LAST; i++) {
  let s = 0, n = 0;
  for (const t of ds.tickers) { const a = cAt(t, i - 1), b = cAt(t, i); if (a && b) { s += b / a - 1; n++; } }
  mkt[i] = n ? s / n : 0;
}
const cum = new Array(DATES.length).fill(0);
for (let i = 1; i <= LAST; i++) cum[i] = cum[i - 1] + mkt[i];

const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

// One record per report, carrying every SUE variant we want to compare.
function build(lookback) {
  const out = [];
  for (const f of readdirSync(`${ROOT}/data/earnings`)) {
    const sym = f.replace('.json', '');
    const t = tk.get(sym);
    if (!t) continue;
    const rep = JSON.parse(readFileSync(`${ROOT}/data/earnings/${f}`, 'utf8'));
    const minPrior = Math.max(4, Math.ceil(lookback * 0.6));

    for (let k = 0; k < rep.length; k++) {
      const r = rep[k];
      const ann = tIdx(r.date);
      if (ann < 1 || ann > LAST) continue;

      // --- forecast-error SUE ---
      let sueF = null;
      if (r.epsEstimated !== null) {
        const prior = [];
        for (let j = k - 1; j >= 0 && prior.length < lookback; j--) {
          if (rep[j].epsEstimated !== null) prior.push(rep[j].epsActual - rep[j].epsEstimated);
        }
        if (prior.length >= minPrior) {
          const s = sd(prior);
          if (s > 1e-6) sueF = (r.epsActual - r.epsEstimated) / s;
        }
      }

      // --- time-series SUE (seasonal difference) ---
      let sueT = null;
      if (k >= 4) {
        const diffs = [];
        for (let j = k - 1; j >= 4 && diffs.length < lookback; j--) diffs.push(rep[j].epsActual - rep[j - 4].epsActual);
        if (diffs.length >= minPrior) {
          const s = sd(diffs);
          if (s > 1e-6) sueT = (r.epsActual - rep[k - 4].epsActual) / s;
        }
      }

      if (sueF === null && sueT === null) continue;
      out.push({ t, ann, sueF, sueT });
    }
  }
  return out;
}

function score(rows, key, hold) {
  const pts = [];
  for (const o of rows) {
    const v = o[key];
    if (v === null || !Number.isFinite(v)) continue;
    const e = o.ann + 2, x = o.ann + 2 + hold;
    if (x > LAST) continue;
    if (!cAt(o.t, e) || !cAt(o.t, x)) continue;
    pts.push({ v, ab: cAt(o.t, x) / cAt(o.t, e) - 1 - (cum[x] - cum[e]) });
  }
  if (pts.length < 250) return null;
  pts.sort((a, b) => a.v - b.v);
  const q = Math.floor(pts.length / 5);
  const m = (a) => a.reduce((s, x) => s + x.ab, 0) / a.length;
  const vr = (a) => { const u = m(a); return a.reduce((s, x) => s + (x.ab - u) ** 2, 0) / (a.length - 1); };
  const lo = pts.slice(0, q), hi = pts.slice(-q);
  const sp = m(hi) - m(lo);
  return { n: pts.length, sp, t: sp / Math.sqrt(vr(hi) / q + vr(lo) / q) };
}

console.log('top-minus-bottom quintile, market-relative, entry +2d after the report');
console.log('every cell shown; at 30 cells ~1-2 will clear |t|=2 by chance\n');
console.log('denominator        lookback   hold      n    spread       t');

for (const [label, key] of [['forecast-error', 'sueF'], ['time-series', 'sueT']]) {
  for (const lb of [4, 8, 12, 16, 20]) {
    const rows = build(lb);
    for (const h of [5, 20, 60]) {
      const c = score(rows, key, h);
      if (!c) continue;
      const flag = Math.abs(c.t) >= 2 ? '  <-' : '';
      console.log(
        `${label.padEnd(18)} ${String(lb).padStart(4)}q  ${String(h).padStart(4)}d ${String(c.n).padStart(6)}  ${(c.sp * 100).toFixed(2).padStart(7)}%  ${c.t.toFixed(2).padStart(6)}${flag}`
      );
    }
  }
}
