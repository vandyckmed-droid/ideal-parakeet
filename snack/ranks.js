// Multi-horizon rank table. Mirrors src/data/ranks.ts - if these two ever
// disagree, the .ts file is the one that is wrong.

import { computeWindowStats, metricValue, windowForPreset, withSkip } from './stats';

/**
 * The horizons the rank table measures, shortest first. `1Y` is labelled 12M so
 * the header reads as one evenly spaced series of months rather than three
 * months and a year.
 *
 * Starts at 3M rather than 1M deliberately. A one-month rank is dominated by
 * short-horizon reversal - whatever moved hardest recently tends to give some
 * of it back - which is the same effect skipForLength exists to strip out of a
 * measurement. Ranking on it produces a column that mostly reorders itself
 * every few weeks and predicts the opposite of what it appears to.
 */
export const HORIZONS = [
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '9M', label: '9M' },
  { key: '1Y', label: '12M' },
];

/**
 * Which horizon column a shared window resolves to.
 *
 * The rank table has no window state of its own: the header's window control
 * is the sorted column, so the time axis means the same thing in every view.
 * Presets that are themselves columns match exactly; everything else (1M,
 * Max, a custom range) resolves to the horizon nearest its length - a 1M
 * window leads with the 3M column because 1M is deliberately not a column
 * (see HORIZONS above).
 */
export function horizonIndexForWindow(win, dates) {
  const exact = HORIZONS.findIndex((h) => h.key === win.preset);
  if (exact >= 0) return exact;
  const length = win.endIndex - win.startIndex;
  let best = 0;
  let bestGap = Infinity;
  HORIZONS.forEach((h, i) => {
    const w = windowForPreset(h.key, dates);
    const gap = Math.abs(w.endIndex - w.startIndex - length);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

/**
 * Rank every name at every horizon, on one metric.
 *
 * Ranks are always computed over the whole universe passed in, before any
 * search or sector filter the screen applies afterwards. A rank that renumbered
 * itself when you filtered to one sector would answer a different question on
 * every filter and could not be compared across two of them.
 *
 * Each horizon resolves its own window and its own skip, because skipForLength
 * is deliberately sublinear: a 1M column drops 5 sessions where a 12M column
 * drops 20.
 *
 * Uses the same computeWindowStats as every row and the portfolio card, so a
 * rank can never disagree with the number the card view shows for the same name
 * and window.
 *
 * Ties take sequential ranks in sort order - two names sharing a rank would
 * need identical returns to the last floating-point bit.
 */
export function buildRankTable(universe, dates, metric, skipEnabled, sessionsStale) {
  const lastIndex = dates.length - 1;
  const ranks = new Map();
  for (const t of universe) ranks.set(t.s, new Array(HORIZONS.length).fill(null));

  const counts = [];
  const skips = [];

  HORIZONS.forEach((horizon, h) => {
    const range = withSkip(
      windowForPreset(horizon.key, dates),
      skipEnabled,
      sessionsStale,
      lastIndex
    );
    skips.push(range.skip);

    const scored = [];
    for (const t of universe) {
      const stats = computeWindowStats(t, range.startIndex, range.endIndex);
      const value = metricValue(stats, metric);
      // A name that had not listed for the whole window is unranked rather
      // than ranked last: it did not lose, it was not there.
      if (value !== null && isFinite(value)) scored.push({ symbol: t.s, value });
    }

    scored.sort((a, b) => b.value - a.value);
    scored.forEach((entry, i) => {
      ranks.get(entry.symbol)[h] = i + 1;
    });
    counts.push(scored.length);
  });

  return { ranks, counts, skips };
}

/**
 * Where "the top and bottom 10%" starts, on the same 0..1 distance-from-median
 * scale `strength` is computed on. A rank at the 10th or 90th percentile sits
 * 0.8 of the way from the median to the extreme (|1 - 2 x 0.1| = 0.8), so this
 * is that boundary, not a tuned constant.
 *
 * Below it - the middle 80% of the table, which is not where anyone looks -
 * strength is squeezed under QUIET_CEILING, so two ranks a few places apart
 * there (200 vs 205) barely separate in colour. At and above it, strength
 * spends the REST of the range climbing to 1 over just that last fifth of the
 * scale, so the same few-place gap at the very top (1 vs 5) reads as a real
 * jump: all the visual range the quiet middle gave up gets spent where
 * someone is actually scanning.
 */
const DECILE = 0.8;
/** The most tint or text-mix the quiet middle 80% is ever allowed to reach. */
const QUIET_CEILING = 0.12;
/** Gentle curve inside the quiet zone - keeps the true median flattest of all. */
const INNER_GAMMA = 1.4;

/**
 * How far a rank is from the middle of the pack, and in which direction.
 * `strength` runs 0 at the median to 1 at either extreme, so the heatmap is
 * diverging and the wide middle stays quiet.
 */
export function rankHeat(rank, count) {
  if (rank === null || count < 2) return null;
  const percentile = (rank - 1) / (count - 1); // 0 best .. 1 worst
  const signed = 1 - 2 * percentile; // +1 best .. -1 worst
  const distance = Math.abs(signed); // 0 at the median .. 1 at either extreme

  // Continuous at DECILE by construction (both branches equal QUIET_CEILING
  // there), so the heatmap has no visible seam where the curve switches.
  const strength =
    distance < DECILE
      ? QUIET_CEILING * Math.pow(distance / DECILE, INNER_GAMMA)
      : QUIET_CEILING + (1 - QUIET_CEILING) * ((distance - DECILE) / (1 - DECILE));

  return { side: signed >= 0 ? 'up' : 'down', strength };
}
