import { MARKET, Ticker, closeAt } from './market';

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
  /**
   * The window's return with the market's contribution taken out: the name is
   * regressed on the market over this same window, and what is accumulated is
   * `r - beta * r_market` rather than `r`, expressed back as a percentage.
   *
   * Ranking on plain return quietly favours high-beta names, because in a
   * rising market a beta of 1.4 earns 40% more than the market for taking 40%
   * more of its risk - which is leverage, not selection. This strips that out
   * and leaves what the name did that the market does not account for.
   *
   * Beta is measured over the displayed window, so the figure answers "over
   * *this* stretch" for every window the picker offers. That differs from the
   * Research tab's backtest, which has fifteen years to work with and uses a
   * fixed three-year beta; the bundled dataset holds about two.
   *
   * Null when the window is too short to fit a beta, or when the market never
   * moved within it.
   */
  residualReturn: number | null;
  /** Geometric annualisation of `residualReturn`, on the same window years as `annualizedReturn`. */
  annualizedResidualReturn: number | null;
  /**
   * Sample sigma of the regression's daily residuals - the risk left over
   * once the market's contribution is removed, the same way `residualReturn`
   * is the return left over. Scaled by sqrt(252), never floored, null under
   * the same conditions as `residualReturn`.
   */
  residualVol: number | null;
  /** True when `residualRatio`'s divisor was raised to `VOL_FLOOR`. */
  residualVolFloored: boolean;
  /**
   * `annualizedResidualReturn` over `residualVol` - an information-ratio-style
   * figure: excess return per unit of the risk that excess return actually
   * took, both with the market's contribution already stripped out. Answers a
   * different question than `ratio`, which relates total return to total risk
   * and never removes the market at all.
   *
   * Residual risk is typically much smaller than total risk (most of a name's
   * variance IS the market), so this divisor hits `VOL_FLOOR` far more often
   * than `ratio`'s does - expected, not a bug: a name that tracks the market
   * almost exactly has almost no idiosyncratic risk to divide by.
   */
  residualRatio: number | null;
  /** Slope of the name against the market over the window. */
  beta: number | null;
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
  endIndex: number
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

  // `annualizedVol` above always stays the honest measurement; only the
  // divisor moves.
  const divisor = annualizedVol === null ? null : Math.max(annualizedVol, VOL_FLOOR);
  const ratio =
    annualizedReturn !== null && divisor !== null && divisor > 1e-9
      ? annualizedReturn / divisor
      : null;

  // --- the market-residual return --------------------------------------------
  // One pass of ordinary least squares of the name on the market over exactly
  // the window being displayed, then the residual accumulated in log space and
  // converted back. Log returns matter twice here: they make the regression
  // linear and they make the residual summable.
  let beta: number | null = null;
  let residualReturn: number | null = null;
  let annualizedResidualReturn: number | null = null;
  let residualVol: number | null = null;
  if (observations >= MIN_VOL_OBSERVATIONS) {
    const mLo = startIndex - MARKET.offset;
    const mHi = endIndex - MARKET.offset;
    if (mLo >= 0 && mHi < MARKET.closes.length) {
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
      for (let i = 1; i <= hi - lo; i++) {
        const y = Math.log(ticker.closes[lo + i] / ticker.closes[lo + i - 1]);
        const x = Math.log(MARKET.closes[mLo + i] / MARKET.closes[mLo + i - 1]);
        if (!Number.isFinite(y) || !Number.isFinite(x)) continue;
        n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
      }
      const varX = n > 1 ? sxx / n - (sx / n) ** 2 : 0;
      if (n >= MIN_VOL_OBSERVATIONS && varX > 1e-12) {
        beta = (sxy / n - (sx / n) * (sy / n)) / varX;
        // Deliberately no alpha term. Fitting an intercept over the very window
        // being measured would absorb the drift into it and leave a residual
        // that sums to zero for every name, which is precisely the thing being
        // ranked.
        residualReturn = Math.expm1(sy - beta * sx);

        const resYears = n / TRADING_DAYS_PER_YEAR;
        annualizedResidualReturn =
          resYears > 0 ? Math.pow(1 + residualReturn, 1 / resYears) - 1 : null;

        // Sigma of the daily residuals e_i = y_i - beta*x_i, Bessel-corrected
        // around their own mean - same construction as `annualizedVol`, just
        // applied to what the market regression leaves behind. Expanded in
        // closed form from the sums already collected above (no alpha term
        // was fit, so e's mean need not be zero):
        //   sum(e_i^2) = syy - 2*beta*sxy + beta^2*sxx
        const sumE = sy - beta * sx;
        const meanE = sumE / n;
        const sumE2 = syy - 2 * beta * sxy + beta * beta * sxx;
        const varE = n > 1 ? (sumE2 - n * meanE * meanE) / (n - 1) : 0;
        residualVol = Math.sqrt(Math.max(0, varE) * TRADING_DAYS_PER_YEAR);
      }
    }
  }

  const residualDivisor = residualVol === null ? null : Math.max(residualVol, VOL_FLOOR);
  const residualRatio =
    annualizedResidualReturn !== null && residualDivisor !== null && residualDivisor > 1e-9
      ? annualizedResidualReturn / residualDivisor
      : null;

  return {
    startPrice,
    endPrice,
    totalReturn,
    annualizedReturn,
    annualizedVol,
    volFloored: annualizedVol !== null && annualizedVol < VOL_FLOOR,
    ratio,
    residualReturn,
    annualizedResidualReturn,
    residualVol,
    residualVolFloored: residualVol !== null && residualVol < VOL_FLOOR,
    residualRatio,
    beta,
    observations,
  };
}

/**
 * Return, Return÷σ and Residual are two independent questions - "risk-adjust
 * it?" and "strip the market out first?" - not three points on one dial, so
 * they toggle independently rather than picking one of a fixed set. `return`
 * is what's left when neither toggle is on, not a selectable option of its
 * own. `residualRatio` (both on) is the fourth combination: the residual
 * return divided by the residual's OWN sigma, not the total sigma - see
 * `WindowStats.residualRatio`.
 */
export type MetricKey = 'return' | 'ratio' | 'residual' | 'residualRatio';

/** Whether the "÷ σ" toggle is on for a given combined metric. */
export function metricRatioOn(metric: MetricKey): boolean {
  return metric === 'ratio' || metric === 'residualRatio';
}

/** Whether the "Residual" toggle is on for a given combined metric. */
export function metricResidualOn(metric: MetricKey): boolean {
  return metric === 'residual' || metric === 'residualRatio';
}

/** The inverse of the two functions above: two toggle states back to one key. */
export function combineMetric(ratioOn: boolean, residualOn: boolean): MetricKey {
  if (ratioOn && residualOn) return 'residualRatio';
  if (residualOn) return 'residual';
  if (ratioOn) return 'ratio';
  return 'return';
}

/** The value a given metric ranks and displays on the list rows. */
export function metricValue(
  stats: WindowStats | null,
  metric: MetricKey
): number | null {
  if (!stats) return null;
  if (metric === 'return') return stats.totalReturn;
  if (metric === 'residual') return stats.residualReturn;
  if (metric === 'residualRatio') return stats.residualRatio;
  return stats.ratio;
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
  return metric === 'ratio' || metric === 'residualRatio' ? formatRatio(v) : formatPercent(v);
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
