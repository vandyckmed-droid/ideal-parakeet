/**
 * Earnings as a risk flag, deliberately not as a forecast.
 *
 * `tools/research/` tested the standard surprise score against forward returns
 * across two denominators, five lookback windows and three horizons - thirty
 * cells, all reported in the README - and found nothing to trade: the
 * information is priced within two days in a universe of the 500 most
 * analyst-covered companies on earth. So the app says when a report lands and
 * how hard that name usually moves, and stops there.
 *
 * The move figure is per-name for a reason. Across these 500 the median
 * reporting-day move runs from 0.6% (`CVX`) to 23% (`UI`); a single universe
 * average of ~4.7% would describe almost none of them.
 */

/** Days out at which a report starts being worth mentioning on a row. */
export const EARNINGS_SOON_DAYS = 7;

/**
 * Calendar days from today until `date`, or null if there is no date.
 *
 * Calendar days rather than trading sessions: this answers "when", and a
 * holder counts in days off a calendar, not in sessions. Anchored to the
 * device's today rather than to the snapshot's newest bar, so an ageing
 * snapshot cannot report a report as further away than it is.
 */
export function daysUntilEarnings(date: string | undefined, today: Date = new Date()): number | null {
  if (!date) return null;
  const then = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((then - now) / 86_400_000);
}

/** True when a report is close enough that it belongs on the row itself. */
export function earningsImminent(date: string | undefined, today: Date = new Date()): boolean {
  const d = daysUntilEarnings(date, today);
  return d !== null && d >= 0 && d <= EARNINGS_SOON_DAYS;
}

/** "3d", "today", "tomorrow" - short enough to sit beside a symbol. */
export function formatDaysUntil(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days}d`;
}

/** "±5.8%", or null when the name has too few past reports to have a habit. */
export function formatEarningsMove(move: number | undefined): string | null {
  if (move === undefined || !Number.isFinite(move)) return null;
  return `±${(move * 100).toFixed(1)}%`;
}
