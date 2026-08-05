import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BY_SYMBOL, Ticker } from '../../src/data/market';
import { TickerListScreen } from '../../src/screens/TickerListScreen';
import { useAppState } from '../../src/state/AppState';
import { useColors } from '../../src/theme/ThemeProvider';
import { space, type } from '../../src/theme/theme';

export default function WatchlistScreen() {
  const { watchlist } = useAppState();
  const colors = useColors();

  const universe = useMemo(
    () =>
      watchlist
        .map((s) => BY_SYMBOL.get(s))
        .filter((t): t is Ticker => Boolean(t)),
    [watchlist]
  );

  return (
    <TickerListScreen
      title="Watchlist"
      universe={universe}
      emptyState={
        <View style={styles.empty}>
          <Text style={[type.title, { color: colors.text }]}>Nothing watched yet</Text>
          <Text style={[type.body, styles.copy, { color: colors.textMuted }]}>
            Tap any row on the Market tab to add it here. Press and hold a row to
            open its chart.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space(2) },
  copy: { textAlign: 'center', maxWidth: 280 },
});
