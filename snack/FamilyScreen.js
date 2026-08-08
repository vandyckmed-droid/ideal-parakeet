// Mirrors src/screens/FamilyListScreen.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The Market tab's third view: the 38 industry families as rows that behave
// like stocks. Same shared window, Skip and metric state as the card view -
// the families are ticker-shaped, so computeWindowStats, the skip and the
// residual regression all apply unchanged - and the rows are always ranked by
// the selected metric, best first. Tap toggles a family onto the comparison
// chart, the same gesture that toggles a stock onto the watchlist.

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CompareChart, SegmentedControl, Sparkline } from './ui';
import { WindowPicker } from './WindowPicker';
import { useTheme, mono, radius, space, type } from './theme';
import {
  PRESETS, computeWindowStats, formatDateShort, formatMetric, metricValue, slice, withSkip,
} from './stats';

const METRICS = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
  { key: 'residual', label: 'Residual' },
];

export function FamilyScreen({
  research, dates, win, setPreset, setCustomWindow, metric, setMetric,
  skipEnabled, setSkipEnabled, sessionsStale, headerAccessory, tab,
}) {
  const { colors, scheme, preference, setPreference } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Family series re-aligned onto the app's master calendar by date,
  // forward-filling any master session the research calendar lacks - the same
  // tolerance stage 3 applies to a missing print.
  const families = useMemo(() => {
    if (!research || !Array.isArray(research.families) || !research.familyDates) return [];
    const byDate = new Map(dates.map((d, i) => [d, i]));
    return research.families
      .map((f) => {
        const valueAt = new Map(research.familyDates.map((d, i) => [d, f.values[i]]));
        let offset = -1;
        for (let i = 0; i < dates.length; i++) {
          if (valueAt.has(dates[i])) { offset = i; break; }
        }
        if (offset < 0) return null;
        const p = new Array(dates.length - offset);
        let last = valueAt.get(dates[offset]);
        for (let i = offset; i < dates.length; i++) {
          const v = valueAt.get(dates[i]);
          if (v != null) last = v;
          p[i - offset] = last;
        }
        return { s: f.key, o: offset, p, members: f.n, mc: f.n, adv: f.n };
      })
      .filter(Boolean);
  }, [research, dates]);

  const [selected, setSelected] = useState(null);
  const selectedKeys = selected || families.slice(0, 2).map((f) => f.s);

  const toggleFamily = useCallback(
    (key) => {
      setSelected(() => {
        const prev = selectedKeys;
        if (prev.includes(key)) return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
        const next = [...prev, key];
        return next.length > 4 ? next.slice(1) : next;
      });
    },
    [selectedKeys]
  );

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale, dates.length - 1),
    [win, skipEnabled, sessionsStale, dates]
  );

  // Always ranked by the metric, best first: rank IS this view's order.
  const rows = useMemo(() => {
    const scored = families.map((f) => ({
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
  }, [families, range, metric]);

  // The chart draws the measured stretch - the same span the number covers.
  const chart = useMemo(
    () =>
      selectedKeys
        .map((key, slot) => {
          const f = families.find((x) => x.s === key);
          if (!f) return null;
          const vals = slice(f, range.startIndex, range.endIndex);
          if (vals.length < 2) return null;
          const base = vals[0];
          return {
            key,
            color: colors.chart[slot % colors.chart.length],
            // Indexed to 100 at the window start: families started their
            // $10,000 on different dates, so raw levels would compare start
            // dates, not performance.
            values: vals.map((v) => (v / base) * 100),
          };
        })
        .filter(Boolean),
    [selectedKeys, families, range, colors]
  );

  if (!families.length) {
    return (
      <View style={[s.root, s.centre, { backgroundColor: colors.bg }]}>
        <Text style={[type.title, { color: colors.text }]}>Families</Text>
        <Text style={[type.body, s.centreText, { color: colors.textMuted }]}>
          The family series hasn’t been published yet. It arrives with the next
          data update.
        </Text>
        {tab}
      </View>
    );
  }

  const renderRow = ({ item, index }) => {
    const f = item.family;
    const v = metricValue(item.stats, metric);
    const tone = v === null ? colors.flat : v >= 0 ? colors.up : colors.down;
    const slot = selectedKeys.indexOf(f.s);
    const activeHue = slot >= 0 ? colors.chart[slot % colors.chart.length] : null;
    const spark = slice(f, range.startIndex, range.endIndex);
    return (
      <Pressable
        onPress={() => toggleFamily(f.s)}
        style={({ pressed }) => [
          s.row,
          { backgroundColor: pressed ? colors.surface : 'transparent', borderBottomColor: colors.hairline },
        ]}
      >
        <Text style={[type.micro, mono, s.rank, { color: colors.textFaint }]}>{index + 1}</Text>
        <View style={[s.dot, activeHue ? { backgroundColor: activeHue } : null]} />
        <View style={s.identity}>
          <Text style={[type.bodyStrong, { color: colors.text }]} numberOfLines={1}>{f.s}</Text>
          <Text style={[type.micro, { color: colors.textMuted }]}>{f.members} members</Text>
        </View>
        <Sparkline values={spark} color={tone} />
        <Text style={[type.bodyStrong, mono, s.value, { color: tone }]}>
          {formatMetric(v, metric)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={[type.hero, { color: colors.text }]}>Market</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {families.length} families · through {formatDateShort(dates[range.endIndex])}
              {range.skip > 0 ? ` · ${range.skip}d skipped` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() =>
              setPreference(preference === 'system' ? (scheme === 'dark' ? 'light' : 'dark') : 'system')
            }
            style={[s.themeButton, { backgroundColor: colors.surface }]}
          >
            <Text style={{ fontSize: 16 }}>
              {preference === 'system' ? '◐' : scheme === 'dark' ? '☾' : '☀'}
            </Text>
          </Pressable>
        </View>

        {headerAccessory ? <View style={s.accessoryRow}>{headerAccessory}</View> : null}

        <View style={s.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl segments={PRESETS} value={win.preset} onChange={setPreset} compact />
          </View>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={[
              s.pillButton,
              {
                backgroundColor: win.preset === 'CUSTOM' ? colors.accentMuted : colors.surface,
                borderColor: win.preset === 'CUSTOM' ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text style={[type.caption, { color: win.preset === 'CUSTOM' ? colors.accent : colors.textMuted }]}>
              Custom
            </Text>
          </Pressable>
        </View>

        <View style={s.windowRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl segments={METRICS} value={metric} onChange={setMetric} compact />
          </View>
          <Pressable
            onPress={() => setSkipEnabled(!skipEnabled)}
            style={[
              s.pillButton,
              {
                backgroundColor: skipEnabled ? colors.accentMuted : colors.surface,
                borderColor: skipEnabled ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text style={[type.caption, { color: skipEnabled ? colors.accent : colors.textMuted }]}>
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
        keyExtractor={(r) => r.family.s}
        renderItem={renderRow}
        initialNumToRender={16}
        contentContainerStyle={{ paddingBottom: space(6) }}
      />

      {tab}

      <WindowPicker
        visible={pickerOpen}
        window={win}
        dates={dates}
        onClose={() => setPickerOpen(false)}
        onApply={(a, b) => {
          setCustomWindow(a, b);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', gap: space(2), padding: space(8) },
  centreText: { textAlign: 'center', maxWidth: 300 },
  header: { paddingHorizontal: space(4), paddingBottom: space(2.5), gap: space(2) },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  themeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  accessoryRow: { alignSelf: 'flex-start', width: 208 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pillButton: {
    paddingHorizontal: space(3.5), paddingVertical: space(2),
    borderRadius: radius.md, borderWidth: 1,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space(3),
    paddingHorizontal: space(4), paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 22, textAlign: 'right' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  identity: { flex: 1, gap: 1 },
  value: { minWidth: 84, textAlign: 'right' },
});
