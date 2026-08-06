// Leave-one-out overlap for the watchlist. Mirrors src/data/overlap.ts - if
// these two ever disagree, the .ts file is the one that is wrong.

import { closeAt } from './stats';

export const MIN_OVERLAP_NAMES = 3;
export const MIN_OVERLAP_OBSERVATIONS = 20;
// Set from the natural gap in how real watchlists score on the default 1Y
// window: loosely related sets top out around 55-58%, genuinely concentrated
// ones sit at 68%+. 0.65 falls in that gap rather than on either edge.
export const OVERLAP_THRESHOLD = 0.65;
export const MAX_OVERLAP_FLAGS = 2;

function empty(tickers, reason, observations) {
  return {
    scores: tickers.map((t) => ({ symbol: t.s, score: null })),
    flagged: new Set(),
    observations: observations || 0,
    reason,
  };
}

/**
 * For each name, correlate its own daily returns against the equal-weighted
 * average return of every *other* name in the set, on the same days. A high
 * score means the name adds little the rest of the list doesn't already
 * provide - it moves like the basket, not necessarily like any single other
 * name in it. Two flagged names are each redundant with the group, which is
 * a different claim from saying the two are correlated with each other.
 *
 * Every name needs a close on every day measured, so the window start clamps
 * to whichever member of the set listed most recently.
 *
 * Computed in one pass: the per-day sum across all names is taken once, and
 * each name's "rest of the list" average on a given day is
 * `(daySum - ownReturn) / (n - 1)` - the same result as excluding each name
 * and re-averaging, without redoing the average from scratch every time.
 */
export function computeOverlap(tickers, startIndex, endIndex) {
  const n = tickers.length;
  if (n < MIN_OVERLAP_NAMES) return empty(tickers, 'too_few_names');

  let alignedStart = startIndex;
  for (const t of tickers) alignedStart = Math.max(alignedStart, t.o);
  const observations = endIndex - alignedStart;

  if (observations < MIN_OVERLAP_OBSERVATIONS) {
    return empty(tickers, 'insufficient_history', Math.max(0, observations));
  }

  const returns = tickers.map((t) => {
    const series = new Array(observations);
    for (let k = 0; k < observations; k++) {
      const i = alignedStart + k;
      series[k] = closeAt(t, i + 1) / closeAt(t, i) - 1;
    }
    return series;
  });

  const daySum = new Array(observations).fill(0);
  for (const series of returns) {
    for (let k = 0; k < observations; k++) daySum[k] += series[k];
  }

  const scores = tickers.map((t, idx) => {
    const own = returns[idx];
    const rest = new Array(observations);
    for (let k = 0; k < observations; k++) rest[k] = (daySum[k] - own[k]) / (n - 1);
    return { symbol: t.s, score: pearson(own, rest) };
  });

  const flagged = new Set(
    scores
      .filter((s) => s.score !== null)
      .sort((a, b) => b.score - a.score)
      .filter((s) => s.score >= OVERLAP_THRESHOLD)
      .slice(0, MAX_OVERLAP_FLAGS)
      .map((s) => s.symbol)
  );

  return { scores, flagged, observations, reason: 'ok' };
}

function pearson(x, y) {
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
  if (vx <= 1e-18 || vy <= 1e-18) return null;
  return cov / Math.sqrt(vx * vy);
}

export function describeOverlap(overlap, n) {
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
    .sort((a, b) => b.score - a.score)
    .map((s) => `${s.symbol} ${Math.round(s.score * 100)}%`)
    .join(', ');
  return `Most overlap: ${named}`;
}
