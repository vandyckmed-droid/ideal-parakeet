import { Ticker, closeAt } from './market';

export const TRADING_DAYS_PER_YEAR = 252;

/**
 * Below this many observations a standard deviation is mostly sampling noise,
 * and annualising it produces numbers that look authoritative while meaning
 * very little. Windows shorter than this report a return but no risk figure.
 */
export const MIN_VOL_OBSERVATIONS = 10;

/**
 * Floor on the sigma used as the ratio's divisor.
 *
 * A genuinely quiet name divides by a small number and scores enormously for
 * reasons that have nothing to do with skill. The clearest case in the current
 * universe is a stock pinned near an announced acquisition price: its realised
 * vol collapses to a few percent because the price is tracking a deal, not
 * because the business is defensive. Flooring the divisor keeps that from
 * dominating the ranking.
 *
 * This floors the *divisor only*. The sigma reported in the interface stays the
 * true measurement, because a displayed risk figure that silently reads high
 * would be worse than the problem being solved.
 */
export const VOL_FLOOR = 0.125;

export type WindowStats = {
  startPrice: number;
  endPrice: number;
  /** Simple return across the window, not annualised. */
  totalReturn: number;
  /** Geometric annualisation of `totalReturn`. */
  annualizedReturn: number | null;
  /** Sample sigma of daily log returns, scaled by sqrt(252). Never floored. */
  annualizedVol: number | null;
  /** True when the ratio's divisor was raised to `VOL_FLOOR`. */
  volFloored: boolean;
  /**
   * Annualised return over annualised sigma - a Sharpe-style ratio with no
   * risk-free rate subtracted.
   *
   * Both halves are annualised on purpose. Dividing a raw window return by an
   * annualised sigma mixes units, so the same skill would score differently on
   * a one-month window than on a one-year one and the column could not be
   * ranked. Annualising both makes the figure comparable across every window
   * the picker offers.
   */
  ratio: number | null;
  /** Number of daily observations in the window. */
  observations: number;
};

/**
 * Return and risk between two master-calendar indices, inclusive.
 * Returns null when the name had not yet listed at `startIndex`.
 */
export function computeWindowStats(
  ticker: Ticker,
  startIndex: number,
  endIndex: number,
  /**
   * The floor exists to stop a single quiet *name* dominating a ranking for
   * reasons unrelated to skill - the EA case, a price pinned near a deal.
   * That reasoning does not carry over to a portfolio: a well-diversified
   * basket routinely produces sigma below VOL_FLOOR as the ordinary,
   * intended result of combining imperfectly-correlated holdings, not an
   * anomaly to correct for. Portfolio-level callers pass false.
   */
  applyFloor = true
): WindowStats | null {
  if (endIndex <= startIndex) return null;

  const startPrice = closeAt(ticker, startIndex);
  const endPrice = closeAt(ticker, endIndex);
  if (startPrice === null || endPrice === null || startPrice <= 0) return null;

  const totalReturn = endPrice / startPrice - 1;

  const lo = startIndex - ticker.offset;
  const hi = endIndex - ticker.offset;
  const observations = hi - lo;

  const years = observations / TRADING_DAYS_PER_YEAR;
  const growth = endPrice / startPrice;
  const annualizedReturn = years > 0 ? Math.pow(growth, 1 / years) - 1 : null;

  let annualizedVol: number | null = null;
  if (observations >= MIN_VOL_OBSERVATIONS) {
    // Log returns so that compounding is additive and the sigma of a
    // multi-day window scales cleanly with sqrt(time).
    let sum = 0;
    for (let i = lo + 1; i <= hi; i++) {
      sum += Math.log(ticker.closes[i] / ticker.closes[i - 1]);
    }
    const mean = sum / observations;

    let sumSq = 0;
    for (let i = lo + 1; i <= hi; i++) {
      const d = Math.log(ticker.closes[i] / ticker.closes[i - 1]) - mean;
      sumSq += d * d;
    }
    // Bessel-corrected: these are a sample of the return process, not the
    // whole population.
    const variance = observations > 1 ? sumSq / (observations - 1) : 0;
    annualizedVol = Math.sqrt(variance * TRADING_DAYS_PER_YEAR);
  }

  // Divisor is floored when asked; `annualizedVol` above always stays the
  // honest measurement either way.
  const divisor =
    annualizedVol === null ? null : applyFloor ? Math.max(annualizedVol, VOL_FLOOR) : annualizedVol;
  const ratio =
    annualizedReturn !== null && divisor !== null && divisor > 1e-9
      ? annualizedReturn / divisor
      : null;

  return {
    startPrice,
    endPrice,
    totalReturn,
    annualizedReturn,
    annualizedVol,
    volFloored: applyFloor && annualizedVol !== null && annualizedVol < VOL_FLOOR,
    ratio,
    observations,
  };
}

export type MetricKey = 'return' | 'ratio';

/** The value a given metric ranks and displays on the list rows. */
export function metricValue(
  stats: WindowStats | null,
  metric: MetricKey
): number | null {
  if (!stats) return null;
  return metric === 'return' ? stats.totalReturn : stats.ratio;
}

// --- formatting --------------------------------------------------------------

export function formatPercent(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
}

export function formatPercentPlain(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatRatio(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

export function formatMetric(v: number | null, metric: MetricKey): string {
  return metric === 'return' ? formatPercent(v) : formatRatio(v);
}

export function formatPrice(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v >= 1000
    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toFixed(2);
}

export function formatBigNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}
