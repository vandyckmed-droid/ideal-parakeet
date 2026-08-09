import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CompareChart } from '../components/CompareChart';
import { PriceChart } from '../components/PriceChart';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sparkline } from '../components/Sparkline';
import { FAMILY_BY_KEY, FamilyTicker } from '../data/families';
import { BY_SYMBOL, DATES, formatDate, slice } from '../data/market';
import {
  VOL_FLOOR,
  computeWindowStats,
  formatPercent,
  formatPercentPlain,
  formatPrice,
  formatRatio,
} from '../data/stats';
import { PRESETS, PresetKey, windowForPreset, withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

const TABLE_ROWS = PRESETS;

/**
 * One family, laid out exactly like one ticker - deliberately. The headline
 * is the index's dollar value with the window return under it, the chart
 * scrubs with the figures following the finger, and every window's numbers
 * sit in the same table in the same order. A family is Ticker-shaped in the
 * data layer, and this screen is where that pays off for the eyes.
 *
 * Two things a ticker page cannot have:
 *
 * - **Companions.** When the compare set holds other families, the chart
 *   switches from the price chart to the shared-axis comparison, indexed to
 *   100 at the window start - dollar levels answer "how has the index
 *   grown", but between families they would compare start dates.
 *
 * - **Holdings.** A family is a small ETF, so it shows its current
 *   constituents, ranked by the same window the page is set to. The rows
 *   keep the app's one gesture pair: tap watchlists a stock, press and hold
 *   opens it.
 */
export function FamilyDetail({
  family,
  initialPreset,
  width,
  skipEnabled,
  sessionsStale,
  onScrubbingChange,
}: {
  family: FamilyTicker;
  initialPreset: PresetKey;
  width: number;
  skipEnabled: boolean;
  sessionsStale: number;
  onScrubbingChange?: (active: boolean) => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const { familyCompare, isWatched, toggleWatch } = useAppState();
  const [preset, setPreset] = useState<PresetKey>(
    initialPreset === 'CUSTOM' ? '1Y' : initialPreset
  );
  const [scrub, setScrub] = useState<number | null>(null);

  const handleScrub = useCallback(
    (index: number | null) => {
      setScrub(index);
      onScrubbingChange?.(index !== null);
    },
    [onScrubbingChange]
  );

  // "Max" clamps to the series start, same as a late-listing ticker.
  const clampStart = (w: ReturnType<typeof windowForPreset>) =>
    w.preset === '2Y' ? { ...w, startIndex: Math.max(w.startIndex, family.offset) } : w;

  const win = useMemo(() => clampStart(windowForPreset(preset)), [preset, family.offset]);
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  const stats = useMemo(
    () => computeWindowStats(family, range.startIndex, range.endIndex),
    [family, range]
  );

  // The other families in the compare set ride along as overlays.
  const companions = useMemo(
    () =>
      familyCompare
        .filter((k) => k !== family.symbol)
        .map((k) => FAMILY_BY_KEY.get(k))
        .filter((f): f is FamilyTicker => Boolean(f)),
    [familyCompare, family.symbol]
  );
  const comparing = companions.length > 0;

  // Alone: the price chart over the full window, excluded tail dimmed, same
  // as a ticker. Comparing: every line over the measured range, indexed to
  // 100 at its start, same as the family list's old chart - dollar levels
  // between families would compare start dates, not performance.
  const soloSeries = useMemo(
    () => slice(family, win.startIndex, win.endIndex),
    [family, win]
  );
  const measuredSeries = useMemo(
    () => slice(family, range.startIndex, range.endIndex),
    [family, range]
  );
  const excludeTail = Math.max(0, soloSeries.length - measuredSeries.length);

  const compareLines = useMemo(() => {
    if (!comparing) return [];
    return [family, ...companions]
      .map((f, slot) => {
        const vals = slice(f, range.startIndex, range.endIndex);
        if (vals.length < 2) return null;
        const base = vals[0];
        return {
          key: f.symbol,
          color: colors.chart[slot % colors.chart.length],
          values: vals.map((v) => (v / base) * 100),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [comparing, family, companions, range, colors]);

  // While a finger is down the headline reports the scrubbed point, so the
  // chart and the numbers never disagree. The scrub indexes the series the
  // visible chart is drawing.
  const scrubSeries = comparing ? measuredSeries : soloSeries;
  const scrubbing = scrub !== null && scrub < scrubSeries.length;
  const shownValue = scrubbing ? scrubSeries[scrub] : family.lastClose;
  const shownReturn = scrubbing
    ? scrubSeries[0] > 0
      ? scrubSeries[scrub] / scrubSeries[0] - 1
      : null
    : (stats?.totalReturn ?? null);
  const seriesStart = Math.max(
    comparing ? range.startIndex : win.startIndex,
    family.offset
  );
  const shownDate = scrubbing
    ? DATES[Math.min(seriesStart + scrub, range.endIndex)]
    : DATES[range.endIndex];

  const tone =
    shownReturn === null ? colors.flat : shownReturn >= 0 ? colors.up : colors.down;

  const table = useMemo(
    () =>
      TABLE_ROWS.map((row) => {
        const r = withSkip(clampStart(windowForPreset(row.key)), skipEnabled, sessionsStale);
        return {
          key: row.key,
          label: row.label,
          skip: r.skip,
          stats: computeWindowStats(family, r.startIndex, r.endIndex),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [family, skipEnabled, sessionsStale]
  );

  // Holdings ranked by the same window the page is set to, best first - the
  // family's own league table.
  const holdings = useMemo(() => {
    const rows = family.holdings
      .map((sym) => BY_SYMBOL.get(sym))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({
        ticker: t,
        stats: computeWindowStats(t, range.startIndex, range.endIndex),
        series: slice(t, range.startIndex, range.endIndex),
      }));
    rows.sort((a, b) => {
      const av = a.stats?.totalReturn ?? null;
      const bv = b.stats?.totalReturn ?? null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return rows;
  }, [family.holdings, range]);

  const openMember = useCallback(
    (symbol: string) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(`/ticker/${symbol}`);
    },
    [router]
  );
  const watchMember = useCallback(
    (symbol: string) => {
      const added = toggleWatch(symbol);
      Haptics.impactAsync(
        added ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
      ).catch(() => {});
    },
    [toggleWatch]
  );

  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headline}>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          Equal-weight index · {family.members} members
        </Text>
        <Text style={[type.hero, mono, { color: colors.text }]}>
          ${formatPrice(shownValue)}
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

      {comparing ? (
        <View style={styles.compareBlock}>
          <CompareChart lines={compareLines} height={220} baseline={100} onScrub={handleScrub} />
          <View style={styles.legend}>
            {compareLines.map((l) => (
              <View key={l.key} style={[styles.legendChip, { backgroundColor: colors.surface }]}>
                <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                <Text style={[type.micro, { color: colors.textMuted }]} numberOfLines={1}>
                  {l.key}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[type.micro, styles.compareNote, { color: colors.textFaint }]}>
            Indexed to 100 at the window start · tap rows on the Families list to change
            the set
          </Text>
        </View>
      ) : (
        <PriceChart values={soloSeries} onScrub={handleScrub} excludeTail={excludeTail} />
      )}

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
            <Text style={[type.micro, styles.tdLabel, { color: colors.textFaint }]}>WINDOW</Text>
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
                    <Text style={[type.micro, { color: colors.textFaint }]}>−{row.skip}d</Text>
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
          Ret ÷ σ is the annualised return over the annualised standard deviation of
          daily log returns in the same window.
          {table.some((r) => r.stats?.volFloored)
            ? ` A starred σ sits below the ${(VOL_FLOOR * 100).toFixed(1)}% floor applied` +
              ' to the divisor.'
            : ''}
        </Text>
      </View>

      {holdings.length > 0 && (
        <View style={styles.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            HOLDINGS · RANKED OVER {preset === '2Y' ? 'MAX' : preset}
          </Text>
          <View style={[styles.table, { borderColor: colors.hairline }]}>
            {holdings.map((h, i) => {
              const rt = h.stats?.totalReturn ?? null;
              const rowTone = rt === null ? colors.flat : rt >= 0 ? colors.up : colors.down;
              const watched = isWatched(h.ticker.symbol);
              return (
                <Pressable
                  key={h.ticker.symbol}
                  onPress={() => watchMember(h.ticker.symbol)}
                  onLongPress={() => openMember(h.ticker.symbol)}
                  delayLongPress={280}
                  style={({ pressed }) => [
                    styles.holdingRow,
                    {
                      borderBottomColor: colors.hairline,
                      backgroundColor: pressed ? colors.surface : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityHint="Tap to watchlist, press and hold to open"
                >
                  <Text style={[type.micro, mono, styles.holdingRank, { color: colors.textFaint }]}>
                    {i + 1}
                  </Text>
                  <View style={styles.holdingIdentity}>
                    <View style={styles.holdingSymbolRow}>
                      <Text
                        style={[type.bodyStrong, { color: watched ? colors.accent : colors.text }]}
                      >
                        {h.ticker.symbol}
                      </Text>
                      {watched && <View style={[styles.watchDot, { backgroundColor: colors.accent }]} />}
                    </View>
                    <Text style={[type.micro, { color: colors.textMuted }]} numberOfLines={1}>
                      {h.ticker.name}
                    </Text>
                  </View>
                  <Sparkline values={h.series} color={rowTone} />
                  <Text style={[type.bodyStrong, mono, styles.holdingValue, { color: rowTone }]}>
                    {formatPercent(rt, 1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[type.caption, { color: colors.textFaint, marginTop: space(2) }]}>
            Current index constituents in this family. Tap a row to watchlist it · press
            and hold to open it.
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          ABOUT
        </Text>
        <View style={[styles.facts, { backgroundColor: colors.surface }]}>
          {[
            ['Members', String(family.members)],
            ['Weighting', 'Equal, rebalanced monthly'],
            ['Membership', 'Point-in-time S&P 500 constituents'],
            ['Series since', formatDate(DATES[family.offset])],
            ['Started at', '$10,000'],
          ].map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
              <Text style={[type.caption, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
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
  compareBlock: { paddingHorizontal: space(4), gap: space(2) },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.25),
    borderRadius: radius.pill,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  compareNote: {},
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
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2.5),
    paddingHorizontal: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  holdingRank: { width: 18, textAlign: 'right' },
  holdingIdentity: { flex: 1, gap: 1 },
  holdingSymbolRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  watchDot: { width: 5, height: 5, borderRadius: 2.5 },
  holdingValue: { minWidth: 64, textAlign: 'right' },
  facts: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space(4),
    paddingVertical: space(2.5),
  },
});
