// Earnings as a risk flag, not a forecast. Mirrors src/data/earnings.ts - if
// these two ever disagree, the .ts file is the one that is wrong.
//
// tools/research/ tested the standard surprise score against forward returns
// across two denominators, five lookbacks and three horizons - thirty cells,
// all in the README - and found nothing to trade: the information is priced
// within two days in a universe of the 500 most analyst-covered companies on
// earth. So the app says when a report lands and how hard that name usually
// moves, and stops there.
//
// The move figure is per-name for a reason: across these 500 the median
// reporting-day move runs 0.6% to 23%, so one universe average describes
// almost nobody.

/** Days out at which a report starts being worth mentioning on a row. */
export const EARNINGS_SOON_DAYS = 7;

/**
 * Calendar days from today until `date`, or null if there is no date.
 * Anchored to the device's today rather than the snapshot's newest bar, so an
 * ageing snapshot cannot report a report as further away than it is.
 */
export function daysUntilEarnings(date, today) {
  if (!date) return null;
  const then = Date.parse(`${date}T00:00:00Z`);
  if (isNaN(then)) return null;
  const t = today || new Date();
  const now = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((then - now) / 86400000);
}

/** True when a report is close enough that it belongs on the row itself. */
export function earningsImminent(date, today) {
  const d = daysUntilEarnings(date, today);
  return d !== null && d >= 0 && d <= EARNINGS_SOON_DAYS;
}

/** "3d", "today", "tomorrow" - short enough to sit beside a symbol. */
export function formatDaysUntil(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days}d`;
}

/** "±5.8%", or null when the name has too few past reports to have a habit. */
export function formatEarningsMove(move) {
  if (move === undefined || move === null || !isFinite(move)) return null;
  return `±${(move * 100).toFixed(1)}%`;
}
