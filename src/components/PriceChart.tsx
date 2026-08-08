import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Line as SvgLine,
  Stop,
} from 'react-native-svg';

import { useColors } from '../theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * SVG ids live in one document-wide namespace, so two charts on screen at once
 * - the ticker pager keeps three mounted - would otherwise share a gradient and
 * a clip path, and the second would paint with the first's colour.
 */
let chartSeq = 0;

/** Room at the right edge for the leading marker and its halo. */
const LEAD_PAD = 10;

type Props = {
  values: number[];
  height?: number;
  /** Index within `values` currently under the finger, or null when idle. */
  onScrub?: (index: number | null) => void;
  /**
   * Trailing points excluded from the measurement. They are still drawn, but
   * dimmed and fenced off by a divider: cropping them would hide the very
   * price action the user chose to skip, and seeing it is the point.
   */
  excludeTail?: number;
  /**
   * Optional reference series drawn against the same axis. Each must be the
   * same length as `values`. Sharing one scale is the whole point - lines
   * scaled independently would let any set of series look neck and neck.
   */
  compare?: { values: number[]; color: string; dash: string }[];
};

/**
 * The detail-view chart, with the touch-to-scrub interaction Robinhood
 * popularised: drag anywhere across the plot and the header figures track the
 * finger. The dashed baseline marks the window's opening price, so whether the
 * position is up or down over the selected window is legible at a glance
 * without reading a single number.
 */
export function PriceChart({
  values,
  height = 220,
  onScrub,
  excludeTail = 0,
  compare,
}: Props) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const uid = useRef<number>(0);
  if (uid.current === 0) uid.current = ++chartSeq;
  const fillId = `pcFill${uid.current}`;
  const clipId = `pcClip${uid.current}`;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  // The last measured point, i.e. where the window actually ends.
  const cut = Math.max(0, values.length - 1 - Math.max(0, excludeTail));

  // Direction is judged on the measured stretch, so the colour agrees with the
  // return being reported rather than with the excluded tail.
  const rising = values.length >= 2 && values[cut] >= values[0];
  const lineColor = rising ? colors.up : colors.down;

  const geometry = useMemo(() => {
    if (values.length < 2 || width <= 0) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // The comparison lines share the axis, so they have to widen the extremes
    // or they would be drawn clipped against a frame they never sized.
    for (const c of compare ?? []) {
      for (const v of c.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min || Math.abs(max) * 0.01 || 1;
    // Breathing room so the extremes are not welded to the frame edges.
    const padY = 12;
    const usable = height - padY * 2;

    // The newest point carries a marker and a halo, which would be sliced in
    // half by the frame if the line ran to the very edge. Everything measured
    // in x - including where a finger maps to - uses this inset width.
    const plotW = Math.max(1, width - LEAD_PAD);
    const xAt = (i: number) => (i / (values.length - 1)) * plotW;
    const yAt = (v: number) => padY + (1 - (v - min) / span) * usable;

    // One vertex per horizontal pixel at most: beyond that the extra path
    // commands cost time to rasterise and change nothing on screen.
    const maxPoints = Math.min(values.length, Math.max(2, Math.floor(plotW)));
    const step = (values.length - 1) / (maxPoints - 1);

    // Two paths so the excluded tail can be drawn in its own style. They share
    // the vertex at `cut` so the join is seamless.
    let line = '';
    let tail = '';
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round(i * step);
      const cmd = `${xAt(idx).toFixed(2)} ${yAt(values[idx]).toFixed(2)}`;
      if (idx <= cut) line += `${line === '' ? 'M' : 'L'}${cmd}`;
      if (idx >= cut) tail += `${tail === '' ? 'M' : 'L'}${cmd}`;
    }
    // Fill stops at the cut, so the shaded mass matches the measured window.
    const cutX = xAt(cut);
    const area = `${line}L${cutX.toFixed(2)} ${height}L0 ${height}Z`;

    const comparePaths = (compare ?? [])
      .filter((c) => c.values.length === values.length)
      .map((c) => {
        let d = '';
        for (let i = 0; i < maxPoints; i++) {
          const idx = Math.round(i * step);
          d += `${d === '' ? 'M' : 'L'}${xAt(idx).toFixed(2)} ${yAt(c.values[idx]).toFixed(2)}`;
        }
        return { d, color: c.color, dash: c.dash };
      });

    return {
      line, tail, area, comparePaths, xAt, yAt, min, max, cutX, plotW,
      baselineY: yAt(values[0]),
      leadX: cutX,
      leadY: yAt(values[cut]),
    };
  }, [values, width, height, cut, compare]);

  // --- scrubbing ------------------------------------------------------------
  // A drag delivers touches faster than the screen repaints, and each one used
  // to set state and re-render the whole screen. Coalescing to one update per
  // frame is what makes the crosshair track the thumb instead of lurching
  // behind it; the reported index is unchanged.
  const widthRef = useRef(0);
  const lenRef = useRef(0);
  widthRef.current = Math.max(1, width - LEAD_PAD);
  lenRef.current = values.length;

  const pendingX = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const x = pendingX.current;
    const w = widthRef.current;
    const len = lenRef.current;
    if (x == null || w <= 0 || len < 2) return;
    const ratio = Math.max(0, Math.min(1, x / w));
    const index = Math.round(ratio * (len - 1));
    setScrubIndex((prev) => {
      if (prev === index) return prev;
      onScrub?.(index);
      return index;
    });
  }, [onScrub]);

  const updateScrub = useCallback(
    (x: number) => {
      pendingX.current = x;
      if (frame.current == null) frame.current = requestAnimationFrame(flush);
    },
    [flush]
  );

  const endScrub = useCallback(() => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pendingX.current = null;
    setScrubIndex(null);
    onScrub?.(null);
  }, [onScrub]);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Claim the touch immediately: without this the gesture only starts
        // after the finger travels, which feels laggy on a chart.
        .activateAfterLongPress(0)
        .minDistance(0)
        // The ticker pager scrolls horizontally underneath. Without this a
        // sideways drag on the chart is read as a page turn and the scrub is
        // lost; the pager also stops accepting drags while a scrub is live.
        .shouldCancelWhenOutside(false)
        .onBegin((e) => updateScrub(e.x))
        .onUpdate((e) => updateScrub(e.x))
        .onFinalize(endScrub)
        .runOnJS(true),
    [updateScrub, endScrub]
  );

  // --- the line drawing itself in on open -----------------------------------
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
  const leadOpacity = reveal.interpolate({
    inputRange: [0, 0.88, 1],
    outputRange: [0, 0, 1],
  });

  // --- the leading pulse ----------------------------------------------------
  // A slow halo on the newest point. It stops while scrubbing: a beating dot
  // competing with the crosshair reads as noise, and the frames are better
  // spent on the drag.
  const pulse = useRef(new Animated.Value(0)).current;
  const scrubbing = scrubIndex !== null;

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
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 0.3, 0],
  });

  return (
    <GestureDetector gesture={pan}>
      <View onLayout={onLayout} style={{ height, width: '100%' }}>
        {geometry && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <Stop
                  offset="0"
                  stopColor={lineColor}
                  stopOpacity={colors.bg === '#000000' ? 0.22 : 0.16}
                />
                <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
              </LinearGradient>
              <ClipPath id={clipId}>
                <AnimatedRect x={0} y={0} width={revealWidth} height={height} />
              </ClipPath>
            </Defs>

            {/* Everything that constitutes the drawing is revealed together by
                one sweeping clip, so the fill, the baseline and every line
                arrive as a single gesture rather than as separate effects. */}
            <G clipPath={`url(#${clipId})`}>
              <Path d={geometry.area} fill={`url(#${fillId})`} />

              <SvgLine
                x1={0}
                y1={geometry.baselineY}
                x2={width}
                y2={geometry.baselineY}
                stroke={colors.textFaint}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.6}
              />

              {excludeTail > 0 && (
                <>
                  <Path
                    d={geometry.tail}
                    stroke={colors.textFaint}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <SvgLine
                    x1={geometry.cutX}
                    y1={0}
                    x2={geometry.cutX}
                    y2={height}
                    stroke={colors.textFaint}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                </>
              )}

              {/* Under the portfolio line and dashed, so the comparisons read as
                  references rather than as rival protagonists. */}
              {geometry.comparePaths.map((c) => (
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

              <Path
                d={geometry.line}
                stroke={lineColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </G>

            {/* The newest point: a halo breathing out of a solid dot. Outside
                the clip so it can settle after the sweep has passed. */}
            <AnimatedCircle
              cx={geometry.leadX}
              cy={geometry.leadY}
              r={haloRadius}
              fill={lineColor}
              opacity={Animated.multiply(haloOpacity, leadOpacity)}
            />
            <AnimatedCircle
              cx={geometry.leadX}
              cy={geometry.leadY}
              r={3}
              fill={lineColor}
              stroke={colors.bg}
              strokeWidth={1.5}
              opacity={leadOpacity}
            />

            {scrubIndex !== null && (
              <>
                <SvgLine
                  x1={geometry.xAt(scrubIndex)}
                  y1={0}
                  x2={geometry.xAt(scrubIndex)}
                  y2={height}
                  stroke={colors.textMuted}
                  strokeWidth={1}
                />
                <Circle
                  cx={geometry.xAt(scrubIndex)}
                  cy={geometry.yAt(values[scrubIndex])}
                  r={4.5}
                  fill={lineColor}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              </>
            )}
          </Svg>
        )}
      </View>
    </GestureDetector>
  );
}
