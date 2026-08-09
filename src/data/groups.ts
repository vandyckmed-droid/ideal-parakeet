import { Cluster, balancedKMedoids } from './cluster';
import { GROUPABLE, GROUPING_META, GROUP_SYMBOLS, correlationFromDistance, distance } from './grouping';
import { BY_SYMBOL, DATES, LAST_INDEX, Ticker } from './market';

/**
 * A correlation group, shaped as a Ticker so every piece of stock machinery -
 * computeWindowStats, the skip, the residual regression, the sparkline, the
 * rank table - works on it without knowing it is a group.
 */
export type GroupTicker = Ticker & {
  /** The representative member: an actual stock, per the algorithm. */
  medoid: string;
  members: string[];
  /** Mean correlation with the rest of the group, per member, best first. */
  fit: number[];
  weak: boolean[];
  /** Medoid of the group a weak member sits closer to, or '' when it fits. */
  prefers: string[];
  /** Mean pairwise correlation inside the group. */
  cohesion: number;
  /** Most common sector among members, purely as a human-readable label. */
  dominantSector: string;
  dominantShare: number;
};

export type GroupSet = {
  k: number;
  groups: GroupTicker[];
  target: number;
  lower: number;
  upper: number;
};

/** The K values offered. Beyond ~40 the groups get too small to mean much. */
export const K_CHOICES = [6, 8, 10, 12, 16, 20, 24, 30, 40];
export const DEFAULT_K = 20;

export const GROUPING_AVAILABLE = GROUPABLE > 0;
export const UNGROUPED_COUNT = Math.max(0, BY_SYMBOL.size - GROUPABLE);
export { GROUPING_META };

/**
 * Equal-weight index for a set of members, rebalanced daily.
 *
 * Daily rebalancing rather than a buy-and-hold basket so the series is a
 * property of the *group* alone: a basket's weights drift with its winners,
 * which would make the line depend on when it happened to start, and the
 * window control lets the user start it anywhere.
 *
 * Every grouped name has a complete history over the dataset by construction
 * (that is what made it groupable), so the series spans the whole calendar
 * and offset is 0 - no late-listing case to handle.
 */
function equalWeightIndex(members: Ticker[]): { offset: number; closes: number[] } {
  const offset = members.reduce((m, t) => Math.max(m, t.offset), 0);
  const closes = new Array(LAST_INDEX - offset + 1);
  closes[0] = 100;
  for (let i = offset + 1; i <= LAST_INDEX; i++) {
    let sum = 0;
    let n = 0;
    for (const t of members) {
      const a = t.closes[i - 1 - t.offset];
      const b = t.closes[i - t.offset];
      if (a > 0 && b > 0) { sum += b / a - 1; n++; }
    }
    closes[i - offset] = closes[i - offset - 1] * (1 + (n ? sum / n : 0));
  }
  return { offset, closes };
}

function toGroupTicker(cluster: Cluster): GroupTicker | null {
  const symbols = cluster.members.map((m) => GROUP_SYMBOLS[m]);
  const tickers = symbols
    .map((s) => BY_SYMBOL.get(s))
    .filter((t): t is Ticker => Boolean(t));
  if (!tickers.length) return null;

  const { offset, closes } = equalWeightIndex(tickers);
  const medoid = GROUP_SYMBOLS[cluster.medoid];

  const sectors = new Map<string, number>();
  for (const t of tickers) sectors.set(t.sector, (sectors.get(t.sector) ?? 0) + 1);
  let dominantSector = '';
  let dominantCount = 0;
  for (const [s, c] of sectors) if (c > dominantCount) { dominantCount = c; dominantSector = s; }

  const meanDistance = cluster.fit.reduce((a, b) => a + b, 0) / Math.max(1, cluster.fit.length);

  return {
    symbol: medoid,
    name: `${symbols.length} members`,
    sector: dominantSector,
    industry: '',
    country: '',
    exchange: '',
    // Size sorts by member count, the only size a group has.
    marketCap: symbols.length,
    dollarVolume: symbols.length,
    offset,
    closes,
    lastClose: closes[closes.length - 1],
    medoid,
    members: symbols,
    fit: cluster.fit.map(correlationFromDistance),
    weak: cluster.weak,
    prefers: cluster.prefers.map((p) => (p >= 0 ? GROUP_SYMBOLS[p] : '')),
    cohesion: correlationFromDistance(meanDistance),
    dominantSector,
    dominantShare: dominantCount / symbols.length,
  };
}

/**
 * Groups for a given K, memoised.
 *
 * The clustering is ~130ms for the whole universe, which is fine on demand but
 * not fine on every render, and several screens ask for the same K.
 */
const CACHE = new Map<number, GroupSet>();

export function groupsForK(k: number): GroupSet {
  const cached = CACHE.get(k);
  if (cached) return cached;

  if (!GROUPING_AVAILABLE) {
    const empty: GroupSet = { k, groups: [], target: 0, lower: 0, upper: 0 };
    CACHE.set(k, empty);
    return empty;
  }

  const result = balancedKMedoids(GROUPABLE, k, distance);
  const groups = result.clusters
    .map(toGroupTicker)
    .filter((g): g is GroupTicker => g != null);
  const set: GroupSet = { k, groups, target: result.target, lower: result.lower, upper: result.upper };
  CACHE.set(k, set);
  return set;
}

/**
 * Symbol -> medoid for a given K, memoised. The rank table asks once per
 * name, so a scan per lookup would be quadratic for no reason.
 */
const REVERSE = new Map<number, Map<string, string>>();
export function groupIndexFor(k: number): Map<string, string> {
  const cached = REVERSE.get(k);
  if (cached) return cached;
  const m = new Map<string, string>();
  for (const g of groupsForK(k).groups) {
    for (const sym of g.members) m.set(sym, g.medoid);
  }
  REVERSE.set(k, m);
  return m;
}

/** Which group a stock belongs to at a given K, by medoid. '' when ungrouped. */
export function groupOfSymbol(symbol: string, k: number): string {
  return groupIndexFor(k).get(symbol) ?? '';
}

export function groupByMedoid(medoid: string, k: number): GroupTicker | undefined {
  return groupsForK(k).groups.find((g) => g.medoid === medoid);
}

/** Human-readable description of the window the correlations were measured on. */
export function groupingWindowLabel(): string {
  const from = GROUPING_META.from;
  const to = GROUPING_META.to;
  if (!from || !to) return '';
  return `${GROUPING_META.sessions} sessions · ${from} → ${to}`;
}

export { DATES };
