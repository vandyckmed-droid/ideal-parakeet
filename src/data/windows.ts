import { DATES, LAST_INDEX } from './market';

export type PresetKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '2Y' | 'CUSTOM';

/** Approximate trading-day counts; YTD and 2Y are resolved from the calendar. */
const LOOKBACK: Record<Exclude<PresetKey, 'YTD' | '2Y' | 'CUSTOM'>, number> = {
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
};

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '2Y', label: 'Max' },
];

/** First trading day of the year containing the newest close. */
function startOfYearIndex(): number {
  const year = DATES[LAST_INDEX].slice(0, 4);
  const i = DATES.findIndex((d) => d.startsWith(year));
  // A snapshot taken in early January may not yet contain the new year's
  // first session; fall back to the whole history rather than an empty window.
  return i <= 0 ? 0 : i - 1;
}

export type DateWindow = {
  startIndex: number;
  endIndex: number;
  preset: PresetKey;
};

export function windowForPreset(preset: PresetKey): DateWindow {
  const endIndex = LAST_INDEX;
  if (preset === '2Y' || preset === 'CUSTOM') {
    return { startIndex: 0, endIndex, preset };
  }
  if (preset === 'YTD') {
    return { startIndex: startOfYearIndex(), endIndex, preset };
  }
  return {
    startIndex: Math.max(0, endIndex - LOOKBACK[preset]),
    endIndex,
    preset,
  };
}

/**
 * Trading days dropped from the recent end of a window.
 *
 * Short-horizon reversal is the reason: whatever moved hardest in the last few
 * weeks tends to give some of it back, so a ranking measured right up to the
 * newest close partly ranks noise that is about to unwind. Dropping the tail is
 * the standard fix - Fama-French's momentum factor is built from the prior
 * 2-12 month return for exactly this reason.
 *
 * Keyed off window *length* rather than the preset name so a hand-picked custom
 * window gets a sensible skip too. Sublinear on purpose: reversal is roughly a
 * fixed one-month effect rather than a fixed fraction of the lookback, so a
 * proportional skip would gut the short windows and under-correct the long ones.
 */
export function skipForLength(sessions: number): number {
  if (sessions <= 21) return 5; // ~1M
  if (sessions <= 63) return 10; // ~3M
  if (sessions <= 126) return 15; // ~6M
  return 20; // 1Y and longer
}

/** Sessions that must survive the skip, matching the minimum for a sigma. */
const MIN_SESSIONS_AFTER_SKIP = 10;

export type EffectiveWindow = {
  startIndex: number;
  endIndex: number;
  /** Sessions actually dropped, after clamping. Zero when skip is off. */
  skip: number;
};

/**
 * Resolve a window to the range the maths should actually use.
 *
 * The skip is clamped so a short custom window cannot be shortened into a
 * degenerate one. The clamped figure is what gets returned, so the UI can label
 * the button with the number really in force rather than the one asked for.
 */
export function withSkip(win: DateWindow, enabled: boolean): EffectiveWindow {
  if (!enabled) {
    return { startIndex: win.startIndex, endIndex: win.endIndex, skip: 0 };
  }
  const sessions = win.endIndex - win.startIndex;
  const room = Math.max(0, sessions - MIN_SESSIONS_AFTER_SKIP);
  const skip = Math.min(skipForLength(sessions), room);
  return {
    startIndex: win.startIndex,
    endIndex: win.endIndex - skip,
    skip,
  };
}

export function describeWindow(w: DateWindow): string {
  const days = w.endIndex - w.startIndex;
  if (days >= 252) {
    const years = days / 252;
    return `${years.toFixed(years >= 10 ? 0 : 1)}y · ${days} sessions`;
  }
  const months = days / 21;
  return `${months.toFixed(months >= 10 ? 0 : 1)}mo · ${days} sessions`;
}
