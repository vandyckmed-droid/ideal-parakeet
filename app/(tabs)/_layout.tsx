import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, StyleSheet, Text } from 'react-native';

import { useAppState } from '../../src/state/AppState';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Glyph rather than an icon font: it keeps the bundle free of an icon
 * dependency for two tabs, and scales with the platform text settings.
 */
function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { watchlist } = useAppState();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.hairline,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Market',
          tabBarIcon: ({ color }) => <TabGlyph glyph="◫" color={color} />,
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Watchlist',
          tabBarIcon: ({ color }) => <TabGlyph glyph="★" color={color} />,
          tabBarBadge: watchlist.length || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.bg, fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
