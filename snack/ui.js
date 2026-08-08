// Shared presentational pieces: segmented control, sparkline, price chart, row.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Line as SvgLine, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { useColors } from './theme';
import { mixHex, mono, radius, space, type, withAlpha } from './theme';
import { formatMetric, formatPercentPlain, formatPrice, formatRatio, metricValue } from './stats';
import { OVERLAP_THRESHOLD } from './overlap';
import { rankHeat } from './ranks';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// SVG ids share one document-wide namespace, so two charts mounted at once -
// the ticker pager keeps three - would otherwise share a gradient and a clip
// path, and the second would paint with the first's colour.
let chartSeq = 0;

/** Room at the right edge for the leading marker and its halo. */
const LEAD_PAD = 10;

const haptic = (fn) => {
  try {
    const r = fn();
    if (r && r.catch) r.catch(() => {});
  } catch (e) {
    /* haptics are a nicety; never let them break an interaction */
  }
};

// The active state is a single thumb that glides between positions, rather
// than each segment repainting its own background - one moving object reads as
// a physical part. Thumb geometry is arithmetic on the measured track width,
// so the first paint is correct before any animation has run.
export function SegmentedControl({ segments, value, onChange, compact }) {
  const colors = useColors();
  const [trackWidth, setTrackWidth] = useState(0);

  const pad = compact ? 2 : 3;
  const gap = 2;
  const n = segments.length;
  const index = Math.max(0, segments.findIndex((s) => s.key === value));
  const segWidth = n > 0 ? (trackWidth - pad * 2 - gap * (n - 1)) / n : 0;

  const x = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (trackWidth <= 0) return;
    const target = pad + index * (segWidth + gap);
    if (!mounted.current) {
      // First layout: appear in place. Sliding in from 0 on mount would
      // animate something the user never changed.
      x.setValue(target);
      mounted.current = true;
      return;
    }
    Animated.spring(x, { toValue: target, speed: 26, bounciness: 5, useNativeDriver: true }).start();
  }, [index, segWidth, trackWidth, pad, x]);

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[sc.track, { backgroundColor: colors.surface, padding: pad }]}
    >
      {trackWidth > 0 && segWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            sc.thumb,
            {
              width: segWidth,
              top: pad,
              bottom: pad,
              backgroundColor: colors.bg,
              transform: [{ translateX: x }],
            },
          ]}
        />
      )}
      {segments.map((seg) => {
        const active = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            onPress={() => onChange(seg.key)}
            hitSlop={4}
            style={[sc.segment, { paddingVertical: compact ? space(1.25) : space(1.75) }]}
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
  thumb: {
    position: 'absolute',
    left: 0,
    borderRadius: radius.sm + 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: 0.12,
    elevation: 1,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
export function PriceChart({ values, height = 220, onScrub, excludeTail = 0, compare }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState(null);

  const uid = useRef(0);
  if (uid.current === 0) uid.current = ++chartSeq;
  const fillId = `pcfill${uid.current}`;
  const clipId = `pcclip${uid.current}`;

  // Last measured point. The excluded tail is still drawn, but dimmed and
  // fenced off - cropping it would hide the very price action being skipped.
  const cut = Math.max(0, values.length - 1 - Math.max(0, excludeTail));

  const widthRef = useRef(0);
  const lenRef = useRef(0);
  widthRef.current = Math.max(1, width - LEAD_PAD);
  lenRef.current = values.length;

  // A drag delivers touches faster than the screen repaints, and each one used
  // to set state and re-render the whole screen. Coalescing to one update per
  // frame is what makes the crosshair track the thumb instead of lurching
  // behind it; the reported index is unchanged.
  const pendingX = useRef(null);
  const frame = useRef(null);

  const flush = useCallback(() => {
    frame.current = null;
    const x = pendingX.current;
    const w = widthRef.current;
    const len = lenRef.current;
    if (x == null || !w || len < 2) return;
    const ratio = Math.max(0, Math.min(1, x / w));
    const i = Math.round(ratio * (len - 1));
    setScrub((prev) => {
      if (prev === i) return prev;
      if (onScrub) onScrub(i);
      return i;
    });
  }, [onScrub]);

  const update = useCallback(
    (x) => {
      pendingX.current = x;
      if (frame.current == null) frame.current = requestAnimationFrame(flush);
    },
    [flush]
  );

  const release = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pendingX.current = null;
    setScrub(null);
    if (onScrub) onScrub(null);
  }, [onScrub]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Capture phase: the ticker pager scrolls horizontally underneath, and
        // without claiming the touch before it, a sideways drag on the chart is
        // read as a page turn and the scrub is lost.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => update(e.nativeEvent.locationX),
        onPanResponderMove: (e) => update(e.nativeEvent.locationX),
        onPanResponderRelease: release,
        onPanResponderTerminate: release,
      }),
    [update, release]
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
    // The comparison lines share the axis, so they have to widen the extremes
    // or they would be drawn clipped against a frame they never sized.
    for (const c of compare || []) {
      for (const v of c.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min || Math.abs(max) * 0.01 || 1;
    const padY = 12;
    const usable = height - padY * 2;
    // The newest point carries a marker and a halo, which would be sliced in
    // half by the frame if the line ran to the very edge. Everything measured
    // in x - including where a finger maps to - uses this inset width.
    const plotW = Math.max(1, width - LEAD_PAD);
    const xAt = (i) => (i / (values.length - 1)) * plotW;
    const yAt = (v) => padY + (1 - (v - min) / span) * usable;

    const n = Math.min(values.length, Math.max(2, Math.floor(plotW)));
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
    const comparePaths = (compare || [])
      .filter((c) => c.values.length === values.length)
      .map((c) => {
        let d = '';
        for (let i = 0; i < n; i++) {
          const idx = Math.round(i * step);
          d += `${d === '' ? 'M' : 'L'}${xAt(idx).toFixed(2)} ${yAt(c.values[idx]).toFixed(2)}`;
        }
        return { d, color: c.color, dash: c.dash };
      });
    return {
      path,
      tail,
      cutX,
      comparePaths,
      // Fill stops at the cut so the shaded mass matches the measured window.
      area: `${path}L${cutX.toFixed(2)} ${height}L0 ${height}Z`,
      xAt,
      yAt,
      baseY: yAt(values[0]),
      leadX: cutX,
      leadY: yAt(values[cut]),
    };
  }, [values, width, height, cut, compare]);

  // --- the line drawing itself in on open ----------------------------------
  // Keyed on a signature of the data rather than its array identity, so it
  // replays when the window changes and stays put while a finger drags.
  const reveal = useRef(new Animated.Value(0)).current;
  const ready = width > 0 && values.length >= 2;
  const signature = ready ? `${values.length}:${values[0]}:${values[cut]}` : '';

  useEffect(() => {
    if (!signature) return;
    reveal.setValue(0);
    const anim = Animated.timing(reveal, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      // Driving an SVG geometry attribute, which the native driver cannot own.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [signature, reveal]);

  const revealWidth = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(width, 1)],
  });
  // The leading marker arrives only once the line has reached it.
  const leadOpacity = reveal.interpolate({ inputRange: [0, 0.88, 1], outputRange: [0, 0, 1] });

  // --- the leading pulse ---------------------------------------------------
  // A slow halo on the newest point. It stops while scrubbing: a beating dot
  // competing with the crosshair reads as noise, and the frames are better
  // spent on the drag.
  const pulse = useRef(new Animated.Value(0)).current;
  const scrubbing = scrub !== null;

  useEffect(() => {
    if (scrubbing || !ready) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [scrubbing, ready, pulse]);

  const haloRadius = pulse.interpolate({ inputRange: [0, 1], outputRange: [3.5, 14] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.3, 0] });

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, width: '100%' }}
      {...responder.panHandlers}
    >
      {geo && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={line} stopOpacity={colors.fillOpacity} />
              <Stop offset="1" stopColor={line} stopOpacity={0} />
            </LinearGradient>
            <ClipPath id={clipId}>
              <AnimatedRect x={0} y={0} width={revealWidth} height={height} />
            </ClipPath>
          </Defs>

          {/* Everything that constitutes the drawing is revealed together by
              one sweeping clip, so the fill, the baseline and every line arrive
              as a single gesture rather than as separate effects. */}
          <G clipPath={`url(#${clipId})`}>
            <Path d={geo.area} fill={`url(#${fillId})`} />
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
            {/* Under the portfolio line and dashed, so the comparisons read as
                references rather than as rival protagonists. */}
            {geo.comparePaths.map((c) => (
              <Path
                key={c.color + c.dash}
                d={c.d}
                stroke={c.color}
                strokeWidth={1.5}
                strokeDasharray={c.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            <Path d={geo.path} stroke={line} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </G>

          {/* The newest point: a halo breathing out of a solid dot. Outside the
              clip so it can settle after the sweep has passed. */}
          <AnimatedCircle
            cx={geo.leadX}
            cy={geo.leadY}
            r={haloRadius}
            fill={line}
            opacity={Animated.multiply(haloOpacity, leadOpacity)}
          />
          <AnimatedCircle
            cx={geo.leadX}
            cy={geo.leadY}
            r={3}
            fill={line}
            stroke={colors.bg}
            strokeWidth={1.5}
            opacity={leadOpacity}
          />

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
        (overlapScore != null && overlapScore >= OVERLAP_THRESHOLD ? ', overlaps your watchlist' : '')
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
            <View
              style={[
                row.overlapBadge,
                { backgroundColor: overlapScore >= OVERLAP_THRESHOLD ? colors.warnMuted : colors.surface },
              ]}
            >
              <Text
                style={[type.micro, mono, { color: overlapScore >= OVERLAP_THRESHOLD ? colors.warn : colors.textMuted }]}
              >
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

// --- rank table row ----------------------------------------------------------

export const RANK_ROW_HEIGHT = 44;
/** Width of one rank cell. Five of these plus the symbol column fit a phone. */
export const RANK_CELL_WIDTH = 46;

/**
 * Peak background tint. Deliberately low: the cell has to sit behind a number
 * that stays readable in both palettes, and a full-strength fill would turn the
 * table into a block of colour with the ranks fighting it.
 */
const MAX_TINT = 0.26;

function RankCell({ rank, count }) {
  const colors = useColors();
  const heat = rankHeat(rank, count);

  if (rank === null || heat === null) {
    return (
      <View style={rank_.cell}>
        <Text style={[type.caption, mono, { color: colors.textFaint }]}>—</Text>
      </View>
    );
  }

  const pole = heat.side === 'up' ? colors.up : colors.down;
  return (
    <View style={rank_.cell}>
      <View style={[rank_.chip, { backgroundColor: withAlpha(pole, heat.strength * MAX_TINT) }]}>
        <Text
          style={[type.caption, mono, { color: mixHex(colors.textMuted, pole, heat.strength) }]}
        >
          {rank}
        </Text>
      </View>
    </View>
  );
}

/**
 * One name's rank at every horizon.
 *
 * Same gestures as the card view's row - tap to watchlist, long press to open -
 * so the two sub-views of the Market tab do not teach different meanings for
 * the same touch.
 */
export const RankRow = React.memo(function RankRow({
  ticker, ranks, counts, watched, onToggleWatch, onOpenDetail,
}) {
  const colors = useColors();

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
        rank_.row,
        { backgroundColor: pressed ? colors.surface : 'transparent', borderBottomColor: colors.hairline },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        `${ticker.s}, ${ticker.n}. Ranks: ` +
        ranks.map((r) => (r === null ? 'unranked' : r)).join(', ')
      }
      accessibilityHint="Tap to toggle watchlist, long press to open details"
    >
      <View style={[rank_.marker, { backgroundColor: watched ? colors.accent : 'transparent' }]} />
      <View style={rank_.identity}>
        <Text
          style={[type.bodyStrong, { color: watched ? colors.accent : colors.text }]}
          numberOfLines={1}
        >
          {ticker.s}
        </Text>
      </View>
      {ranks.map((r, i) => (
        <RankCell key={i} rank={r} count={counts[i]} />
      ))}
    </Pressable>
  );
});

const rank_ = StyleSheet.create({
  row: {
    height: RANK_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center',
    paddingRight: space(3), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  marker: {
    width: 3, height: 20, borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm, marginRight: space(2.5),
  },
  identity: { flex: 1, justifyContent: 'center' },
  cell: { width: RANK_CELL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  chip: {
    minWidth: 34, paddingVertical: 3, paddingHorizontal: space(1),
    borderRadius: radius.sm, alignItems: 'center',
  },
});

export { haptic };
