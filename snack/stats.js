// Return and risk maths. Mirrors src/data/stats.ts exactly - if these two ever
// disagree, this file is the one that is wrong.

export const TRADING_DAYS_PER_YEAR = 252;

// Below this many observations an annualised sigma is mostly sampling noise,
// and it would look authoritative while meaning very little.
export const MIN_VOL_OBSERVATIONS = 10;

/**
 * Floor on the sigma used as the ratio's divisor.
 *
 * A genuinely quiet name divides by a small number and scores enormously for
 * reasons unrelated to skill - the clearest case being a stock pinned near an
 * announced acquisition price, whose realised vol collapses because the price
 * tracks a deal rather than a business.
 *
 * Floors the divisor only. The sigma shown in the interface stays the true
 * measurement; a displayed risk figure that silently read high would be worse
 * than the problem being solved.
 */
export const VOL_FLOOR = 0.125;

/** Close on a master-calendar index, or null if the name had not listed yet. */
export function closeAt(t, index) {
  const local = index - t.o;
  if (local < 0 || local >= t.p.length) return null;
  return t.p[local];
}

/** Closes over an inclusive index range, clipped to the listing date. */
export function slice(t, from, to) {
  const lo = Math.max(from - t.o, 0);
  const hi = Math.min(to - t.o, t.p.length - 1);
  if (hi < lo) return [];
  return t.p.slice(lo, hi + 1);
}

/**
 * Return and risk between two master-calendar indices, inclusive.
 *
 * Both halves of the ratio are annualised on purpose. Dividing a raw window
 * return by an annualised sigma mixes units, so identical skill would score
 * differently over one month than over one year and the column could not be
 * ranked at all.
 */
export function computeWindowStats(ticker, startIndex, endIndex) {
  if (endIndex <= startIndex) return null;

  const startPrice = closeAt(ticker, startIndex);
  const endPrice = closeAt(ticker, endIndex);
  if (startPrice === null || endPrice === null || startPrice <= 0) return null;

  const totalReturn = endPrice / startPrice - 1;
  const lo = startIndex - ticker.o;
  const hi = endIndex - ticker.o;
  const observations = hi - lo;

  const years = observations / TRADING_DAYS_PER_YEAR;
  const growth = endPrice / startPrice;
  const annualizedReturn = years > 0 ? Math.pow(growth, 1 / years) - 1 : null;

  let annualizedVol = null;
  if (observations >= MIN_VOL_OBSERVATIONS) {
    // Log returns: compounding is additive, so sigma scales with sqrt(time).
    let sum = 0;
    for (let i = lo + 1; i <= hi; i++) sum += Math.log(ticker.p[i] / ticker.p[i - 1]);
    const mean = sum / observations;

    let sumSq = 0;
    for (let i = lo + 1; i <= hi; i++) {
      const d = Math.log(ticker.p[i] / ticker.p[i - 1]) - mean;
      sumSq += d * d;
    }
    // Bessel-corrected: a sample of the return process, not the population.
    const variance = observations > 1 ? sumSq / (observations - 1) : 0;
    annualizedVol = Math.sqrt(variance * TRADING_DAYS_PER_YEAR);
  }

  // Divisor is floored; `annualizedVol` stays the honest measurement.
  const divisor = annualizedVol === null ? null : Math.max(annualizedVol, VOL_FLOOR);
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
    volFloored: annualizedVol !== null && annualizedVol < VOL_FLOOR,
    ratio,
    observations,
  };
}

export function metricValue(stats, metric) {
  if (!stats) return null;
  return metric === 'return' ? stats.totalReturn : stats.ratio;
}

// --- windows -----------------------------------------------------------------

export const PRESETS = [
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '9M', label: '9M' },
  { key: '1Y', label: '1Y' },
  { key: '2Y', label: 'Max' },
];

const LOOKBACK = { '1M': 21, '3M': 63, '6M': 126, '9M': 189, '1Y': 252 };

export function windowForPreset(preset, dates) {
  const endIndex = dates.length - 1;
  if (preset === '2Y' || preset === 'CUSTOM') return { startIndex: 0, endIndex, preset };
  return { startIndex: Math.max(0, endIndex - LOOKBACK[preset]), endIndex, preset };
}

/**
 * Trading days dropped from the recent end of a window.
 *
 * Short-horizon reversal is the reason: whatever moved hardest in the last few
 * weeks tends to give some of it back, so a ranking measured up to the newest
 * close partly ranks noise that is about to unwind.
 *
 * Keyed off window length rather than preset name so custom windows get a
 * sensible skip too. Sublinear on purpose: reversal is roughly a fixed
 * one-month effect, not a fixed fraction of the lookback.
 */
export function skipForLength(sessions) {
  if (sessions <= 21) return 5;
  if (sessions <= 63) return 10;
  if (sessions <= 126) return 15;
  if (sessions <= 189) return 17; // ~9M, interpolated between 6M and 1Y
  return 20;
}

const MIN_SESSIONS_AFTER_SKIP = 10;

/**
 * Trading sessions between the newest bar in the snapshot and today.
 *
 * Windows track the calendar, not the refresh time. With a 20-session skip a
 * snapshot three days stale still holds every price a 12-1 measurement needs,
 * so there is no reason to surrender those three days of lookback.
 *
 * Weekend-aware only; a holiday in the gap overcounts by one session, which
 * moves the measurement date a day and barely touches a multi-month return.
 */
export function sessionsSinceSnapshot(dates, today) {
  const now = today || new Date();
  const cursor = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const end = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let sessions = 0;
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() > end) break;
    const d = cursor.getUTCDay();
    if (d !== 0 && d !== 6) sessions++;
    if (sessions > 500) break; // a wrong device clock must not spin
  }
  return sessions;
}

/**
 * Resolve a window to the range the maths should use.
 *
 * The target end is `skip` sessions before *today*, not before the newest bar,
 * so an ageing snapshot does not quietly drag the whole window backwards. When
 * staleness exceeds the skip that target is unreachable: the end clamps to the
 * newest bar and the start follows so the window keeps its intended length, and
 * `shortfall` reports the gap so the UI can say so.
 *
 * The skip is clamped so a short custom window cannot become degenerate, and
 * the clamped figure comes back so the control shows what is really applied.
 */
export function withSkip(win, enabled, sessionsStale, lastIndex) {
  if (!enabled) {
    return { startIndex: win.startIndex, endIndex: win.endIndex, skip: 0, shortfall: 0 };
  }
  const sessions = win.endIndex - win.startIndex;
  const room = Math.max(0, sessions - MIN_SESSIONS_AFTER_SKIP);
  const skip = Math.min(skipForLength(sessions), room);

  // A custom window names explicit days, so its own stop day is the anchor.
  const anchor = win.preset === 'CUSTOM' ? 0 : sessionsStale || 0;
  const targetEnd = win.endIndex + anchor - skip;
  const endIndex = Math.min(lastIndex, targetEnd);
  const length = sessions - skip;

  return {
    startIndex: Math.max(0, endIndex - length),
    endIndex,
    skip,
    shortfall: Math.max(0, targetEnd - endIndex),
  };
}

export function describeWindow(w) {
  const days = w.endIndex - w.startIndex;
  if (days >= 252) {
    const y = days / 252;
    return `${y.toFixed(y >= 10 ? 0 : 1)}y · ${days} sessions`;
  }
  const m = days / 21;
  return `${m.toFixed(m >= 10 ? 0 : 1)}mo · ${days} sessions`;
}

// --- formatting --------------------------------------------------------------

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}
export function formatDateShort(d) {
  const [, m, day] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}`;
}
export function formatPercent(v, digits = 2) {
  if (v === null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
}
export function formatPercentPlain(v, digits = 1) {
  if (v === null || !isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}
export function formatRatio(v) {
  if (v === null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}
export function formatMetric(v, metric) {
  return metric === 'return' ? formatPercent(v) : formatRatio(v);
}
export function formatPrice(v) {
  if (v === null || !isFinite(v)) return '—';
  return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);
}
export function formatBigNumber(v) {
  if (!isFinite(v)) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}
