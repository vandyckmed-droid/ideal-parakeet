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
export type FamilyTicker = Ticker & { members: number };

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
    return {
      symbol: f.key,
      name: `${f.n} members`,
      sector: '',
      industry: '',
      country: '',
      exchange: '',
      marketCap: f.n,
      dollarVolume: f.n,
      offset: aligned.offset,
      closes: aligned.closes,
      lastClose: aligned.closes[aligned.closes.length - 1],
      members: f.n,
    };
  })
  .filter((x): x is FamilyTicker => x != null);
