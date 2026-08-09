// Mirrors src/components/ListHeader.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The one header every list screen wears: title and caption, theme button,
// search beside whatever accessory the screen provides, the shared window and
// metric rows, and a chip rail.
//
// This component exists so the chrome cannot drift. The Market tab's three
// views and the Watchlist all render this exact stack, so switching views
// changes what the rows say - never where the controls sit. View-specific
// controls (the rank table's column headers, the family view's comparison
// chart) belong to the body below, where appearing and disappearing with the
// view is the point rather than a glitch.

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SegmentedControl } from './ui';
import { useTheme, mono, radius, space, type } from './theme';
import { PRESETS, hasMarket, combineMetric, metricRatioOn, metricResidualOn } from './stats';

export function ListHeader({
  title, caption, query, onQuery, searchPlaceholder, accessory,
  win, onPreset, onOpenPicker, metric, onMetric, skipEnabled, onToggleSkip,
  range, sessionsStale, dates, sector, sectors, onOpenSectorPicker,
}) {
  const { colors, scheme, preference, setPreference } = useTheme();

  return (
    <View style={s.header}>
      <View style={s.headerTop}>
        <View style={{ flex: 1 }}>
          <Text style={[type.hero, { color: colors.text }]}>{title}</Text>
          {caption ? (
            <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() =>
            setPreference(preference === 'system' ? (scheme === 'dark' ? 'light' : 'dark') : 'system')
          }
          style={[s.themeButton, { backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel={`Theme: ${preference}`}
        >
          <Text style={{ fontSize: 16 }}>
            {preference === 'system' ? '◐' : scheme === 'dark' ? '☾' : '☀'}
          </Text>
        </Pressable>
      </View>

      {/* Search and the accessory share a row: both are "what am I looking at"
          controls, and stacking them cost a full row of chrome before the
          first piece of data. */}
      <View style={s.searchRow}>
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder={searchPlaceholder || 'Search symbol or company'}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[s.search, type.body, { backgroundColor: colors.surface, color: colors.text }]}
        />
        {accessory ? <View style={s.accessory}>{accessory}</View> : null}
      </View>

      <View style={s.controlRow}>
        <View style={{ flex: 1 }}>
          <SegmentedControl segments={PRESETS} value={win.preset} onChange={onPreset} compact />
        </View>
        <Pressable
          onPress={onOpenPicker}
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

      {/*
        Return ÷ σ and Residual are two independent questions - risk-adjust,
        and strip the market out - not three points on one dial. A segmented
        control forced them into mutually exclusive options and had no way to
        say "both": Return was really just "neither toggle is on," and
        risk-adjusted-residual (an information-ratio-style figure - residual
        return over the residual's OWN sigma) had no seat at the table at
        all. Two toggle pills say exactly what they mean and combine freely;
        Skip joins them since all three are the same kind of control - a
        modifier, not a mode.

        Residual (and so residualRatio) drops out entirely when the loaded
        dataset has no market reference - a payload from before the field
        existed, every value would be a dash. hasMarket() is read per render,
        not at module scope, since the module loads before the data arrives.
      */}
      <View style={s.controlRow}>
        <Pressable
          onPress={() => onMetric(combineMetric(!metricRatioOn(metric), metricResidualOn(metric)))}
          style={[
            s.pillButton,
            {
              backgroundColor: metricRatioOn(metric) ? colors.accentMuted : colors.surface,
              borderColor: metricRatioOn(metric) ? colors.accent : 'transparent',
            },
          ]}
          accessibilityRole="switch"
          accessibilityState={{ checked: metricRatioOn(metric) }}
          accessibilityLabel="Risk-adjust: divide return by its volatility"
        >
          <Text style={[type.caption, { color: metricRatioOn(metric) ? colors.accent : colors.textMuted }]}>
            Return ÷ σ
          </Text>
        </Pressable>
        {hasMarket() && (
          <Pressable
            onPress={() => onMetric(combineMetric(metricRatioOn(metric), !metricResidualOn(metric)))}
            style={[
              s.pillButton,
              {
                backgroundColor: metricResidualOn(metric) ? colors.accentMuted : colors.surface,
                borderColor: metricResidualOn(metric) ? colors.accent : 'transparent',
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: metricResidualOn(metric) }}
            accessibilityLabel="Strip out the market's contribution first"
          >
            <Text style={[type.caption, { color: metricResidualOn(metric) ? colors.accent : colors.textMuted }]}>
              Residual
            </Text>
          </Pressable>
        )}
        {/* Always the bare word: the number of sessions dropped varies by view
            (the rank table skips per horizon) and lives in the caption, so the
            pill cannot change width as views change. */}
        <Pressable
          onPress={onToggleSkip}
          style={[
            s.pillButton,
            {
              backgroundColor: skipEnabled ? colors.accentMuted : colors.surface,
              borderColor: skipEnabled ? colors.accent : 'transparent',
            },
          ]}
          accessibilityRole="switch"
          accessibilityState={{ checked: skipEnabled }}
          accessibilityLabel={
            skipEnabled
              ? 'Skipping the most recent trading days'
              : 'Include the most recent trading days'
          }
        >
          <Text style={[type.caption, { color: skipEnabled ? colors.accent : colors.textMuted }]}>
            Skip
          </Text>
        </Pressable>
      </View>

      {(win.preset === 'CUSTOM' || range.skip > 0) && (
        <Text style={[type.caption, mono, { color: colors.textMuted }]}>
          {dates[range.startIndex]} → {dates[range.endIndex]}
          {range.shortfall > 0
            ? `  ·  ${range.shortfall}d short`
            : sessionsStale > 0 && range.skip > 0
              ? `  ·  data ${sessionsStale}d behind`
              : ''}
        </Text>
      )}

      {sectors.length > 0 && (
        <Pressable
          onPress={onOpenSectorPicker}
          style={[
            s.sectorButton,
            { backgroundColor: colors.surface, borderColor: sector ? colors.accent : 'transparent' },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Sector filter: ${sector || 'All sectors'}`}
        >
          <Text style={[type.caption, { color: sector ? colors.accent : colors.textMuted }]} numberOfLines={1}>
            {sector || 'All sectors'}
          </Text>
          <Text style={[type.caption, { color: sector ? colors.accent : colors.textFaint }]}>▾</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: space(4), paddingBottom: space(2.5), gap: space(2) },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  themeButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: space(2) },
  // minWidth 0: otherwise the placeholder's width is the field's minimum and
  // the accessory gets shoved off the right edge.
  search: { flex: 1, minWidth: 0, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(2.75) },
  // Wide enough for Card / Table / Families without wrapping, no wider - the
  // search field keeps the rest.
  accessory: { width: 208, justifyContent: 'center' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pillButton: { paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.md, borderWidth: 1 },
  // Self-sized and left-aligned, not full width: this is a filter reading
  // "here's what's active, tap to change it," not a control that deserves
  // equal billing with the window and metric rows above it.
  sectorButton: {
    flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: space(1.5),
    maxWidth: '100%', paddingHorizontal: space(3.5), paddingVertical: space(2),
    borderRadius: radius.pill, borderWidth: 1,
  },
});
