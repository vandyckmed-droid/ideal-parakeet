import { Ticker } from './market';
import { MetricKey, computeWindowStats, metricValue } from './stats';
import { PresetKey, windowForPreset, withSkip } from './windows';

/**
 * The horizons the rank table measures, shortest first.
 *
 * `1Y` is labelled 12M so the header reads as one evenly spaced series of
 * months rather than three months and a year.
 *
 * Starts at 3M rather than 1M deliberately. A one-month rank is dominated by
 * short-horizon reversal - whatever moved hardest recently tends to give some
 * of it back - which is the same effect `skipForLength` exists to strip out of
 * a measurement. Ranking on it produces a column that mostly reorders itself
 * every few weeks and predicts the opposite of what it appears to, so it isn't
 * a horizon worth a column beside four that carry signal.
 */
export const HORIZONS: { key: PresetKey; label: string }[] = [
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '9M', label: '9M' },
  { key: '1Y', label: '12M' },
];

export type RankTable = {
  /** Per symbol, one rank per horizon in HORIZONS order. 1 is best. */
  ranks: Map<string, (number | null)[]>;
  /** Names actually ranked in each horizon - the denominator for the heat. */
  counts: number[];
  /** Sessions dropped from each horizon, after clamping. Zero when skip is off. */
  skips: number[];
};

/**
 * Rank every name at every horizon, on one metric.
 *
 * Ranks are always computed over the **whole** universe passed in, before any
 * search or sector filter the screen applies afterwards. A rank that renumbered
 * itself when you filtered to one sector would answer a different question on
 * every filter - "best of the eleven names still visible" - and could not be
 * compared across two filters or against the unfiltered view.
 *
 * Each horizon resolves its own window and its own skip, because `skipForLength`
 * is deliberately sublinear: a 1M column drops 5 sessions where a 12M column
 * drops 20. Applying one column's skip to all five would either gut the short
 * horizons or under-correct the long ones.
 *
 * Uses the same `computeWindowStats` as every row and the portfolio card, so a
 * rank can never disagree with the number the card view shows for the same name
 * and window - there is no second implementation to drift.
 *
 * Ties take sequential ranks in sort order. Two names sharing a rank would need
 * identical returns to the last floating-point bit, which does not happen on
 * real price series, so competition ranking would add a branch for a case that
 * cannot occur.
 */
export function buildRankTable(
  universe: Ticker[],
  metric: MetricKey,
  skipEnabled: boolean,
  sessionsStale: number
): RankTable {
  const ranks = new Map<string, (number | null)[]>();
  for (const t of universe) ranks.set(t.symbol, new Array(HORIZONS.length).fill(null));

  const counts: number[] = [];
  const skips: number[] = [];

  HORIZONS.forEach((horizon, h) => {
    const range = withSkip(windowForPreset(horizon.key), skipEnabled, sessionsStale);
    skips.push(range.skip);

    const scored: { symbol: string; value: number }[] = [];
    for (const t of universe) {
      const stats = computeWindowStats(t, range.startIndex, range.endIndex);
      const value = metricValue(stats, metric);
      // A name that had not listed for the whole window is unranked rather
      // than ranked last: it did not lose, it was not there.
      if (value !== null && Number.isFinite(value)) scored.push({ symbol: t.symbol, value });
    }

    scored.sort((a, b) => b.value - a.value);
    scored.forEach((entry, i) => {
      ranks.get(entry.symbol)![h] = i + 1;
    });
    counts.push(scored.length);
  });

  return { ranks, counts, skips };
}

/**
 * How far a rank is from the middle of the pack, and in which direction.
 *
 * `strength` runs 0 at the median to 1 at either extreme, so the heatmap is
 * diverging: the top of the market and the bottom of it both read loudly, and
 * the wide middle - where a rank of 240 and a rank of 260 mean the same thing -
 * stays quiet instead of demanding attention it hasn't earned.
 */
export type Heat = { side: 'up' | 'down'; strength: number };

/**
 * Above 1 this pushes mid-table ranks toward neutral. With 500 names a linear
 * ramp leaves most of the table visibly tinted, which reads as information
 * where there is none; 1.5 keeps the top and bottom deciles vivid and lets the
 * middle recede.
 */
const HEAT_GAMMA = 1.5;

export function rankHeat(rank: number | null, count: number): Heat | null {
  if (rank === null || count < 2) return null;
  const percentile = (rank - 1) / (count - 1); // 0 best .. 1 worst
  const signed = 1 - 2 * percentile; // +1 best .. -1 worst
  return {
    side: signed >= 0 ? 'up' : 'down',
    strength: Math.pow(Math.abs(signed), HEAT_GAMMA),
  };
}
