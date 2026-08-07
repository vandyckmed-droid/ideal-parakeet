// Overlap scoring against a fixed comparison basket. Mirrors
// src/data/overlap.ts - if these two ever disagree, the .ts file is the one
// that is wrong.

import { closeAt } from './stats';

export const MIN_OVERLAP_NAMES = 3;
export const MIN_OVERLAP_OBSERVATIONS = 20;
// Set from the natural gap in how real watchlists score on the default 1Y
// window: loosely related sets top out around 55-58%, genuinely concentrated
// ones sit at 68%+. 0.65 falls in that gap rather than on either edge.
export const OVERLAP_THRESHOLD = 0.65;

function empty(universe, basketSymbols, reason, observations) {
  return {
    scores: universe.map((t) => ({ symbol: t.s, score: null, inBasket: basketSymbols.has(t.s) })),
    flagged: new Set(),
    observations: observations || 0,
    reason,
  };
}

/**
 * Score every ticker in `universe` against a fixed comparison basket (the
 * watchlist), over one window.
 *
 * A basket member's score is a leave-one-out correlation - its own daily
 * returns against the equal-weighted average of every *other* basket member,
 * on the same days. A name outside the basket has nothing to leave out, so it
 * is correlated directly against the full basket average instead. Both
 * describe the same thing: how much a name's daily moves resemble the
 * basket, whether or not the name is currently held.
 *
 * `universe` can be the basket itself (scores only for current holdings) or a
 * larger set such as the full tradable universe (screen candidates for
 * whether adding them would diversify anything). Either way every score
 * refers to literally the same set of trading days.
 *
 * The window's start clamps to whichever *basket* member listed most
 * recently. A candidate outside the basket that listed even later simply
 * cannot be scored over this exact window - it gets score: null rather than
 * shortening the window for everyone else.
 *
 * Computed in one pass: the per-day sum across the basket is taken once,
 * giving both the leave-one-out figure for members
 * (`(daySum - own) / (n - 1)`) and the full basket average for everyone else
 * (`daySum / n`) directly.
 */
export function computeOverlap(basket, universe, startIndex, endIndex) {
  const basketSymbols = new Set(basket.map((t) => t.s));
  const n = basket.length;
  if (n < MIN_OVERLAP_NAMES) return empty(universe, basketSymbols, 'too_few_names');

  let alignedStart = startIndex;
  for (const t of basket) alignedStart = Math.max(alignedStart, t.o);
  const observations = endIndex - alignedStart;

  if (observations < MIN_OVERLAP_OBSERVATIONS) {
    return empty(universe, basketSymbols, 'insufficient_history', Math.max(0, observations));
  }

  const seriesOf = (t) => {
    const out = new Array(observations);
    for (let k = 0; k < observations; k++) {
      const i = alignedStart + k;
      out[k] = closeAt(t, i + 1) / closeAt(t, i) - 1;
    }
    return out;
  };

  const basketReturns = new Map();
  const daySum = new Array(observations).fill(0);
  for (const t of basket) {
    const series = seriesOf(t);
    basketReturns.set(t.s, series);
    for (let k = 0; k < observations; k++) daySum[k] += series[k];
  }
  const basketAvg = daySum.map((v) => v / n);

  const scores = universe.map((t) => {
    const inBasket = basketSymbols.has(t.s);
    if (t.o > alignedStart) return { symbol: t.s, score: null, inBasket };

    const own = basketReturns.get(t.s) || seriesOf(t);
    let compare;
    if (inBasket) {
      const rest = new Array(observations);
      for (let k = 0; k < observations; k++) rest[k] = (daySum[k] - own[k]) / (n - 1);
      compare = rest;
    } else {
      compare = basketAvg;
    }
    return { symbol: t.s, score: pearson(own, compare), inBasket };
  });

  const flagged = new Set(
    scores.filter((s) => s.score !== null && s.score >= OVERLAP_THRESHOLD).map((s) => s.symbol)
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

/**
 * Header line for the Watchlist screen - or null when the rows already say it.
 *
 * The header only speaks about things the list itself cannot show. Every
 * flagged holding already carries its own `⇄ 69%` badge on its own row, so
 * naming those same holdings and percentages again at the top is the same
 * information printed twice, in the screen's loudest colour, costing two
 * lines of vertical space above the portfolio card.
 *
 * "Nothing is flagged" is the one result the rows can't express - an absence
 * of badges is indistinguishable from a list you haven't scrolled - so that
 * case still gets a line, as do the two states where the calculation can't
 * run at all.
 */
export function describeOverlap(overlap, n) {
  if (overlap.reason === 'too_few_names') {
    const need = MIN_OVERLAP_NAMES - n;
    return `Add ${need} more ${need === 1 ? 'name' : 'names'} to see overlap`;
  }
  if (overlap.reason === 'insufficient_history') {
    return `Widen the window to see overlap · ${overlap.observations} of ${MIN_OVERLAP_OBSERVATIONS} days available`;
  }
  const anyFlagged = overlap.scores.some((s) => s.inBasket && overlap.flagged.has(s.symbol));
  if (anyFlagged) return null;
  return `No name overlaps the rest of the list by ${Math.round(OVERLAP_THRESHOLD * 100)}% or more`;
}

/**
 * Header line for the Market screen - or null, which is the ordinary case.
 *
 * Speaks only when overlap cannot be computed at all and something the user
 * could do would fix it: too few names in the watchlist, or too little shared
 * history in the window. Both are states where the Overlap sort chip is simply
 * absent, and a control that vanishes with nothing said reads as a missing
 * feature rather than an unmet precondition.
 *
 * It does NOT report how many of the 500 are flagged. Every one of those names
 * carries its own badge, and the Overlap sort puts them in order on demand, so
 * a running count at the top was a third way to say the same thing - in the
 * loudest colour on the screen, permanently, above everything else.
 *
 * Also silent on an empty watchlist: the Market tab is where the app opens, so
 * prompting someone to feed a feature they have not met yet is noise.
 */
export function describeCandidateOverlap(overlap, watchlistCount) {
  if (overlap.reason === 'too_few_names') {
    if (watchlistCount === 0) return null;
    const need = MIN_OVERLAP_NAMES - watchlistCount;
    return `Watchlist needs ${need} more ${need === 1 ? 'name' : 'names'} to screen for overlap`;
  }
  if (overlap.reason === 'insufficient_history') {
    return `Widen the window to screen for overlap · ${overlap.observations} of ${MIN_OVERLAP_OBSERVATIONS} days available`;
  }
  return null;
}
