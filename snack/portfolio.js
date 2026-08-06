// Mirrors src/data/portfolio.ts - if these two ever disagree, the .ts file is
// the one that is wrong.

import { closeAt, computeWindowStats } from './stats';

/**
 * A synthetic ticker for $1 invested equally across every name in `basket`,
 * rebalanced daily. Shaped exactly like the tickers this app already works
 * with, so the same computeWindowStats (vol floor, skip, window handling)
 * applies to a whole watchlist with no separate maths.
 *
 * Its "listing date" (`o`) is the latest listing date among the basket's own
 * members - a portfolio is well-defined only from the day every holding in
 * it actually has a price.
 */
export function buildPortfolioTicker(basket, lastIndex) {
  if (basket.length === 0) return null;

  let offset = 0;
  for (const t of basket) offset = Math.max(offset, t.o);

  const length = lastIndex - offset + 1;
  const p = new Array(length);
  p[0] = 100;
  for (let k = 1; k < length; k++) {
    const i = offset + k;
    let sum = 0;
    for (const t of basket) {
      const prev = closeAt(t, i - 1);
      const cur = closeAt(t, i);
      sum += cur / prev - 1;
    }
    p[k] = p[k - 1] * (1 + sum / basket.length);
  }

  return {
    s: 'PORTFOLIO',
    n: 'Your watchlist, equally weighted',
    se: '',
    in: '',
    cy: '',
    x: '',
    mc: 0,
    adv: 0,
    o: offset,
    p,
    last: p[p.length - 1],
  };
}

/**
 * How much less volatile the portfolio is than its holdings would be held
 * separately: the equal-weighted average of each holding's own annualised
 * sigma, divided by the portfolio's own annualised sigma. 1.0x means
 * combining these names bought nothing; 2.0x means the combined risk is half
 * what the average holding carries alone.
 *
 * Built entirely from the never-floored sigma on both sides - `annualizedVol`,
 * not the floor-adjusted `ratio` - so this is not subject to VOL_FLOOR at
 * all. That floor exists to stop a single quiet name dominating a
 * return-over-risk ranking; a ratio of two volatilities isn't a ranking a
 * quiet name could dominate, so there is nothing here for the floor to guard
 * against.
 *
 * A holding with too little history in the window (null annualizedVol) is
 * excluded from the average rather than failing the whole calculation.
 */
export function computeDiversificationRatio(basket, startIndex, endIndex, portfolioVol) {
  if (portfolioVol === null || portfolioVol <= 1e-9) return null;

  const vols = basket
    .map((t) => {
      const s = computeWindowStats(t, startIndex, endIndex);
      return s ? s.annualizedVol : null;
    })
    .filter((v) => v !== null);
  if (vols.length === 0) return null;

  const avg = vols.reduce((sum, v) => sum + v, 0) / vols.length;
  return avg / portfolioVol;
}
