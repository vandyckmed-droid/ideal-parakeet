import { DATES, LAST_INDEX } from './market';

/**
 * Trading sessions between the newest bar in the snapshot and today.
 *
 * Windows are anchored to the calendar, not to whenever the data was last
 * refreshed. With a 20-session skip, a snapshot three days stale still holds
 * every price a 12-1 measurement needs - the measurement ends 20 sessions back,
 * far behind the last refresh - so there is no reason to give up those three
 * days of lookback. Anchoring to the last bar instead would silently slide the
 * whole window backwards every day the data ages.
 *
 * Weekend-aware only. A market holiday inside the gap makes this overcount by
 * one session, which moves the measurement date by a day and changes a
 * multi-month return negligibly; carrying a holiday calendar to fix that is not
 * worth the maintenance.
 */
export function sessionsSinceSnapshot(today: Date = new Date()): number {
  const last = DATES[LAST_INDEX];
  // Parse as UTC midnight so a device in any timezone counts the same days.
  const cursor = new Date(`${last}T00:00:00Z`);
  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  let sessions = 0;
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() > end) break;
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) sessions++;
    // A wildly wrong device clock should not spin here.
    if (sessions > 500) break;
  }
  return sessions;
}

export type PresetKey = '1M' | '3M' | '6M' | '9M' | '1Y' | '2Y' | 'CUSTOM';

/** Approximate trading-day counts; 2Y is resolved from the calendar instead. */
const LOOKBACK: Record<Exclude<PresetKey, '2Y' | 'CUSTOM'>, number> = {
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '9M': 189,
  '1Y': 252,
};

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '9M', label: '9M' },
  { key: '1Y', label: '1Y' },
  { key: '2Y', label: 'Max' },
];

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
  /**
   * Sessions by which the snapshot fell short of the calendar-anchored target
   * end. Zero whenever the data is fresh enough to honour the anchor, which is
   * every case where staleness does not exceed the skip.
   */
  shortfall: number;
};

/**
 * Resolve a window to the range the maths should actually use.
 *
 * Anchoring: the target end is `skip` sessions before *today*, not before the
 * newest bar. When the snapshot is fresher than the skip - the ordinary case -
 * that target is already in the data and the full lookback is preserved even
 * though the file is a few days old.
 *
 * When staleness exceeds the skip the target is unreachable, so the end clamps
 * to the newest bar and the start moves with it to keep the window its intended
 * length. That degrades to a correct-length window ending as close to the
 * target as the data allows, and reports the gap in `shortfall` so the UI can
 * say so rather than quietly measuring something shorter than its label.
 *
 * The skip itself is clamped so a short custom window cannot be reduced to a
 * degenerate one, and the clamped figure is returned so the control can show
 * the number really in force.
 */
export function withSkip(
  win: DateWindow,
  enabled: boolean,
  sessionsStale = 0
): EffectiveWindow {
  if (!enabled) {
    // With no skip there is no slack to spend: the newest bar is the best
    // available end no matter what today's date is.
    return { startIndex: win.startIndex, endIndex: win.endIndex, skip: 0, shortfall: 0 };
  }

  const sessions = win.endIndex - win.startIndex;
  const room = Math.max(0, sessions - MIN_SESSIONS_AFTER_SKIP);
  const skip = Math.min(skipForLength(sessions), room);

  // A custom window names explicit days, so its stop day is the anchor and
  // today is irrelevant; only presets track the calendar.
  const anchor = win.preset === 'CUSTOM' ? 0 : sessionsStale;

  const targetEnd = win.endIndex + anchor - skip;
  const endIndex = Math.min(LAST_INDEX, targetEnd);
  const length = sessions - skip;

  return {
    startIndex: Math.max(0, endIndex - length),
    endIndex,
    skip,
    shortfall: Math.max(0, targetEnd - endIndex),
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
