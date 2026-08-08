import raw from '../../assets/data/research.json';

/**
 * The Research tab's dataset, built nightly by tools/05-build-research.mjs.
 * See that file for the construction; the app only displays it.
 */
export type ResearchStrategy = {
  /** Stable id, used to remember which signal is selected. */
  key: string;
  /** Short name for the picker. */
  label: string;
  /** The full rule, shown in the rules table. */
  signal: string;
  /** [date, portfolio value] per session, oldest first. */
  series: [string, number][];
  formations: { measured: string; entered: string; holdings: string[] }[];
};

export type ResearchData = {
  /** The last date the series covers - deterministic, so holiday runs are no-ops. */
  generatedAt: string;
  startValue: number;
  top: number;
  universe: string;
  rebalance: string;
  /** Worst roster coverage any formation ran at, 0-1. */
  minCoverage: number;
  /**
   * Buy-and-hold references. `values` are positionally aligned to
   * `strategies[0].series`, values only, so a benchmark cannot drift out of
   * step with the portfolios.
   */
  benchmarks: { symbol: string; name: string; values: number[] }[];
  /**
   * One entry per selectable signal. Every strategy walks the same calendar
   * and shares one eligibility test, so switching between them changes the
   * signal and nothing else.
   */
  strategies: ResearchStrategy[];
  /** Calendar for the family indices - two years, one entry per session. */
  familyDates: string[];
  /**
   * Peer-family indices: $10,000 equal-weight in each family's point-in-time
   * index members, rebalanced monthly. `values` aligned to `familyDates`;
   * `n` is the family's current member count.
   */
  families: { key: string; n: number; values: number[] }[];
};

export const RESEARCH = raw as unknown as ResearchData;
