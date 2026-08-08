import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/theme';

export type Segment<T extends string> = { key: T; label: string };

/**
 * A segmented control whose active state is a single thumb that glides between
 * positions, rather than each segment repainting its own background. One
 * moving object reads as a physical part; five swapping backgrounds read as a
 * repaint. The labels sit above the thumb and only change colour.
 *
 * Geometry: the segments are equal-width flex children with a fixed gap, so
 * the thumb's rest position is pure arithmetic on the measured track width -
 * no per-segment measurement, which keeps the first paint correct even before
 * any animation has run.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  compact = false,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (key: T) => void;
  compact?: boolean;
}) {
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
    Animated.spring(x, {
      toValue: target,
      speed: 26,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  }, [index, segWidth, trackWidth, pad, x]);

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: colors.surface, padding: pad }]}
    >
      {trackWidth > 0 && segWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
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
            style={[
              styles.segment,
              { paddingVertical: compact ? space(1.25) : space(1.75) },
            ]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              numberOfLines={1}
              style={[
                compact ? type.caption : type.bodyStrong,
                { color: active ? colors.text : colors.textMuted },
              ]}
            >
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    gap: 2,
  },
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
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
