// Shared presentational pieces: segmented control, sparkline, price chart, row.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Line as SvgLine, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { useColors } from './theme';
import { mono, radius, space, type } from './theme';
import { formatMetric, formatPrice, metricValue } from './stats';

const haptic = (fn) => {
  try {
    const r = fn();
    if (r && r.catch) r.catch(() => {});
  } catch (e) {
    /* haptics are a nicety; never let them break an interaction */
  }
};

export function SegmentedControl({ segments, value, onChange, compact }) {
  const colors = useColors();
  return (
    <View style={[sc.track, { backgroundColor: colors.surface, padding: compact ? 2 : 3 }]}>
      {segments.map((seg) => {
        const active = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            onPress={() => onChange(seg.key)}
            hitSlop={4}
            style={[
              sc.segment,
              {
                paddingVertical: compact ? space(1.25) : space(1.75),
                backgroundColor: active ? colors.bg : 'transparent',
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[compact ? type.caption : type.bodyStrong, { color: active ? colors.text : colors.textMuted }]}
            >
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const sc = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radius.md, gap: 2 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm + 1 },
});

export const Sparkline = React.memo(function Sparkline({ values, color, width = 64, height = 26 }) {
  const d = useMemo(() => {
    if (!values || values.length < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const stroke = 1.6;
    const usable = height - stroke;
    // Cap the vertex count: 500 path commands for 64px of width buys nothing.
    const n = Math.min(values.length, 60);
    const step = (values.length - 1) / (n - 1);
    let path = '';
    for (let i = 0; i < n; i++) {
      const v = values[Math.round(i * step)];
      const x = (i / (n - 1)) * width;
      const y = stroke / 2 + (1 - (v - min) / span) * usable;
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return path;
  }, [values, width, height]);

  if (!d) return <Svg width={width} height={height} />;
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
});

/**
 * Touch-to-scrub chart. Uses PanResponder rather than a gesture library so the
 * Snack build depends only on modules Snack preloads. The dashed baseline marks
 * the window's opening price, so up-or-down reads without parsing a number.
 */
export function PriceChart({ values, height = 220, onScrub, excludeTail = 0 }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState(null);

  // Last measured point. The excluded tail is still drawn, but dimmed and
  // fenced off - cropping it would hide the very price action being skipped.
  const cut = Math.max(0, values.length - 1 - Math.max(0, excludeTail));

  const widthRef = useRef(0);
  const lenRef = useRef(0);
  widthRef.current = width;
  lenRef.current = values.length;

  const update = useCallback(
    (x) => {
      const w = widthRef.current;
      const len = lenRef.current;
      if (!w || len < 2) return;
      const ratio = Math.max(0, Math.min(1, x / w));
      const i = Math.round(ratio * (len - 1));
      setScrub((prev) => {
        if (prev === i) return prev;
        if (onScrub) onScrub(i);
        return i;
      });
    },
    [onScrub]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => update(e.nativeEvent.locationX),
        onPanResponderMove: (e) => update(e.nativeEvent.locationX),
        onPanResponderRelease: () => {
          setScrub(null);
          if (onScrub) onScrub(null);
        },
        onPanResponderTerminate: () => {
          setScrub(null);
          if (onScrub) onScrub(null);
        },
      }),
    [update, onScrub]
  );

  // Judged on the measured stretch so the colour agrees with the reported return.
  const rising = values.length >= 2 && values[cut] >= values[0];
  const line = rising ? colors.up : colors.down;

  const geo = useMemo(() => {
    if (values.length < 2 || width <= 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || Math.abs(max) * 0.01 || 1;
    const padY = 12;
    const usable = height - padY * 2;
    const xAt = (i) => (i / (values.length - 1)) * width;
    const yAt = (v) => padY + (1 - (v - min) / span) * usable;

    const n = Math.min(values.length, Math.max(2, Math.floor(width)));
    const step = (values.length - 1) / (n - 1);
    // Two paths sharing the vertex at `cut`, so the excluded tail can carry its
    // own style with a seamless join.
    let path = '';
    let tail = '';
    for (let i = 0; i < n; i++) {
      const idx = Math.round(i * step);
      const cmd = `${xAt(idx).toFixed(2)} ${yAt(values[idx]).toFixed(2)}`;
      if (idx <= cut) path += `${path === '' ? 'M' : 'L'}${cmd}`;
      if (idx >= cut) tail += `${tail === '' ? 'M' : 'L'}${cmd}`;
    }
    const cutX = xAt(cut);
    return {
      path,
      tail,
      cutX,
      // Fill stops at the cut so the shaded mass matches the measured window.
      area: `${path}L${cutX.toFixed(2)} ${height}L0 ${height}Z`,
      xAt,
      yAt,
      baseY: yAt(values[0]),
    };
  }, [values, width, height, cut]);

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, width: '100%' }}
      {...responder.panHandlers}
    >
      {geo && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={line} stopOpacity={colors.fillOpacity} />
              <Stop offset="1" stopColor={line} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={geo.area} fill="url(#pcfill)" />
          <SvgLine
            x1={0}
            y1={geo.baseY}
            x2={width}
            y2={geo.baseY}
            stroke={colors.textFaint}
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.6}
          />
          {excludeTail > 0 && (
            <>
              <Path
                d={geo.tail}
                stroke={colors.textFaint}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <SvgLine
                x1={geo.cutX}
                y1={0}
                x2={geo.cutX}
                y2={height}
                stroke={colors.textFaint}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            </>
          )}
          <Path d={geo.path} stroke={line} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {scrub !== null && scrub < values.length && (
            <>
              <SvgLine x1={geo.xAt(scrub)} y1={0} x2={geo.xAt(scrub)} y2={height} stroke={colors.textMuted} strokeWidth={1} />
              <Circle cx={geo.xAt(scrub)} cy={geo.yAt(values[scrub])} r={4.5} fill={line} stroke={colors.bg} strokeWidth={2} />
            </>
          )}
        </Svg>
      )}
    </View>
  );
}

export const ROW_HEIGHT = 64;

/**
 * Tap toggles the watchlist; long press opens the ticker. That is the reverse
 * of the usual convention, so the affordance carries itself: an accent bar, a
 * coloured symbol and a trailing dot all mirror the state, and the two gestures
 * fire different haptics.
 */
export const TickerRow = React.memo(function TickerRow({
  ticker, stats, series, metric, watched, onToggleWatch, onOpenDetail, rank, overlapScore,
}) {
  const colors = useColors();
  const value = metricValue(stats, metric);
  const tone = value === null ? colors.flat : value >= 0 ? colors.up : colors.down;

  return (
    <Pressable
      onPress={() => {
        haptic(() =>
          Haptics.impactAsync(watched ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
        );
        onToggleWatch(ticker.s);
      }}
      onLongPress={() => {
        haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
        onOpenDetail(ticker.s);
      }}
      delayLongPress={280}
      style={({ pressed }) => [
        row.root,
        { backgroundColor: pressed ? colors.surface : 'transparent', borderBottomColor: colors.hairline },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        `${ticker.s}, ${ticker.n}` +
        (overlapScore != null ? ', overlaps your watchlist' : '')
      }
      accessibilityHint="Tap to toggle watchlist, long press to open details"
    >
      <View style={[row.marker, { backgroundColor: watched ? colors.accent : 'transparent' }]} />
      <View style={row.identity}>
        <View style={row.symbolLine}>
          {rank !== undefined && <Text style={[type.micro, mono, { color: colors.textFaint }]}>{rank}</Text>}
          <Text style={[type.bodyStrong, { color: watched ? colors.accent : colors.text }]} numberOfLines={1}>
            {ticker.s}
          </Text>
          {watched && <View style={[row.dot, { backgroundColor: colors.accent }]} />}
          {overlapScore != null && (
            <View style={[row.overlapBadge, { backgroundColor: colors.warnMuted }]}>
              <Text style={[type.micro, mono, { color: colors.warn }]}>
                ⇄ {Math.round(overlapScore * 100)}%
              </Text>
            </View>
          )}
        </View>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {ticker.n}
        </Text>
      </View>
      <View style={row.spark}>
        <Sparkline values={series} color={tone} />
      </View>
      <View style={row.figures}>
        <Text style={[type.bodyStrong, mono, { color: colors.text }]}>{formatPrice(ticker.last)}</Text>
        <Text style={[type.caption, mono, { color: tone }]}>{formatMetric(value, metric)}</Text>
      </View>
    </Pressable>
  );
});

const row = StyleSheet.create({
  root: {
    height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center',
    paddingRight: space(4), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  marker: {
    width: 3, height: 28, borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm, marginRight: space(3),
  },
  identity: { flex: 1, justifyContent: 'center', gap: 2 },
  symbolLine: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 5, height: 5, borderRadius: 3 },
  overlapBadge: { paddingHorizontal: space(1.5), paddingVertical: 1, borderRadius: radius.sm },
  spark: { width: 64, marginHorizontal: space(3) },
  figures: { minWidth: 84, alignItems: 'flex-end', gap: 2 },
});

export { haptic };
