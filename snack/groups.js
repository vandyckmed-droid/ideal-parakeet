// Mirrors src/data/groups.ts - if these two ever disagree, the .ts file is the
// one that is wrong.

import { balancedKMedoids } from './cluster';
import {
  correlationFromDistance, distance, groupSymbols, groupable, groupingMeta, hasGrouping,
} from './grouping';

/** The K values offered. Beyond ~40 the groups get too small to mean much. */
export const K_CHOICES = [6, 8, 10, 12, 16, 20, 24, 30, 40];
export const DEFAULT_K = 20;

let BY_SYMBOL = new Map();
let LAST_INDEX = 0;
let UNGROUPED = 0;

/**
 * App.js hands over the universe once on load. Changing it clears the caches,
 * because every group series is built from these prices.
 */
export function setUniverse(bySymbol, lastIndex) {
  BY_SYMBOL = bySymbol;
  LAST_INDEX = lastIndex;
  UNGROUPED = Math.max(0, bySymbol.size - groupable());
  CACHE.clear();
  REVERSE.clear();
}

export function ungroupedCount() { return UNGROUPED; }

/**
 * Equal-weight index for a set of members, rebalanced daily.
 *
 * Daily rebalancing rather than a buy-and-hold basket so the series is a
 * property of the group alone: a basket's weights drift with its winners,
 * which would make the line depend on when it happened to start, and the
 * window control lets the user start it anywhere.
 */
function equalWeightIndex(members) {
  const offset = members.reduce((m, t) => Math.max(m, t.o), 0);
  const p = new Array(LAST_INDEX - offset + 1);
  p[0] = 100;
  for (let i = offset + 1; i <= LAST_INDEX; i++) {
    let sum = 0;
    let n = 0;
    for (const t of members) {
      const a = t.p[i - 1 - t.o];
      const b = t.p[i - t.o];
      if (a > 0 && b > 0) { sum += b / a - 1; n++; }
    }
    p[i - offset] = p[i - offset - 1] * (1 + (n ? sum / n : 0));
  }
  return { o: offset, p };
}

function toGroupTicker(cluster) {
  const syms = groupSymbols();
  const symbols = cluster.members.map((m) => syms[m]);
  const tickers = symbols.map((s) => BY_SYMBOL.get(s)).filter(Boolean);
  if (!tickers.length) return null;

  const { o, p } = equalWeightIndex(tickers);
  const medoid = syms[cluster.medoid];

  const sectors = new Map();
  for (const t of tickers) sectors.set(t.se, (sectors.get(t.se) || 0) + 1);
  let dominantSector = '';
  let dominantCount = 0;
  for (const [s, c] of sectors) if (c > dominantCount) { dominantCount = c; dominantSector = s; }

  const meanDistance = cluster.fit.reduce((a, b) => a + b, 0) / Math.max(1, cluster.fit.length);

  return {
    s: medoid,
    n: `${symbols.length} members`,
    se: dominantSector,
    in: '', cy: '', x: '',
    // Size sorts by member count, the only size a group has.
    mc: symbols.length,
    adv: symbols.length,
    o,
    p,
    last: p[p.length - 1],
    medoid,
    members: symbols,
    fit: cluster.fit.map(correlationFromDistance),
    weak: cluster.weak,
    prefers: cluster.prefers.map((i) => (i >= 0 ? syms[i] : '')),
    cohesion: correlationFromDistance(meanDistance),
    dominantSector,
    dominantShare: dominantCount / symbols.length,
  };
}

// The clustering is ~130ms for the whole universe: fine on demand, not fine on
// every render, and several screens ask for the same K.
const CACHE = new Map();

export function groupsForK(k) {
  const cached = CACHE.get(k);
  if (cached) return cached;
  if (!hasGrouping() || BY_SYMBOL.size === 0) {
    const empty = { k, groups: [], target: 0, lower: 0, upper: 0 };
    return empty; // not cached: the data may still be arriving
  }
  const result = balancedKMedoids(groupable(), k, distance);
  const groups = result.clusters.map(toGroupTicker).filter(Boolean);
  const set = { k, groups, target: result.target, lower: result.lower, upper: result.upper };
  CACHE.set(k, set);
  return set;
}

// Symbol -> medoid, memoised: the rank table asks once per name, so a scan per
// lookup would be quadratic for no reason.
const REVERSE = new Map();
export function groupIndexFor(k) {
  const cached = REVERSE.get(k);
  if (cached) return cached;
  const m = new Map();
  for (const g of groupsForK(k).groups) for (const sym of g.members) m.set(sym, g.medoid);
  if (m.size) REVERSE.set(k, m);
  return m;
}

export function groupOfSymbol(symbol, k) { return groupIndexFor(k).get(symbol) || ''; }
export function groupByMedoid(medoid, k) {
  return groupsForK(k).groups.find((g) => g.medoid === medoid);
}
export { groupingMeta, hasGrouping };
