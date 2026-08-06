// Mirrors src/data/portfolio.ts - if these two ever disagree, the .ts file is
// the one that is wrong.

import { closeAt } from './stats';

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
