import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CompareChart } from '../components/CompareChart';
import { PriceChart } from '../components/PriceChart';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sparkline } from '../components/Sparkline';
import { GROUPING_META, GroupTicker, groupByMedoid, groupsForK } from '../data/groups';
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
 * One correlation group, laid out exactly like one ticker - deliberately. The
 * headline is the index level with the window return under it, the chart
 * scrubs with the figures following the finger, and every window's numbers sit
 * in the same table in the same order. A group is Ticker-shaped in the data
 * layer, and this screen is where that pays off for the eyes.
 *
 * Two things a ticker page cannot have:
 *
 * - **Companions.** When the compare set holds other groups, the chart
 *   switches to the shared-axis comparison, indexed to 100 at the window
 *   start.
 *
 * - **Members, ranked by fit.** Not by return: the group is a correlation
 *   object, so the ordering that explains it is how tightly each name moves
 *   with the rest. The ones at the bottom are the ones the balance constraint
 *   had to squeeze in somewhere, and they say where they would rather be.
 */
export function GroupDetail({
  group,
  initialPreset,
  width,
  skipEnabled,
  sessionsStale,
  onScrubbingChange,
}: {
  group: GroupTicker;
  initialPreset: PresetKey;
  width: number;
  skipEnabled: boolean;
  sessionsStale: number;
  onScrubbingChange?: (active: boolean) => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const { familyCompare, familySlots, groupCount, isWatched, toggleWatch } = useAppState();
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

  const clampStart = (w: ReturnType<typeof windowForPreset>) =>
    w.preset === '2Y' ? { ...w, startIndex: Math.max(w.startIndex, group.offset) } : w;

  const win = useMemo(() => clampStart(windowForPreset(preset)), [preset, group.offset]);
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  const stats = useMemo(
    () => computeWindowStats(group, range.startIndex, range.endIndex),
    [group, range]
  );

  const companions = useMemo(
    () =>
      familyCompare
        .filter((k) => k !== group.medoid)
        .map((k) => groupByMedoid(k, groupCount))
        .filter((g): g is GroupTicker => Boolean(g)),
    [familyCompare, group.medoid, groupCount]
  );
  const comparing = companions.length > 0;

  const soloSeries = useMemo(
    () => slice(group, win.startIndex, win.endIndex),
    [group, win]
  );
  const measuredSeries = useMemo(
    () => slice(group, range.startIndex, range.endIndex),
    [group, range]
  );
  const excludeTail = Math.max(0, soloSeries.length - measuredSeries.length);

  const compareLines = useMemo(() => {
    if (!comparing) return [];
    return [group, ...companions]
      .map((g) => {
        const vals = slice(g, range.startIndex, range.endIndex);
        if (vals.length < 2) return null;
        const base = vals[0];
        const slot = familySlots[g.medoid];
        return {
          key: g.medoid,
          color: slot != null ? colors.chart[slot % colors.chart.length] : colors.text,
          values: vals.map((v) => (v / base) * 100),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [comparing, group, companions, range, colors, familySlots]);

  const scrubSeries = comparing ? measuredSeries : soloSeries;
  const scrubbing = scrub !== null && scrub < scrubSeries.length;
  const shownValue = scrubbing ? scrubSeries[scrub] : group.lastClose;
  const shownReturn = scrubbing
    ? scrubSeries[0] > 0
      ? scrubSeries[scrub] / scrubSeries[0] - 1
      : null
    : (stats?.totalReturn ?? null);
  const seriesStart = Math.max(
    comparing ? range.startIndex : win.startIndex,
    group.offset
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
          stats: computeWindowStats(group, r.startIndex, r.endIndex),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, skipEnabled, sessionsStale]
  );

  // Members in the order the algorithm ranks them: tightest fit with the rest
  // of the group first. The window return rides along because it is what the
  // rest of the app is about, but it is not what orders this list.
  const members = useMemo(
    () =>
      group.members.map((sym, i) => {
        const t = BY_SYMBOL.get(sym);
        return {
          symbol: sym,
          ticker: t,
          fit: group.fit[i],
          weak: group.weak[i],
          prefers: group.prefers[i],
          stats: t ? computeWindowStats(t, range.startIndex, range.endIndex) : null,
          series: t ? slice(t, range.startIndex, range.endIndex) : [],
        };
      }),
    [group, range]
  );

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

  const weakCount = group.weak.filter(Boolean).length;
  const set = groupsForK(groupCount);

  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headline}>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          Equal-weight index · {group.members.length} members · ρ {group.cohesion.toFixed(2)}
        </Text>
        <Text style={[type.hero, mono, { color: colors.text }]}>
          {formatPrice(shownValue)}
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
          <Text style={[type.micro, { color: colors.textFaint }]}>
            Indexed to 100 at the window start · tap rows on the Groups list to change the set
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
      </View>

      <View style={styles.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          MEMBERS · BEST FIT FIRST
        </Text>
        <View style={[styles.table, { borderColor: colors.hairline }]}>
          {members.map((m, i) => {
            const rt = m.stats?.totalReturn ?? null;
            const rowTone = rt === null ? colors.flat : rt >= 0 ? colors.up : colors.down;
            const watched = isWatched(m.symbol);
            return (
              <Pressable
                key={m.symbol}
                onPress={() => watchMember(m.symbol)}
                onLongPress={() => openMember(m.symbol)}
                delayLongPress={280}
                style={({ pressed }) => [
                  styles.memberRow,
                  {
                    borderBottomColor: colors.hairline,
                    backgroundColor: pressed ? colors.surface : 'transparent',
                  },
                ]}
                accessibilityRole="button"
                accessibilityHint="Tap to watchlist, press and hold to open"
              >
                <Text style={[type.micro, mono, styles.memberRank, { color: colors.textFaint }]}>
                  {i + 1}
                </Text>
                <View style={styles.memberIdentity}>
                  <View style={styles.memberSymbolRow}>
                    <Text
                      style={[type.bodyStrong, { color: watched ? colors.accent : colors.text }]}
                    >
                      {m.symbol}
                    </Text>
                    {m.symbol === group.medoid && (
                      <Text style={[type.micro, { color: colors.accent }]}>medoid</Text>
                    )}
                    {watched && <View style={[styles.watchDot, { backgroundColor: colors.accent }]} />}
                  </View>
                  <Text style={[type.micro, { color: colors.textMuted }]} numberOfLines={1}>
                    ρ {m.fit.toFixed(2)}
                    {m.weak && m.prefers ? ` · closer to ${m.prefers}` : ''}
                    {m.ticker ? ` · ${m.ticker.name}` : ''}
                  </Text>
                </View>
                <Sparkline values={m.series} color={rowTone} />
                <Text style={[type.bodyStrong, mono, styles.memberValue, { color: rowTone }]}>
                  {formatPercent(rt, 1)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(2) }]}>
          ρ is the member’s average correlation with the rest of the group. Ordered by
          that, not by return.
          {weakCount > 0
            ? ` ${weakCount} ${weakCount === 1 ? 'name sits' : 'names sit'} closer to another` +
              ' group than to this one — the price of holding every group to the same size.'
            : ''}{' '}
          Tap a row to watchlist it · press and hold to open it.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          ABOUT
        </Text>
        <View style={[styles.facts, { backgroundColor: colors.surface }]}>
          {[
            ['Representative', `${group.medoid} (closest to all members)`],
            ['Members', `${group.members.length} of ${set.lower}–${set.upper} allowed`],
            ['Mean correlation', group.cohesion.toFixed(3)],
            ['Mostly', `${group.dominantSector || 'mixed'} · ${Math.round(group.dominantShare * 100)}%`],
            ['Weighting', 'Equal, rebalanced daily'],
            ['Correlation window', `${GROUPING_META.sessions} sessions to ${GROUPING_META.to}`],
            ['Shrinkage', `${GROUPING_META.shrinkage.toFixed(3)} toward mean ρ ${GROUPING_META.averageCorrelation.toFixed(2)}`],
            ['Series since', formatDate(DATES[group.offset])],
          ].map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
              <Text style={[type.caption, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
                {value}
              </Text>
            </View>
          ))}
        </View>
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(2) }]}>
          Sector is a label, never an input: the grouping sees only how these names
          moved together.
        </Text>
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
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2.5),
    paddingHorizontal: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberRank: { width: 18, textAlign: 'right' },
  memberIdentity: { flex: 1, gap: 1 },
  memberSymbolRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  watchDot: { width: 5, height: 5, borderRadius: 2.5 },
  memberValue: { minWidth: 64, textAlign: 'right' },
  facts: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space(4),
    paddingVertical: space(2.5),
  },
});
