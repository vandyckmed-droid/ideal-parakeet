import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BY_SYMBOL, Ticker } from '../../src/data/market';
import { computeOverlap } from '../../src/data/overlap';
import { TickerListScreen } from '../../src/screens/TickerListScreen';
import { useAppState } from '../../src/state/AppState';
import { useColors } from '../../src/theme/ThemeProvider';
import { space, type } from '../../src/theme/theme';

export default function WatchlistScreen() {
  const { watchlist, window: win } = useAppState();
  const colors = useColors();

  const universe = useMemo(
    () =>
      watchlist
        .map((s) => BY_SYMBOL.get(s))
        .filter((t): t is Ticker => Boolean(t)),
    [watchlist]
  );

  // Still computed, still drives the row badges and the Overlap sort - it just
  // no longer says anything in the header. Nothing between the title and the
  // search box on this screen: the numbers that belong to a name live on that
  // name's row.
  //
  // The full selected window, not the skip-adjusted range: the skip exists to
  // exclude short-term reversal from a *return* measurement, which has no
  // bearing on how two return series co-move across the window as a whole.
  // Basket and universe are the same set here: this screen only ever renders
  // its own holdings, so there is nothing to gain from scoring the other 494
  // names it will never show.
  const overlap = useMemo(
    () => computeOverlap(universe, universe, win.startIndex, win.endIndex),
    [universe, win.startIndex, win.endIndex]
  );

  return (
    <TickerListScreen
      title="Watchlist"
      universe={universe}
      overlap={overlap}
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
