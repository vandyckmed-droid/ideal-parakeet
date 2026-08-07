import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PriceChart } from '../components/PriceChart';
import { SegmentedControl } from '../components/SegmentedControl';
import { daysUntilEarnings, formatDaysUntil, formatEarningsMove } from '../data/earnings';
import { DATES, Ticker, formatDate, slice } from '../data/market';
import {
  computeWindowStats,
  formatBigNumber,
  formatPercent,
  formatPercentPlain,
  formatPrice,
  formatRatio,
  VOL_FLOOR,
} from '../data/stats';
import { PRESETS, PresetKey, windowForPreset, withSkip } from '../data/windows';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

/** Every preset gets a row in the table, so all horizons are visible at once. */
const TABLE_ROWS = PRESETS;

export function TickerDetail({
  ticker,
  initialPreset,
  width,
  skipEnabled,
  sessionsStale,
}: {
  ticker: Ticker;
  initialPreset: PresetKey;
  width: number;
  skipEnabled: boolean;
  sessionsStale: number;
}) {
  const colors = useColors();
  const [preset, setPreset] = useState<PresetKey>(
    initialPreset === 'CUSTOM' ? '1Y' : initialPreset
  );
  const [scrub, setScrub] = useState<number | null>(null);

  // "Max" means the most history this particular name has, so it clamps to the
  // listing date. The other presets deliberately do not: reporting six months
  // of a 2025 listing under a "1Y" heading would overstate the horizon. The
  // Market tab never clamps at all, because a cross-sectional ranking is only
  // meaningful when every name is measured from the same day.
  const clampStart = (w: ReturnType<typeof windowForPreset>) =>
    w.preset === '2Y' ? { ...w, startIndex: Math.max(w.startIndex, ticker.offset) } : w;

  const win = useMemo(() => clampStart(windowForPreset(preset)), [preset, ticker.offset]);
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  // Drawn out to the unskipped end so the excluded tail stays visible; the
  // chart dims it rather than hiding it.
  const series = useMemo(
    () => slice(ticker, win.startIndex, win.endIndex),
    [ticker, win]
  );
  const measuredLength = useMemo(
    () => slice(ticker, range.startIndex, range.endIndex).length,
    [ticker, range]
  );
  const excludeTail = Math.max(0, series.length - measuredLength);

  const stats = useMemo(
    () => computeWindowStats(ticker, range.startIndex, range.endIndex),
    [ticker, range]
  );

  // While a finger is down the header reports the scrubbed point instead of
  // the window's close, so the chart and the numbers never disagree.
  const scrubbing = scrub !== null && scrub < series.length;
  const shownPrice = scrubbing ? series[scrub] : ticker.lastClose;
  const shownReturn = scrubbing
    ? series[0] > 0
      ? series[scrub] / series[0] - 1
      : null
    : (stats?.totalReturn ?? null);

  // The first master-calendar index this series actually covers, so the
  // scrubbed date label stays correct for names that listed mid-window.
  const seriesStart = Math.max(win.startIndex, ticker.offset);
  const shownDate = scrubbing
    ? DATES[Math.min(seriesStart + scrub, win.endIndex)]
    : DATES[win.endIndex];

  const tone =
    shownReturn === null ? colors.flat : shownReturn >= 0 ? colors.up : colors.down;

  const table = useMemo(
    () =>
      TABLE_ROWS.map((row) => {
        // Each row resolves its own skip, so a 1M row drops 5 days while the
        // 1Y row drops 20 - the ladder applies per window, not per screen.
        const r = withSkip(clampStart(windowForPreset(row.key)), skipEnabled, sessionsStale);
        return {
          key: row.key,
          label: row.label,
          skip: r.skip,
          stats: computeWindowStats(ticker, r.startIndex, r.endIndex),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker, skipEnabled, sessionsStale]
  );

  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headline}>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {ticker.name}
        </Text>
        <Text style={[type.hero, mono, { color: colors.text }]}>
          ${formatPrice(shownPrice)}
        </Text>
        <View style={styles.changeLine}>
          <Text style={[type.bodyStrong, mono, { color: tone }]}>
            {formatPercent(shownReturn)}
          </Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {scrubbing
              ? formatDate(shownDate)
              : `over ${preset === '2Y' ? 'max' : preset}` +
                (range.skip > 0 ? ` · ex last ${range.skip}d` : '')}
          </Text>
        </View>
      </View>

      <PriceChart values={series} onScrub={setScrub} excludeTail={excludeTail} />

      <View style={styles.section}>
        <SegmentedControl<PresetKey>
          segments={PRESETS}
          value={preset}
          onChange={setPreset}
          compact
        />
      </View>

      <View style={styles.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          PERFORMANCE BY WINDOW
        </Text>
        <View style={[styles.table, { borderColor: colors.hairline }]}>
          <View style={[styles.tr, { borderBottomColor: colors.hairline }]}>
            <Text style={[type.micro, styles.tdLabel, { color: colors.textFaint }]}>
              WINDOW
            </Text>
            <Text style={[type.micro, styles.td, { color: colors.textFaint }]}>RETURN</Text>
            <Text style={[type.micro, styles.td, { color: colors.textFaint }]}>ANN σ</Text>
            <Text style={[type.micro, styles.td, { color: colors.textFaint }]}>RET ÷ σ</Text>
          </View>

          {table.map((row) => {
            const rt = row.stats?.totalReturn ?? null;
            const rowTone = rt === null ? colors.flat : rt >= 0 ? colors.up : colors.down;
            const active = row.key === preset;
            return (
              <View
                key={row.key}
                style={[
                  styles.tr,
                  {
                    borderBottomColor: colors.hairline,
                    backgroundColor: active ? colors.surface : 'transparent',
                  },
                ]}
              >
                <View style={styles.tdLabel}>
                  <Text style={[type.bodyStrong, { color: colors.text }]}>{row.label}</Text>
                  {row.skip > 0 && (
                    <Text style={[type.micro, { color: colors.textFaint }]}>
                      −{row.skip}d
                    </Text>
                  )}
                </View>
                <Text style={[type.caption, mono, styles.td, { color: rowTone }]}>
                  {formatPercent(rt, 1)}
                </Text>
                <Text style={[type.caption, mono, styles.td, { color: colors.textMuted }]}>
                  {formatPercentPlain(row.stats?.annualizedVol ?? null)}
                  {row.stats?.volFloored ? '*' : ''}
                </Text>
                <Text style={[type.caption, mono, styles.td, { color: colors.text }]}>
                  {formatRatio(row.stats?.ratio ?? null)}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(2) }]}>
          Ret ÷ σ is the annualised return over the annualised standard
          deviation of daily log returns in the same window.
          {range.skip > 0
            ? ' Each window stops short of the newest close by the days marked' +
              ' against it, so recent reversal is left out of the measurement.'
            : ''}
          {table.some((r) => r.stats?.volFloored)
            ? ` A starred σ sits below the ${(VOL_FLOOR * 100).toFixed(1)}% floor` +
              ' applied to the divisor, so the ratio beside it is held back from' +
              ' the very large value a near-zero σ would otherwise produce. The σ' +
              ' shown is the real measurement.'
            : ''}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          ABOUT
        </Text>
        <View style={[styles.facts, { backgroundColor: colors.surface }]}>
          {[
            // A report is a scheduled volatility event, so it sits with the
            // other facts about the name rather than pretending to be a
            // signal. The move figure is this name's own median, because the
            // universe average describes nobody: 0.6% to 23% across the 500.
            ...(ticker.nextEarnings
              ? [
                  [
                    'Next report',
                    `${formatDate(ticker.nextEarnings)}${
                      (() => {
                        const d = daysUntilEarnings(ticker.nextEarnings);
                        return d !== null && d >= 0 ? ` · ${formatDaysUntil(d)}` : '';
                      })()
                    }`,
                  ] as [string, string],
                ]
              : []),
            ...(formatEarningsMove(ticker.earningsMove)
              ? [
                  [
                    'Typical move on the day',
                    formatEarningsMove(ticker.earningsMove)!,
                  ] as [string, string],
                ]
              : []),
            ['Sector', ticker.sector],
            ['Industry', ticker.industry],
            ['Exchange', ticker.exchange],
            ['Domicile', ticker.country],
            ['Market cap', formatBigNumber(ticker.marketCap)],
            ['Median daily volume', formatBigNumber(ticker.dollarVolume)],
            ['History from', formatDate(DATES[ticker.offset])],
          ].map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
              <Text
                style={[type.caption, { color: colors.text, flexShrink: 1 }]}
                numberOfLines={1}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space(12) },
  headline: { paddingHorizontal: space(4), paddingBottom: space(4), gap: space(1) },
  changeLine: { flexDirection: 'row', alignItems: 'baseline', gap: space(2) },
  section: { paddingHorizontal: space(4), paddingTop: space(5) },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space(2.75),
    paddingHorizontal: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tdLabel: { width: 56, gap: 1 },
  td: { flex: 1, textAlign: 'right' },
  facts: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space(4),
    paddingVertical: space(2.5),
  },
});
