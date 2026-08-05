import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';

import { PriceChart, SegmentedControl, haptic } from './ui';
import { useColors, mono, radius, space, type } from './theme';
import {
  PRESETS, computeWindowStats, formatBigNumber, formatDate, formatPercent,
  formatPercentPlain, formatPrice, formatRatio, slice, windowForPreset, withSkip, VOL_FLOOR,
} from './stats';

function Page({ ticker, dates, initialPreset, width, skipEnabled, sessionsStale }) {
  const colors = useColors();
  const [preset, setPreset] = useState(initialPreset === 'CUSTOM' ? '1Y' : initialPreset);
  const [scrub, setScrub] = useState(null);

  // "Max" means the most history this name has, so it clamps to the listing
  // date. The shorter presets deliberately do not: six months of a 2025 listing
  // reported under a "1Y" heading would overstate the horizon.
  const clamp = useCallback(
    (w) => (w.preset === '2Y' ? { ...w, startIndex: Math.max(w.startIndex, ticker.o) } : w),
    [ticker.o]
  );

  const win = useMemo(() => clamp(windowForPreset(preset, dates)), [preset, dates, clamp]);
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates.length]
  );

  // Drawn out to the unskipped end so the excluded tail stays visible.
  const series = useMemo(() => slice(ticker, win.startIndex, win.endIndex), [ticker, win]);
  const measuredLength = useMemo(
    () => slice(ticker, range.startIndex, range.endIndex).length,
    [ticker, range]
  );
  const excludeTail = Math.max(0, series.length - measuredLength);

  const stats = useMemo(
    () => computeWindowStats(ticker, range.startIndex, range.endIndex),
    [ticker, range]
  );

  const scrubbing = scrub !== null && scrub < series.length;
  const price = scrubbing ? series[scrub] : ticker.last;
  const ret = scrubbing
    ? series[0] > 0 ? series[scrub] / series[0] - 1 : null
    : stats ? stats.totalReturn : null;

  // First calendar index this series actually covers, so a name that listed
  // mid-window still reports the right date under the finger.
  const seriesStart = Math.max(win.startIndex, ticker.o);
  const shownDate = scrubbing ? dates[Math.min(seriesStart + scrub, win.endIndex)] : dates[win.endIndex];
  const tone = ret === null ? colors.flat : ret >= 0 ? colors.up : colors.down;

  const table = useMemo(
    () =>
      PRESETS.map((r) => {
        // Each row resolves its own skip, so 1M drops 5 days while 1Y drops 20.
        const w = withSkip(clamp(windowForPreset(r.key, dates)), skipEnabled, sessionsStale, dates.length - 1);
        return {
          key: r.key,
          label: r.label,
          skip: w.skip,
          stats: computeWindowStats(ticker, w.startIndex, w.endIndex),
        };
      }),
    [ticker, dates, clamp, skipEnabled, sessionsStale]
  );

  return (
    <ScrollView style={{ width }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.headline}>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {ticker.n}
        </Text>
        <Text style={[type.hero, mono, { color: colors.text }]}>${formatPrice(price)}</Text>
        <View style={s.changeLine}>
          <Text style={[type.bodyStrong, mono, { color: tone }]}>{formatPercent(ret)}</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {scrubbing
              ? formatDate(shownDate)
              : `over ${preset === '2Y' ? 'max' : preset}` +
                (range.skip > 0 ? ` · ex last ${range.skip}d` : '')}
          </Text>
        </View>
      </View>

      <PriceChart values={series} onScrub={setScrub} excludeTail={excludeTail} />

      <View style={s.section}>
        <SegmentedControl segments={PRESETS} value={preset} onChange={setPreset} compact />
      </View>

      <View style={s.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>PERFORMANCE BY WINDOW</Text>
        <View style={[s.table, { borderColor: colors.hairline }]}>
          <View style={[s.tr, { borderBottomColor: colors.hairline }]}>
            <Text style={[type.micro, s.tdLabel, { color: colors.textFaint }]}>WINDOW</Text>
            <Text style={[type.micro, s.td, { color: colors.textFaint }]}>RETURN</Text>
            <Text style={[type.micro, s.td, { color: colors.textFaint }]}>ANN σ</Text>
            <Text style={[type.micro, s.td, { color: colors.textFaint }]}>RET ÷ σ</Text>
          </View>
          {table.map((r) => {
            const rt = r.stats ? r.stats.totalReturn : null;
            const rowTone = rt === null ? colors.flat : rt >= 0 ? colors.up : colors.down;
            const active = r.key === preset;
            return (
              <View
                key={r.key}
                style={[
                  s.tr,
                  { borderBottomColor: colors.hairline, backgroundColor: active ? colors.surface : 'transparent' },
                ]}
              >
                <View style={s.tdLabel}>
                  <Text style={[type.bodyStrong, { color: colors.text }]}>{r.label}</Text>
                  {r.skip > 0 && <Text style={[type.micro, { color: colors.textFaint }]}>−{r.skip}d</Text>}
                </View>
                <Text style={[type.caption, mono, s.td, { color: rowTone }]}>{formatPercent(rt, 1)}</Text>
                <Text style={[type.caption, mono, s.td, { color: colors.textMuted }]}>
                  {formatPercentPlain(r.stats ? r.stats.annualizedVol : null)}
                  {r.stats && r.stats.volFloored ? '*' : ''}
                </Text>
                <Text style={[type.caption, mono, s.td, { color: colors.text }]}>
                  {formatRatio(r.stats ? r.stats.ratio : null)}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space(2) }]}>
          Ret ÷ σ is the annualised return over the annualised standard deviation of daily log returns in the same
          window.
          {range.skip > 0
            ? ' Each window stops short of the newest close by the days marked against it,' +
              ' so recent reversal is left out of the measurement.'
            : ''}
          {table.some((r) => r.stats && r.stats.volFloored)
            ? ` A starred σ sits below the ${(VOL_FLOOR * 100).toFixed(1)}% floor applied to the` +
              ' divisor, so the ratio beside it is held back from the very large value a' +
              ' near-zero σ would otherwise produce. The σ shown is the real measurement.'
            : ''}
        </Text>
      </View>

      <View style={s.section}>
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space(2) }]}>ABOUT</Text>
        <View style={[s.facts, { backgroundColor: colors.surface }]}>
          {[
            ['Sector', ticker.se],
            ['Industry', ticker.in],
            ['Exchange', ticker.x],
            ['Domicile', ticker.cy],
            ['Market cap', formatBigNumber(ticker.mc)],
            ['Median daily volume', formatBigNumber(ticker.adv)],
            ['History from', formatDate(dates[ticker.o])],
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

export function DetailScreen({ symbols, bySymbol, dates, initialSymbol, preset, skipEnabled, sessionsStale, isWatched, toggleWatch, onBack }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const initialIndex = Math.max(0, symbols.indexOf(initialSymbol));
  const [index, setIndex] = useState(initialIndex);

  const current = bySymbol.get(symbols[index]);
  const watched = current ? isWatched(current.s) : false;

  // Driven from onScroll rather than onMomentumScrollEnd: a slow drag-and-
  // release carries no momentum, so waiting for that event would leave the
  // header naming the previous ticker while a different one is on screen.
  const onScroll = useCallback(
    (e) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex((prev) => {
        if (prev === next || next < 0 || next >= symbols.length) return prev;
        haptic(() => Haptics.selectionAsync());
        return next;
      });
    },
    [width, symbols.length]
  );

  if (!current) return null;

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <View style={s.bar}>
        <Pressable onPress={onBack} hitSlop={12} style={[s.circle, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text, fontSize: 17 }}>‹</Text>
        </Pressable>
        <View style={s.barCentre}>
          <Text style={[type.heading, { color: colors.text }]}>{current.s}</Text>
          <Text style={[type.micro, { color: colors.textFaint }]}>
            {index + 1} of {symbols.length} · swipe to browse
          </Text>
        </View>
        <Pressable
          onPress={() => {
            haptic(() =>
              Haptics.impactAsync(watched ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
            );
            toggleWatch(current.s);
          }}
          hitSlop={12}
          style={[s.circle, { backgroundColor: watched ? colors.accent : colors.surface }]}
        >
          <Text style={{ color: watched ? colors.bg : colors.textMuted, fontSize: 15 }}>★</Text>
        </Pressable>
      </View>

      <FlatList
        data={symbols}
        keyExtractor={(x) => x}
        renderItem={({ item }) => (
          <Page ticker={bySymbol.get(item)} dates={dates} initialPreset={preset} width={width} skipEnabled={skipEnabled} sessionsStale={sessionsStale} />
        )}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Each page holds a chart and a full stats table, so only the
        // neighbours stay mounted.
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
    paddingHorizontal: space(4), paddingVertical: space(2),
  },
  barCentre: { alignItems: 'center', gap: 1 },
  circle: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: space(12) },
  headline: { paddingHorizontal: space(4), paddingBottom: space(4), gap: space(1) },
  changeLine: { flexDirection: 'row', alignItems: 'baseline', gap: space(2) },
  section: { paddingHorizontal: space(4), paddingTop: space(5) },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  tr: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: space(2.75),
    paddingHorizontal: space(3), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tdLabel: { width: 56, gap: 1 },
  td: { flex: 1, textAlign: 'right' },
  facts: { borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(1) },
  factRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: space(4), paddingVertical: space(2.5),
  },
});
