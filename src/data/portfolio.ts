import { LAST_INDEX, Ticker, closeAt } from './market';

/**
 * A synthetic Ticker for $1 invested equally across every name in `basket`,
 * rebalanced daily. Building an actual Ticker-shaped object - rather than a
 * bespoke return/vol calculation - means every piece of window machinery
 * that already exists for a single name (computeWindowStats, the vol floor,
 * the skip ladder, the "clamped to listing date" convention) applies to a
 * whole watchlist for free, with no separate maths to keep in sync.
 *
 * Its "listing date" is the latest listing date among the basket's own
 * members: an equal-weighted portfolio is well-defined only from the day
 * every one of its holdings actually has a price. Before that day, the
 * portfolio simply doesn't exist yet - exactly how a real ticker's history
 * before its own offset doesn't exist, handled by the same null-returning
 * paths already in place.
 *
 * Returns null for an empty basket; a one-name basket is well-defined (its
 * own return series) but is the caller's call whether showing "the
 * portfolio" for a single holding is worth the screen space.
 */
export function buildPortfolioTicker(basket: Ticker[]): Ticker | null {
  if (basket.length === 0) return null;

  let offset = 0;
  for (const t of basket) offset = Math.max(offset, t.offset);

  const length = LAST_INDEX - offset + 1;
  const closes = new Array<number>(length);
  closes[0] = 100;
  for (let k = 1; k < length; k++) {
    const i = offset + k;
    let sum = 0;
    for (const t of basket) {
      // Safe: i >= t.offset for every basket member once k >= 1, since
      // `offset` is already the max of every member's own offset.
      const prev = closeAt(t, i - 1)!;
      const cur = closeAt(t, i)!;
      sum += cur / prev - 1;
    }
    closes[k] = closes[k - 1] * (1 + sum / basket.length);
  }

  return {
    symbol: 'PORTFOLIO',
    name: 'Your watchlist, equally weighted',
    sector: '',
    industry: '',
    country: '',
    exchange: '',
    marketCap: 0,
    dollarVolume: 0,
    offset,
    closes,
    lastClose: closes[closes.length - 1],
  };
}
