import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PriceChart } from '../components/PriceChart';
import { SegmentedControl } from '../components/SegmentedControl';
import { DATES, Ticker, formatDate, slice } from '../data/market';
import {
  computeWindowStats,
  formatBigNumber,
  formatPercent,
  formatPercentPlain,
  formatPrice,
  formatRatio,
} from '../data/stats';
import { PRESETS, PresetKey, windowForPreset } from '../data/windows';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

/** Every preset gets a row in the table, so all horizons are visible at once. */
const TABLE_ROWS = PRESETS;

export function TickerDetail({
  ticker,
  initialPreset,
  width,
}: {
  ticker: Ticker;
  initialPreset: PresetKey;
  width: number;
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
  const series = useMemo(
    () => slice(ticker, win.startIndex, win.endIndex),
    [ticker, win]
  );
  const stats = useMemo(
    () => computeWindowStats(ticker, win.startIndex, win.endIndex),
    [ticker, win]
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
        const w = clampStart(windowForPreset(row.key));
        return {
          key: row.key,
          label: row.label,
          stats: computeWindowStats(ticker, w.startIndex, w.endIndex),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker]
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
            {scrubbing ? formatDate(shownDate) : `over ${preset === '2Y' ? 'max' : preset}`}
          </Text>
        </View>
      </View>

      <PriceChart values={series} onScrub={setScrub} />

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
                <Text style={[type.bodyStrong, styles.tdLabel, { color: colors.text }]}>
                  {row.label}
                </Text>
                <Text style={[type.caption, mono, styles.td, { color: rowTone }]}>
                  {formatPercent(rt, 1)}
                </Text>
                <Text style={[type.caption, mono, styles.td, { color: colors.textMuted }]}>
                  {formatPercentPlain(row.stats?.annualizedVol ?? null)}
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
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          ABOUT
        </Text>
        <View style={[styles.facts, { backgroundColor: colors.surface }]}>
          {[
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
  tdLabel: { width: 56 },
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
