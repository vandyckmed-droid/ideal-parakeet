import raw from '../../assets/data/research.json';

/**
 * The Research tab's dataset, built nightly by tools/05-build-research.mjs.
 * See that file for the construction; the app only displays it.
 */
export type ResearchData = {
  /** The last date the series covers - deterministic, so holiday runs are no-ops. */
  generatedAt: string;
  startValue: number;
  top: number;
  signal: string;
  universe: string;
  rebalance: string;
  /** [date, portfolio value] per session, oldest first. */
  series: [string, number][];
  formations: { measured: string; entered: string; holdings: string[] }[];
};

export const RESEARCH = raw as unknown as ResearchData;
