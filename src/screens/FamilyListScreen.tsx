import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompareChart } from '../components/CompareChart';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sparkline } from '../components/Sparkline';
import { WindowPicker } from '../components/WindowPicker';
import { FAMILY_TICKERS, FamilyTicker } from '../data/families';
import { DATES, formatDateShort, slice } from '../data/market';
import { MetricKey, computeWindowStats, formatMetric, metricValue } from '../data/stats';
import { PRESETS, PresetKey, withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { useColors, useTheme } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

const METRIC_SEGMENTS: { key: MetricKey; label: string }[] = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
  { key: 'residual', label: 'Residual' },
];

/**
 * The Market tab's third view: the 38 industry families as rows that behave
 * like stocks. Same shared window, Skip and metric state as the card view -
 * the families are Ticker-shaped, so computeWindowStats, the skip and the
 * residual regression all apply unchanged - and the rows are always ranked by
 * the selected metric, best first.
 *
 * Tap toggles a family onto the comparison chart, the same gesture that
 * toggles a stock onto the watchlist. Up to four, oldest rolls off, never
 * below one.
 */
export function FamilyListScreen({ headerAccessory }: { headerAccessory?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { preference, setPreference, scheme } = useTheme();
  const {
    window: win, setPreset, setCustomWindow, metric, setMetric,
    skipEnabled, setSkipEnabled, sessionsStale,
  } = useAppState();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() =>
    FAMILY_TICKERS.slice(0, 2).map((f) => f.symbol)
  );

  const toggleFamily = useCallback((key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      const next = [...prev, key];
      return next.length > 4 ? next.slice(1) : next;
    });
  }, []);

  // The range the maths actually uses - identical to the stock list.
  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  // Always ranked by the metric, best first: rank IS this view's order.
  const rows = useMemo(() => {
    const scored = FAMILY_TICKERS.map((f) => ({
      family: f,
      stats: computeWindowStats(f, range.startIndex, range.endIndex),
    }));
    scored.sort((a, b) => {
      const av = metricValue(a.stats, metric);
      const bv = metricValue(b.stats, metric);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return scored;
  }, [range, metric]);

  // The chart draws the measured stretch - the same span the number covers.
  const chart = useMemo(() => {
    const lines = selected
      .map((key, slot) => {
        const f = FAMILY_TICKERS.find((x) => x.symbol === key);
        if (!f) return null;
        const vals = slice(f, range.startIndex, range.endIndex);
        if (vals.length < 2) return null;
        const base = vals[0];
        return {
          key,
          color: colors.chart[slot % colors.chart.length],
          // Indexed to 100 at the window start: families started their $10,000
          // on different dates, so raw levels would compare start dates, not
          // performance.
          values: vals.map((v) => (v / base) * 100),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    return lines;
  }, [selected, range, colors]);

  const slotOf = (key: string) => selected.indexOf(key);

  const renderRow = ({ item, index }: { item: (typeof rows)[number]; index: number }) => {
    const f = item.family;
    const v = metricValue(item.stats, metric);
    const tone = v === null ? colors.flat : v >= 0 ? colors.up : colors.down;
    const slot = slotOf(f.symbol);
    const activeHue = slot >= 0 ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(f, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => toggleFamily(f.symbol)}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: pressed ? colors.surface : 'transparent',
            borderBottomColor: colors.hairline,
          },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: slot >= 0 }}
        accessibilityHint="Tap to toggle this family on the comparison chart"
      >
        <Text style={[type.micro, mono, styles.rank, { color: colors.textFaint }]}>
          {index + 1}
        </Text>
        {activeHue ? (
          <View style={[styles.dot, { backgroundColor: activeHue }]} />
        ) : (
          <View style={styles.dot} />
        )}
        <View style={styles.identity}>
          <Text style={[type.bodyStrong, { color: colors.text }]} numberOfLines={1}>
            {f.symbol}
          </Text>
          <Text style={[type.micro, { color: colors.textMuted }]}>{f.members} members</Text>
        </View>
        <Sparkline values={spark} color={tone} />
        <Text style={[type.bodyStrong, mono, styles.value, { color: tone }]}>
          {formatMetric(v, metric)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[type.hero, { color: colors.text }]}>Market</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {FAMILY_TICKERS.length} families · through {formatDateShort(DATES[range.endIndex])}
              {range.skip > 0 ? ` · ${range.skip}d skipped` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() =>
              setPreference(
                preference === 'system' ? (scheme === 'dark' ? 'light' : 'dark') : 'system'
              )
            }
            style={[styles.themeButton, { backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={`Theme: ${preference}`}
          >
            <Text style={{ fontSize: 16 }}>
              {preference === 'system' ? '◐' : scheme === 'dark' ? '☾' : '☀'}
            </Text>
          </Pressable>
        </View>

        {headerAccessory ? <View style={styles.accessoryRow}>{headerAccessory}</View> : null}

        <View style={styles.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl<PresetKey>
              segments={PRESETS}
              value={win.preset}
              onChange={setPreset}
              compact
            />
          </View>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={[
              styles.pillButton,
              {
                backgroundColor: win.preset === 'CUSTOM' ? colors.accentMuted : colors.surface,
                borderColor: win.preset === 'CUSTOM' ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                type.caption,
                { color: win.preset === 'CUSTOM' ? colors.accent : colors.textMuted },
              ]}
            >
              Custom
            </Text>
          </Pressable>
        </View>

        <View style={styles.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl<MetricKey>
              segments={METRIC_SEGMENTS}
              value={metric}
              onChange={setMetric}
              compact
            />
          </View>
          <Pressable
            onPress={() => setSkipEnabled(!skipEnabled)}
            style={[
              styles.pillButton,
              {
                backgroundColor: skipEnabled ? colors.accentMuted : colors.surface,
                borderColor: skipEnabled ? colors.accent : 'transparent',
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: skipEnabled }}
          >
            <Text
              style={[type.caption, { color: skipEnabled ? colors.accent : colors.textMuted }]}
            >
              {skipEnabled ? `Skip ${range.skip}d` : 'Skip'}
            </Text>
          </Pressable>
        </View>

        <CompareChart lines={chart} height={160} baseline={100} />
        <Text style={[type.micro, { color: colors.textFaint }]}>
          Tap a family to chart it · up to four, oldest rolls off · indexed to 100 at the
          window start
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.family.symbol}
        renderItem={renderRow}
        initialNumToRender={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + space(6) }}
      />

      <WindowPicker
        visible={pickerOpen}
        window={win}
        onClose={() => setPickerOpen(false)}
        onApply={(a, b) => {
          setCustomWindow(a, b);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: space(4), paddingBottom: space(2.5), gap: space(2) },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  themeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessoryRow: { alignSelf: 'flex-start', width: 208 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pillButton: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
    borderRadius: radius.md,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 22, textAlign: 'right' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  identity: { flex: 1, gap: 1 },
  value: { minWidth: 84, textAlign: 'right' },
});
