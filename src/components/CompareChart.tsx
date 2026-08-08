import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect, Line as SvgLine } from 'react-native-svg';

import { useColors } from '../theme/ThemeProvider';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Shared with PriceChart's id scheme: SVG ids are document-global. */
let compareSeq = 0;

/** Room at the right edge so end markers are not sliced by the frame. */
const LEAD_PAD = 10;

export type CompareLine = { key: string; color: string; values: number[] };

/**
 * Several series as equals on one shared axis - unlike PriceChart, where one
 * protagonist owns the fill and references are dashed. Every line here is
 * solid and colour-coded; the legend lives outside, keyed by the same colours.
 * All lines must be the same length; the shared scale is the whole point.
 */
export function CompareChart({
  lines,
  height = 220,
  baseline,
  onScrub,
}: {
  lines: CompareLine[];
  height?: number;
  /** Horizontal dashed reference, e.g. the $10,000 everything started from. */
  baseline?: number;
  onScrub?: (index: number | null) => void;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const uid = useRef<number>(0);
  if (uid.current === 0) uid.current = ++compareSeq;
  const clipId = `ccClip${uid.current}`;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const len = lines.length ? lines[0].values.length : 0;

  const geometry = useMemo(() => {
    if (len < 2 || width <= 0 || !lines.length) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const l of lines) {
      for (const v of l.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (baseline != null) {
      if (baseline < min) min = baseline;
      if (baseline > max) max = baseline;
    }
    const span = max - min || Math.abs(max) * 0.01 || 1;
    const padY = 12;
    const usable = height - padY * 2;
    const plotW = Math.max(1, width - LEAD_PAD);
    const xAt = (i: number) => (i / (len - 1)) * plotW;
    const yAt = (v: number) => padY + (1 - (v - min) / span) * usable;

    const maxPoints = Math.min(len, Math.max(2, Math.floor(plotW)));
    const step = (len - 1) / (maxPoints - 1);

    const paths = lines.map((l) => {
      let d = '';
      for (let i = 0; i < maxPoints; i++) {
        const idx = Math.round(i * step);
        d += `${d === '' ? 'M' : 'L'}${xAt(idx).toFixed(2)} ${yAt(l.values[idx]).toFixed(2)}`;
      }
      return { key: l.key, color: l.color, d, endY: yAt(l.values[len - 1]) };
    });

    return { paths, xAt, yAt, baselineY: baseline != null ? yAt(baseline) : null, endX: xAt(len - 1) };
  }, [lines, len, width, height, baseline]);

  // Scrub, coalesced to one update per frame (same reasoning as PriceChart).
  const plotWRef = useRef(1);
  const lenRef = useRef(0);
  plotWRef.current = Math.max(1, width - LEAD_PAD);
  lenRef.current = len;

  const pendingX = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const x = pendingX.current;
    if (x == null || lenRef.current < 2) return;
    const ratio = Math.max(0, Math.min(1, x / plotWRef.current));
    const index = Math.round(ratio * (lenRef.current - 1));
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
        .activateAfterLongPress(0)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => updateScrub(e.x))
        .onUpdate((e) => updateScrub(e.x))
        .onFinalize(endScrub)
        .runOnJS(true),
    [updateScrub, endScrub]
  );

  // Draw-in: keyed on which lines are shown, so adding a family replays the
  // sweep and a scrub never does.
  const reveal = useRef(new Animated.Value(0)).current;
  const signature = lines.map((l) => l.key).join('|') + `:${len}`;
  const ready = width > 0 && len >= 2;

  useEffect(() => {
    if (!ready) return;
    reveal.setValue(0);
    const anim = Animated.timing(reveal, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ready, reveal]);

  const revealWidth = reveal.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(width, 1)] });

  return (
    <GestureDetector gesture={pan}>
      <View onLayout={onLayout} style={{ height, width: '100%' }}>
        {geometry && (
          <Svg width={width} height={height}>
            <Defs>
              <ClipPath id={clipId}>
                <AnimatedRect x={0} y={0} width={revealWidth} height={height} />
              </ClipPath>
            </Defs>

            <G clipPath={`url(#${clipId})`}>
              {geometry.baselineY != null && (
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
              )}
              {geometry.paths.map((p) => (
                <Path
                  key={p.key}
                  d={p.d}
                  stroke={p.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ))}
            </G>

            {/* End markers so each line's terminus is findable at a glance. */}
            {geometry.paths.map((p) => (
              <Circle
                key={`end-${p.key}`}
                cx={geometry.endX}
                cy={p.endY}
                r={3}
                fill={p.color}
                stroke={colors.bg}
                strokeWidth={1.5}
              />
            ))}

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
                {lines.map((l) => (
                  <Circle
                    key={`dot-${l.key}`}
                    cx={geometry.xAt(scrubIndex)}
                    cy={geometry.yAt(l.values[scrubIndex])}
                    r={4}
                    fill={l.color}
                    stroke={colors.bg}
                    strokeWidth={2}
                  />
                ))}
              </>
            )}
          </Svg>
        )}
      </View>
    </GestureDetector>
  );
}
