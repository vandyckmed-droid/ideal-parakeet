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

export function describeWindow(w: DateWindow): string {
  const days = w.endIndex - w.startIndex;
  if (days >= 252) {
    const years = days / 252;
    return `${years.toFixed(years >= 10 ? 0 : 1)}y · ${days} sessions`;
  }
  const months = days / 21;
  return `${months.toFixed(months >= 10 ? 0 : 1)}mo · ${days} sessions`;
}
