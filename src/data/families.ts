import { DATES, LAST_INDEX, Ticker } from './market';
import { RESEARCH } from './research';

/**
 * The 38 industry families as Ticker-shaped series, so every piece of stock
 * machinery - computeWindowStats, the skip, the residual regression, the
 * sparkline - works on a family without knowing it is one.
 *
 * The family indices are built by the pipeline on research.json's calendar
 * ($10,000 equal-weight in each family's point-in-time index members,
 * rebalanced monthly); here each series is re-aligned onto the app's master
 * calendar by date, forward-filling any master session the research calendar
 * lacks - the same tolerance stage 3 applies to a missing print. The two
 * calendars regenerate together nightly, so gaps are a transient midday state,
 * not a steady one.
 *
 * `marketCap` and `dollarVolume` carry the member count: the Size sort then
 * means "biggest family first", which is the only size a family has.
 */
export type FamilyTicker = Ticker & {
  /** Current member count - holdings.length when the payload carries it. */
  members: number;
  /** Current constituents in the family, the ETF-page sense of holdings. */
  holdings: string[];
};

function align(values: number[]): { offset: number; closes: number[] } | null {
  const fd = RESEARCH.familyDates;
  const byDate = new Map(fd.map((d, i) => [d, values[i]]));

  let offset = -1;
  for (let i = 0; i < DATES.length; i++) {
    if (byDate.has(DATES[i])) {
      offset = i;
      break;
    }
  }
  if (offset < 0) return null;

  const closes = new Array(LAST_INDEX - offset + 1);
  let last = byDate.get(DATES[offset]) as number;
  for (let i = offset; i <= LAST_INDEX; i++) {
    const v = byDate.get(DATES[i]);
    if (v != null) last = v;
    closes[i - offset] = last;
  }
  return { offset, closes };
}

export const FAMILY_TICKERS: FamilyTicker[] = (RESEARCH.families ?? [])
  .map((f) => {
    const aligned = align(f.values);
    if (!aligned) return null;
    // Prefer the exported current holdings; fall back to the formation-time
    // count for a payload from before `members` existed.
    const holdings = f.members ?? [];
    const count = holdings.length || f.n;
    return {
      symbol: f.key,
      name: `${count} members`,
      sector: '',
      industry: '',
      country: '',
      exchange: '',
      marketCap: count,
      dollarVolume: count,
      offset: aligned.offset,
      closes: aligned.closes,
      lastClose: aligned.closes[aligned.closes.length - 1],
      members: count,
      holdings,
    };
  })
  .filter((x): x is FamilyTicker => x != null);

export const FAMILY_BY_KEY = new Map(FAMILY_TICKERS.map((f) => [f.symbol, f]));

/** Reverse lookup: which family a stock belongs to, if any. */
const FAMILY_OF_SYMBOL = new Map<string, string>();
for (const f of FAMILY_TICKERS) {
  for (const sym of f.holdings) FAMILY_OF_SYMBOL.set(sym, f.symbol);
}

export function familyOfSymbol(symbol: string): string | null {
  return FAMILY_OF_SYMBOL.get(symbol) ?? null;
}
