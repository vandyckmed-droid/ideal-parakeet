import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/theme';

export type Segment<T extends string> = { key: T; label: string };

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

  return (
    <View
      style={[
        styles.track,
        { backgroundColor: colors.surface, padding: compact ? 2 : 3 },
      ]}
    >
      {segments.map((seg) => {
        const active = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            onPress={() => onChange(seg.key)}
            style={[
              styles.segment,
              {
                paddingVertical: compact ? space(1.25) : space(1.75),
                backgroundColor: active ? colors.bg : 'transparent',
                shadowOpacity: active ? 0.12 : 0,
              },
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
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm + 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
});
