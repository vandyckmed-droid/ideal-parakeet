import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SegmentedControl } from './SegmentedControl';
import { DATES } from '../data/market';
import { MetricKey, combineMetric, metricRatioOn, metricResidualOn } from '../data/stats';
import { DateWindow, EffectiveWindow, PRESETS, PresetKey } from '../data/windows';
import { useTheme } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

/**
 * The one header every list screen wears: title and caption, theme button,
 * search beside whatever accessory the screen provides, the shared window and
 * metric rows, and a chip rail.
 *
 * This component exists so the chrome cannot drift. The Market tab's three
 * views and the Watchlist all render this exact stack, so switching views
 * changes what the rows say - never where the controls sit. Every earlier
 * version of this app proved the alternative: three hand-built headers that
 * each placed the same controls a little differently, and a view switch that
 * hopped around the screen as you used it.
 *
 * View-specific controls (the rank table's column headers, the family view's
 * comparison chart) belong to the body below, where appearing and disappearing
 * with the view is the point rather than a glitch.
 */
export function ListHeader({
  title,
  caption,
  query,
  onQuery,
  searchPlaceholder,
  accessory,
  win,
  onPreset,
  onOpenPicker,
  metric,
  onMetric,
  skipEnabled,
  onToggleSkip,
  range,
  sessionsStale,
  sector,
  sectors,
  onOpenSectorPicker,
}: {
  title: string;
  /** One line under the title. Omit for none (the Watchlist's choice). */
  caption?: string;
  query: string;
  onQuery: (q: string) => void;
  searchPlaceholder?: string;
  /** Rendered beside the search box - the Market tab's view switch. */
  accessory?: React.ReactNode;
  win: DateWindow;
  onPreset: (p: PresetKey) => void;
  onOpenPicker: () => void;
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
  skipEnabled: boolean;
  onToggleSkip: () => void;
  range: EffectiveWindow;
  sessionsStale: number;
  /** null means "All sectors". */
  sector: string | null;
  /** Omit or pass an empty list to hide the sector row entirely (the family view has none). */
  sectors: string[];
  onOpenSectorPicker: () => void;
}) {
  const { colors, scheme, preference, setPreference } = useTheme();

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
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

      {/* Search and the accessory share a row: both are "what am I looking at"
          controls, and stacking them cost a full row of chrome before the
          first piece of data. */}
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder={searchPlaceholder ?? 'Search symbol or company'}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[
            styles.search,
            type.body,
            { backgroundColor: colors.surface, color: colors.text },
          ]}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>

      <View style={styles.controlRow}>
        <View style={{ flex: 1 }}>
          <SegmentedControl<PresetKey>
            segments={PRESETS}
            value={win.preset}
            onChange={onPreset}
            compact
          />
        </View>
        <Pressable
          onPress={onOpenPicker}
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

      {/*
        Return ÷ σ and Residual are two independent questions - risk-adjust,
        and strip the market out - not three points on one dial. A segmented
        control forced them into mutually exclusive options and had no way to
        say "both": Return was really just "neither toggle is on," and
        risk-adjusted-residual (an information-ratio-style figure - residual
        return over the residual's OWN sigma, see WindowStats.residualRatio)
        had no seat at the table at all. Two toggle pills say exactly what
        they mean and combine freely; Skip joins them since all three are the
        same kind of control - a modifier, not a mode.
      */}
      <View style={styles.controlRow}>
        <Pressable
          onPress={() => onMetric(combineMetric(!metricRatioOn(metric), metricResidualOn(metric)))}
          style={[
            styles.pillButton,
            {
              backgroundColor: metricRatioOn(metric) ? colors.accentMuted : colors.surface,
              borderColor: metricRatioOn(metric) ? colors.accent : 'transparent',
            },
          ]}
          accessibilityRole="switch"
          accessibilityState={{ checked: metricRatioOn(metric) }}
          accessibilityLabel="Risk-adjust: divide return by its volatility"
        >
          <Text
            style={[type.caption, { color: metricRatioOn(metric) ? colors.accent : colors.textMuted }]}
          >
            Return ÷ σ
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onMetric(combineMetric(metricRatioOn(metric), !metricResidualOn(metric)))}
          style={[
            styles.pillButton,
            {
              backgroundColor: metricResidualOn(metric) ? colors.accentMuted : colors.surface,
              borderColor: metricResidualOn(metric) ? colors.accent : 'transparent',
            },
          ]}
          accessibilityRole="switch"
          accessibilityState={{ checked: metricResidualOn(metric) }}
          accessibilityLabel="Strip out the market's contribution first"
        >
          <Text
            style={[
              type.caption,
              { color: metricResidualOn(metric) ? colors.accent : colors.textMuted },
            ]}
          >
            Residual
          </Text>
        </Pressable>
        {/* Always the bare word: the number of sessions dropped varies by view
            (the rank table skips per horizon) and lives in the caption, so the
            pill cannot change width as views change. */}
        <Pressable
          onPress={onToggleSkip}
          style={[
            styles.pillButton,
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
          {DATES[range.startIndex]} → {DATES[range.endIndex]}
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
            styles.sectorButton,
            {
              backgroundColor: colors.surface,
              borderColor: sector ? colors.accent : 'transparent',
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Sector filter: ${sector ?? 'All sectors'}`}
        >
          <Text
            style={[type.caption, { color: sector ? colors.accent : colors.textMuted }]}
            numberOfLines={1}
          >
            {sector ?? 'All sectors'}
          </Text>
          <Text style={[type.caption, { color: sector ? colors.accent : colors.textFaint }]}>
            ▾
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space(4), paddingBottom: space(2.5), gap: space(2) },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  themeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: space(2) },
  // minWidth 0: otherwise the placeholder's width is the field's minimum and
  // the accessory gets shoved off the right edge.
  search: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.75),
  },
  // Wide enough for Card / Table / Families without wrapping, no wider - the
  // search field keeps the rest.
  accessory: { width: 208, justifyContent: 'center' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pillButton: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
    borderRadius: radius.md,
    borderWidth: 1,
  },
  // Self-sized and left-aligned, not full width: this is a filter reading
  // "here's what's active, tap to change it," not a control that deserves
  // equal billing with the window and metric rows above it.
  sectorButton: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: space(1.5),
    maxWidth: '100%',
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
