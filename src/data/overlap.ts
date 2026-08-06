import { Ticker, closeAt } from './market';

/** Below this many names, "the rest of the list" isn't a meaningful comparison. */
export const MIN_OVERLAP_NAMES = 3;

/** Below this many aligned daily returns, a correlation is mostly sampling noise. */
export const MIN_OVERLAP_OBSERVATIONS = 20;

/**
 * A name scoring at or above this against the rest of the list is flagged.
 *
 * Set from the natural gap in how real watchlists score on the default 1Y
 * window: loosely related sets (REITs, diversified megacap tech) top out
 * around 55-58%, while genuinely concentrated ones (semiconductors, regional
 * banks, oil majors) sit at 68% and up. 0.65 falls in that gap rather than on
 * either edge.
 */
export const OVERLAP_THRESHOLD = 0.65;

/** At most this many names are flagged, even if more names clear the threshold. */
export const MAX_OVERLAP_FLAGS = 2;

export type OverlapScore = {
  symbol: string;
  /**
   * Pearson r between this name's own daily returns and the equal-weighted
   * average return of every *other* name in the set, over the same days.
   * Null when the set is too small or the aligned history too short.
   */
  score: number | null;
};

export type OverlapSummary = {
  /** One entry per input ticker, in input order. */
  scores: OverlapScore[];
  flagged: Set<string>;
  /** Aligned daily-return count actually used. */
  observations: number;
  reason: 'ok' | 'too_few_names' | 'insufficient_history';
};

function empty(
  tickers: Ticker[],
  reason: OverlapSummary['reason'],
  observations = 0
): OverlapSummary {
  return {
    scores: tickers.map((t) => ({ symbol: t.symbol, score: null })),
    flagged: new Set(),
    observations,
    reason,
  };
}

/**
 * Leave-one-out overlap for a set of names over one window.
 *
 * For each name, correlate its own daily returns against the equal-weighted
 * average return of every *other* name in the set, on the same days. A high
 * score means the name adds little the rest of the list doesn't already
 * provide - it moves like the basket, not necessarily like any single other
 * name in it. That distinction matters for how a result should be described:
 * two flagged names are each redundant with the group, which is a different
 * claim from saying the two are correlated with each other.
 *
 * Every name needs a close on every day measured, so the start of the window
 * clamps to whichever member of the set listed most recently - a newly listed
 * name in the watchlist shortens the comparison for everyone, rather than
 * being silently dropped or measured against a shorter series than the rest.
 *
 * Computed in one pass rather than literally excluding each name and
 * re-averaging: the per-day sum across all names is taken once, and each
 * name's "rest of the list" average on a given day is
 * `(daySum - ownReturn) / (n - 1)`. Same result as the naive approach,
 * O(n) per name instead of O(n) per name per exclusion.
 */
export function computeOverlap(
  tickers: Ticker[],
  startIndex: number,
  endIndex: number
): OverlapSummary {
  const n = tickers.length;
  if (n < MIN_OVERLAP_NAMES) return empty(tickers, 'too_few_names');

  let alignedStart = startIndex;
  for (const t of tickers) alignedStart = Math.max(alignedStart, t.offset);
  const observations = endIndex - alignedStart;

  if (observations < MIN_OVERLAP_OBSERVATIONS) {
    return empty(tickers, 'insufficient_history', Math.max(0, observations));
  }

  const returns = tickers.map((t) => {
    const series = new Array<number>(observations);
    for (let k = 0; k < observations; k++) {
      const i = alignedStart + k;
      // Safe: alignedStart >= t.offset for every name, and every series in
      // the bundled dataset extends through the newest date, so both closes
      // are always present in range.
      series[k] = closeAt(t, i + 1)! / closeAt(t, i)! - 1;
    }
    return series;
  });

  const daySum = new Array<number>(observations).fill(0);
  for (const series of returns) {
    for (let k = 0; k < observations; k++) daySum[k] += series[k];
  }

  const scores: OverlapScore[] = tickers.map((t, idx) => {
    const own = returns[idx];
    const rest = new Array<number>(observations);
    for (let k = 0; k < observations; k++) rest[k] = (daySum[k] - own[k]) / (n - 1);
    return { symbol: t.symbol, score: pearson(own, rest) };
  });

  const flagged = new Set(
    scores
      .filter((s): s is { symbol: string; score: number } => s.score !== null)
      .sort((a, b) => b.score - a.score)
      .filter((s) => s.score >= OVERLAP_THRESHOLD)
      .slice(0, MAX_OVERLAP_FLAGS)
      .map((s) => s.symbol)
  );

  return { scores, flagged, observations, reason: 'ok' };
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;

  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  // A constant series (zero variance) has no defined correlation.
  if (vx <= 1e-18 || vy <= 1e-18) return null;
  return cov / Math.sqrt(vx * vy);
}

/** Header line summarising an overlap result for the watchlist screen. */
export function describeOverlap(overlap: OverlapSummary, n: number): string {
  if (overlap.reason === 'too_few_names') {
    const need = MIN_OVERLAP_NAMES - n;
    return `Add ${need} more ${need === 1 ? 'name' : 'names'} to see overlap`;
  }
  if (overlap.reason === 'insufficient_history') {
    return `Widen the window to see overlap · ${overlap.observations} of ${MIN_OVERLAP_OBSERVATIONS} days available`;
  }
  if (overlap.flagged.size === 0) {
    return `No name overlaps the rest of the list by ${Math.round(OVERLAP_THRESHOLD * 100)}% or more`;
  }
  const named = overlap.scores
    .filter((s) => overlap.flagged.has(s.symbol))
    .sort((a, b) => (b.score as number) - (a.score as number))
    .map((s) => `${s.symbol} ${Math.round((s.score as number) * 100)}%`)
    .join(', ');
  return `Most overlap: ${named}`;
}
