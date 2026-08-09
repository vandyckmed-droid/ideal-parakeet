import raw from '../../assets/data/market.json';

/**
 * Shape of the bundled snapshot. Keys are terse because this file ships inside
 * the app bundle and is parsed on every cold start.
 *
 * Every series is aligned to one master trading calendar: `p[i]` is the
 * adjusted close on `dates[o + i]`. That invariant is what lets the whole app
 * express a date window as a pair of integers and never search by date.
 */
export type RawTicker = {
  s: string; // symbol
  n: string; // company name
  se: string; // sector
  in: string; // industry
  cy: string; // country of domicile
  x: string; // listing exchange
  mc: number; // market capitalisation
  adv: number; // median daily dollar volume
  o: number; // index into `dates` of this series' first close
  p: number[]; // split- and dividend-adjusted closes
};

export type Ticker = {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  country: string;
  exchange: string;
  marketCap: number;
  dollarVolume: number;
  offset: number;
  closes: number[];
  lastClose: number;
};

/**
 * The correlation grouping the Market tab's third view is built on. Packed by
 * the pipeline because the Ledoit-Wolf sweep is O(N^2 T) and has no business
 * running on a phone; the clustering that consumes it is cheap and runs here,
 * because the number of groups is the user's to choose.
 */
export type RawGrouping = {
  symbols: string[];
  sessions: number;
  from: string;
  to: string;
  shrinkage: number;
  averageCorrelation: number;
  distances: string; // base64, one byte per upper-triangle pair
};

const dataset = raw as unknown as {
  generatedAt: string;
  dates: string[];
  market: { s: string; o: number; p: number[] };
  tickers: RawTicker[];
  grouping?: RawGrouping;
};

export const GROUPING_RAW: RawGrouping | undefined = dataset.grouping;

export const DATES: string[] = dataset.dates;
export const GENERATED_AT: string = dataset.generatedAt;
export const LAST_INDEX = DATES.length - 1;

export const TICKERS: Ticker[] = dataset.tickers.map((t) => ({
  symbol: t.s,
  name: t.n,
  sector: t.se,
  industry: t.in,
  country: t.cy,
  exchange: t.x,
  marketCap: t.mc,
  dollarVolume: t.adv,
  offset: t.o,
  closes: t.p,
  lastClose: t.p[t.p.length - 1],
}));

export const BY_SYMBOL = new Map(TICKERS.map((t) => [t.symbol, t]));

/**
 * The market every name is measured against for the residual metric - SPY,
 * packed on the same calendar by stage 3 but deliberately outside `TICKERS`:
 * it is the yardstick, not a constituent, and must never appear in a ranking
 * of index members.
 *
 * Shaped like a Ticker so `closeAt` and `slice` work on it unchanged.
 */
export const MARKET: Ticker = {
  symbol: dataset.market.s,
  name: dataset.market.s,
  sector: '',
  industry: '',
  country: '',
  exchange: '',
  marketCap: 0,
  dollarVolume: 0,
  offset: dataset.market.o,
  closes: dataset.market.p,
  lastClose: dataset.market.p[dataset.market.p.length - 1],
};

export const SECTORS = [...new Set(TICKERS.map((t) => t.sector))].sort();

/** Close on a master-calendar index, or null if the name had not listed yet. */
export function closeAt(t: Ticker, index: number): number | null {
  const local = index - t.offset;
  if (local < 0 || local >= t.closes.length) return null;
  return t.closes[local];
}

/** Closes over an inclusive master-calendar index range, clipped to listing. */
export function slice(t: Ticker, from: number, to: number): number[] {
  const lo = Math.max(from - t.offset, 0);
  const hi = Math.min(to - t.offset, t.closes.length - 1);
  if (hi < lo) return [];
  return t.closes.slice(lo, hi + 1);
}

/** Nearest valid master-calendar index for a YYYY-MM-DD string. */
export function indexForDate(date: string): number {
  let lo = 0;
  let hi = LAST_INDEX;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (DATES[mid] < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function formatDateShort(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[m - 1]} ${d}`;
}
