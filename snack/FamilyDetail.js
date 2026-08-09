// Mirrors src/screens/FamilyDetail.tsx and app/family/[key].tsx - if these
// ever disagree, the .tsx files are the ones that are wrong.
//
// One family, laid out exactly like one ticker - deliberately. The headline
// is the index's dollar value with the window return under it, the chart
// scrubs with the figures following the finger, and every window's numbers
// sit in the same table in the same order.
//
// Two things a ticker page cannot have: companions (the compare set rides
// along as overlays, indexed to 100 at the window start) and holdings (a
// family is a small ETF, so it lists its current constituents, ranked over
// the same window the page is set to, with the app's one gesture pair).

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { CompareChart, PriceChart, SegmentedControl, Sparkline, haptic } from './ui';
import { useTheme, useColors, mono, radius, space, type } from './theme';
import {
  PRESETS, VOL_FLOOR, computeWindowStats, formatDate, formatPercent,
  formatPercentPlain, formatPrice, formatRatio, slice, windowForPreset, withSkip,
} from './stats';

function Page({
  family, byKey, bySymbol, dates, initialPreset, width, skipEnabled, sessionsStale,
  familyCompare, isWatched, toggleWatch, onOpenTicker, onScrubbingChange,
}) {
  const { colors } = useTheme();
  const [preset, setPreset] = useState(initialPreset === 'CUSTOM' ? '1Y' : initialPreset);
  const [scrub, setScrub] = useState(null);

  const handleScrub = useCallback(
    (i) => {
      setScrub(i);
      if (onScrubbingChange) onScrubbingChange(i !== null);
    },
    [onScrubbingChange]
  );

  // "Max" clamps to the series start, same as a late-listing ticker.
  const clamp = useCallback(
    (w) => (w.preset === '2Y' ? { ...w, startIndex: Math.max(w.startIndex, family.o) } : w),
    [family.o]
  );

  const win = useMemo(() => clamp(windowForPreset(preset, dates)), [preset, dates, clamp]);
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  const stats = useMemo(
    () => computeWindowStats(family, range.startIndex, range.endIndex),
    [family, range]
  );

  // The other families in the compare set ride along as overlays.
  const companions = useMemo(
    () =>
      familyCompare
        .filter((k) => k !== family.s)
        .map((k) => byKey.get(k))
        .filter(Boolean),
    [familyCompare, family.s, byKey]
  );
  const comparing = companions.length > 0;

  const soloSeries = useMemo(() => slice(family, win.startIndex, win.endIndex), [family, win]);
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
          key: f.s,
          color: colors.chart[slot % colors.chart.length],
          values: vals.map((v) => (v / base) * 100),
        };
      })
      .filter(Boolean);
  }, [comparing, family, companions, range, colors]);

  // While a finger is down the headline reports the scrubbed point, so the
  // chart and the numbers never disagree.
  const scrubSeries = comparing ? measuredSeries : soloSeries;
  const scrubbing = scrub !== null && scrub < scrubSeries.length;
  const last = family.p[family.p.length - 1];
  const shownValue = scrubbing ? scrubSeries[scrub] : last;
  const shownReturn = scrubbing
    ? scrubSeries[0] > 0
      ? scrubSeries[scrub] / scrubSeries[0] - 1
      : null
    : stats
      ? stats.totalReturn
      : null;
  const seriesStart = Math.max(comparing ? range.startIndex : win.startIndex, family.o);
  const shownDate = scrubbing
    ? dates[Math.min(seriesStart + scrub, range.endIndex)]
    : dates[range.endIndex];

  const tone = shownReturn === null ? colors.flat : shownReturn >= 0 ? colors.up : colors.down;

  const table = useMemo(
    () =>
      PRESETS.map((row) => {
        const r = withSkip(
          clamp(windowForPreset(row.key, dates)),
          skipEnabled,
          sessionsStale,
          dates.length - 1
        );
        return {
          key: row.key,
          label: row.label,
          skip: r.skip,
          stats: computeWindowStats(family, r.startIndex, r.endIndex),
        };
      }),
    [family, dates, skipEnabled, sessionsStale, clamp]
  );

  // Holdings ranked by the same window the page is set to, best first.
  const holdings = useMemo(() => {
    const rows = (family.holdings || [])
      .map((sym) => bySymbol.get(sym))
      .filter(Boolean)
      .map((t) => ({
        ticker: t,
        stats: computeWindowStats(t, range.startIndex, range.endIndex),
        series: slice(t, range.startIndex, range.endIndex),
      }));
    rows.sort((a, b) => {
      const av = a.stats ? a.stats.totalReturn : null;
      const bv = b.stats ? b.stats.totalReturn : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return rows;
  }, [family.holdings, bySymbol, range]);

  return (
    <ScrollView style={{ width }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.headline}>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          Equal-weight index · {family.members} members
        </Text>
        <Text style={[type.hero, mono, { color: colors.text }]}>${formatPrice(shownValue)}</Text>
        <View style={s.changeLine}>
          <Text style={[type.bodyStrong, mono, { color: tone }]}>{formatPercent(shownReturn)}</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {scrubbing
              ? formatDate(shownDate)
              : `over ${preset === '2Y' ? 'max' : preset}` +
                (range.skip > 0 ? ` · ex last ${range.skip}d` : '')}
          </Text>
        </View>
      </View>

      {comparing ? (
        <View style={s.compareBlock}>
          <CompareChart lines={compareLines} height={220} baseline={100} onScrub={handleScrub} />
          <View style={s.legend}>
            {compareLines.map((l) => (
              <View key={l.key} style={[s.legendChip, { backgroundColor: colors.surface }]}>
                <View style={[s.legendDot, { backgroundColor: l.color }]} />
                <Text style={[type.micro, { color: colors.textMuted }]} numberOfLines={1}>
                  {l.key}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[type.micro, { color: colors.textFaint }]}>
            Indexed to 100 at the window start · tap rows on the Families list to change
            the set
          </Text>
        </View>
      ) : (
        <PriceChart values={soloSeries} onScrub={handleScrub} excludeTail={excludeTail} />
      )}

      <View style={s.section}>
        <SegmentedControl segments={PRESETS} value={preset} onChange={setPreset} compact />
      </View>

      <View style={s.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
          PERFORMANCE BY WINDOW
        </Text>
        <View style={[s.table, { borderColor: colors.hairline }]}>
          <View style={[s.tr, { borderBottomColor: colors.hairline }]}>
            <Text style={[type.micro, s.tdLabel, { color: colors.textFaint }]}>WINDOW</Text>
            <Text style={[type.micro, s.td, { color: colors.textFaint }]}>RETURN</Text>
            <Text style={[type.micro, s.td, { color: colors.textFaint }]}>ANN σ</Text>
            <Text style={[type.micro, s.td, { color: colors.textFaint }]}>RET ÷ σ</Text>
          </View>
          {table.map((row) => {
            const rt = row.stats ? row.stats.totalReturn : null;
            const rowTone = rt === null ? colors.flat : rt >= 0 ? colors.up : colors.down;
            const active = row.key === preset;
            return (
              <View
                key={row.key}
                style={[
                  s.tr,
                  {
                    borderBottomColor: colors.hairline,
                    backgroundColor: active ? colors.surface : 'transparent',
                  },
                ]}
              >
                <View style={s.tdLabel}>
                  <Text style={[type.bodyStrong, { color: colors.text }]}>{row.label}</Text>
                  {row.skip > 0 && (
                    <Text style={[type.micro, { color: colors.textFaint }]}>−{row.skip}d</Text>
                  )}
                </View>
                <Text style={[type.caption, mono, s.td, { color: rowTone }]}>
                  {formatPercent(rt, 1)}
                </Text>
                <Text style={[type.caption, mono, s.td, { color: colors.textMuted }]}>
                  {formatPercentPlain(row.stats ? row.stats.annualizedVol : null)}
                  {row.stats && row.stats.volFloored ? '*' : ''}
                </Text>
                <Text style={[type.caption, mono, s.td, { color: colors.text }]}>
                  {formatRatio(row.stats ? row.stats.ratio : null)}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(2) }]}>
          Ret ÷ σ is the annualised return over the annualised standard deviation of
          daily log returns in the same window.
          {table.some((r) => r.stats && r.stats.volFloored)
            ? ` A starred σ sits below the ${(VOL_FLOOR * 100).toFixed(1)}% floor applied` +
              ' to the divisor.'
            : ''}
        </Text>
      </View>

      {holdings.length > 0 && (
        <View style={s.section}>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>
            HOLDINGS · RANKED OVER {preset === '2Y' ? 'MAX' : preset}
          </Text>
          <View style={[s.table, { borderColor: colors.hairline }]}>
            {holdings.map((h, i) => {
              const rt = h.stats ? h.stats.totalReturn : null;
              const rowTone = rt === null ? colors.flat : rt >= 0 ? colors.up : colors.down;
              const watched = isWatched(h.ticker.s);
              return (
                <Pressable
                  key={h.ticker.s}
                  onPress={() => {
                    const adding = !watched;
                    haptic(() =>
                      Haptics.impactAsync(
                        adding ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
                      )
                    );
                    toggleWatch(h.ticker.s);
                  }}
                  onLongPress={() => {
                    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
                    onOpenTicker(h.ticker.s);
                  }}
                  delayLongPress={280}
                  style={({ pressed }) => [
                    s.holdingRow,
                    {
                      borderBottomColor: colors.hairline,
                      backgroundColor: pressed ? colors.surface : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityHint="Tap to watchlist, press and hold to open"
                >
                  <Text style={[type.micro, mono, s.holdingRank, { color: colors.textFaint }]}>
                    {i + 1}
                  </Text>
                  <View style={s.holdingIdentity}>
                    <View style={s.holdingSymbolRow}>
                      <Text style={[type.bodyStrong, { color: watched ? colors.accent : colors.text }]}>
                        {h.ticker.s}
                      </Text>
                      {watched && <View style={[s.watchDot, { backgroundColor: colors.accent }]} />}
                    </View>
                    <Text style={[type.micro, { color: colors.textMuted }]} numberOfLines={1}>
                      {h.ticker.n}
                    </Text>
                  </View>
                  <Sparkline values={h.series} color={rowTone} />
                  <Text style={[type.bodyStrong, mono, s.holdingValue, { color: rowTone }]}>
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

      <View style={s.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>ABOUT</Text>
        <View style={[s.facts, { backgroundColor: colors.surface }]}>
          {[
            ['Members', String(family.members)],
            ['Weighting', 'Equal, rebalanced monthly'],
            ['Membership', 'Point-in-time S&P 500 constituents'],
            ['Series since', formatDate(dates[family.o])],
            ['Started at', '$10,000'],
          ].map(([label, value]) => (
            <View key={label} style={s.factRow}>
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

export function FamilyDetailScreen({
  families, bySymbol, dates, initialKey, order, preset, skipEnabled, sessionsStale,
  familyCompare, toggleFamilyCompare, isWatched, toggleWatch, onOpenTicker, onBack,
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();

  const byKey = useMemo(() => new Map(families.map((f) => [f.s, f])), [families]);
  const keys = useMemo(() => {
    const usable = (order || []).filter((k) => byKey.has(k));
    return usable.length ? usable : families.map((f) => f.s);
  }, [order, byKey, families]);

  const initialIndex = Math.max(0, keys.indexOf(initialKey));
  const [index, setIndex] = useState(initialIndex);
  const [scrubbing, setScrubbing] = useState(false);

  const current = byKey.get(keys[index]);
  const compared = current ? familyCompare.includes(current.s) : false;

  const onScroll = useCallback(
    (e) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex((prev) => {
        if (prev === next || next < 0 || next >= keys.length) return prev;
        haptic(() => Haptics.selectionAsync());
        return next;
      });
    },
    [width, keys.length]
  );

  if (!current) return null;

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <View style={s.bar}>
        <Pressable onPress={onBack} hitSlop={12} style={[s.circle, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text, fontSize: 17 }}>‹</Text>
        </Pressable>
        <View style={s.barCentre}>
          <Text style={[type.heading, { color: colors.text }]} numberOfLines={1}>
            {current.s}
          </Text>
          <Text style={[type.micro, { color: colors.textFaint }]}>
            {index + 1} of {keys.length} · swipe to browse
          </Text>
        </View>
        <Pressable
          onPress={() => {
            const adding = !compared;
            haptic(() =>
              Haptics.impactAsync(
                adding ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
              )
            );
            toggleFamilyCompare(current.s);
          }}
          hitSlop={12}
          style={[s.circle, { backgroundColor: compared ? colors.accent : colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel={compared ? 'Remove from compare set' : 'Add to compare set'}
        >
          <Text style={{ color: compared ? colors.bg : colors.textMuted, fontSize: 15 }}>◉</Text>
        </Pressable>
      </View>

      <FlatList
        data={keys}
        keyExtractor={(x) => x}
        renderItem={({ item }) => (
          <Page
            family={byKey.get(item)}
            byKey={byKey}
            bySymbol={bySymbol}
            dates={dates}
            initialPreset={preset}
            width={width}
            skipEnabled={skipEnabled}
            sessionsStale={sessionsStale}
            familyCompare={familyCompare}
            isWatched={isWatched}
            toggleWatch={toggleWatch}
            onOpenTicker={onOpenTicker}
            onScrubbingChange={setScrubbing}
          />
        )}
        horizontal
        pagingEnabled
        scrollEnabled={!scrubbing}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={onScroll}
        scrollEventThrottle={16}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space(4), paddingVertical: space(2), gap: space(2),
  },
  barCentre: { alignItems: 'center', gap: 1, flexShrink: 1 },
  circle: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: space(12) },
  headline: { paddingHorizontal: space(4), paddingBottom: space(4), gap: space(1) },
  changeLine: { flexDirection: 'row', alignItems: 'baseline', gap: space(2) },
  compareBlock: { paddingHorizontal: space(4), gap: space(2) },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  legendChip: {
    flexDirection: 'row', alignItems: 'center', gap: space(1.5),
    paddingHorizontal: space(2.5), paddingVertical: space(1.25), borderRadius: radius.pill,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  section: { paddingHorizontal: space(4), paddingTop: space(5) },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  tr: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: space(2.75),
    paddingHorizontal: space(3), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tdLabel: { width: 56, gap: 1 },
  td: { flex: 1, textAlign: 'right' },
  holdingRow: {
    flexDirection: 'row', alignItems: 'center', gap: space(3),
    paddingVertical: space(2.5), paddingHorizontal: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  holdingRank: { width: 18, textAlign: 'right' },
  holdingIdentity: { flex: 1, gap: 1 },
  holdingSymbolRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  watchDot: { width: 5, height: 5, borderRadius: 2.5 },
  holdingValue: { minWidth: 64, textAlign: 'right' },
  facts: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  factRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: space(4), paddingVertical: space(2.5),
  },
});
