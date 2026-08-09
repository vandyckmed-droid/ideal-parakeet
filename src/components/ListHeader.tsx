import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SegmentedControl } from './SegmentedControl';
import { DATES } from '../data/market';
import { MetricKey } from '../data/stats';
import { DateWindow, EffectiveWindow, PRESETS, PresetKey } from '../data/windows';
import { useTheme } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

export const METRIC_SEGMENTS: { key: MetricKey; label: string }[] = [
  { key: 'return', label: 'Return' },
  { key: 'ratio', label: 'Return ÷ σ' },
  { key: 'residual', label: 'Residual' },
];

export type Chip = { key: string; label: string; active: boolean; onPress: () => void };

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
  chipGroups,
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
  /** Chip rail contents; groups are separated by a hairline divider. */
  chipGroups: Chip[][];
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

      <View style={styles.controlRow}>
        <View style={{ flex: 1 }}>
          <SegmentedControl<MetricKey>
            segments={METRIC_SEGMENTS}
            value={metric}
            onChange={onMetric}
            compact
          />
        </View>
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

      {chipGroups.some((g) => g.length > 0) && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {chipGroups.map((group, g) => (
          <React.Fragment key={g}>
            {g > 0 && (
              <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />
            )}
            {group.map((chip) => (
              <Pressable
                key={chip.key}
                onPress={chip.onPress}
                style={[
                  styles.chip,
                  {
                    backgroundColor: chip.active ? colors.accentMuted : colors.surface,
                    borderColor: chip.active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    type.caption,
                    { color: chip.active ? colors.accent : colors.textMuted },
                  ]}
                >
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </React.Fragment>
        ))}
      </ScrollView>
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
  chipRow: { gap: space(2), paddingRight: space(4), alignItems: 'center' },
  chip: {
    paddingHorizontal: space(3),
    paddingVertical: space(1.75),
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: space(1) },
});
