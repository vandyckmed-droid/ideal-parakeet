import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ListHeader } from '../components/ListHeader';
import { SegmentedControl } from '../components/SegmentedControl';
import { StockListBody, filterUniverse } from '../components/StockListBody';
import { WindowPicker } from '../components/WindowPicker';
import { FAMILY_TICKERS } from '../data/families';
import { BY_SYMBOL, DATES, SECTORS, TICKERS, Ticker, formatDateShort } from '../data/market';
import { computeOverlap, describeCandidateOverlap } from '../data/overlap';
import { HORIZONS, horizonIndexForWindow } from '../data/ranks';
import { windowForPreset, withSkip } from '../data/windows';
import { useAppState } from '../state/AppState';
import { useColors } from '../theme/ThemeProvider';
import { FamilyBody, filterFamilies } from './FamilyListScreen';
import { RankTableBody } from './RankTableScreen';

type MarketView = 'card' | 'table' | 'families';

const VIEW_SEGMENTS: { key: MarketView; label: string }[] = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
  { key: 'families', label: 'Families' },
];

/**
 * The Market tab: one screen, three bodies.
 *
 * Card, Table and Families used to be three separate screens that each built
 * their own header, and switching between them moved every control a little -
 * the view switch hopped rows, the window row appeared and vanished, even the
 * theme button changed size. Now the screen owns one ListHeader and only the
 * body below it changes, so the chrome is a fixed frame the views swap inside.
 *
 * The same move made the state shared instead of per-view: the search text,
 * the sector filter and the sort survive a view switch, the window control
 * drives the table's leading column (and tapping a column drives it back),
 * and the family view is searchable and sortable like everything else. All of
 * it is local rather than persisted - the screen stays mounted for the life
 * of the session, which is the only continuity a glance needs.
 */
export function MarketScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    watchlist, window: win, setPreset, setCustomWindow,
    metric, setMetric, skipEnabled, setSkipEnabled, sessionsStale,
  } = useAppState();

  const [view, setView] = useState<MarketView>('card');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [bestFirst, setBestFirst] = useState(true);

  const range = useMemo(
    () => withSkip(win, skipEnabled, sessionsStale),
    [win, skipEnabled, sessionsStale]
  );

  const basket = useMemo(
    () => watchlist.map((s) => BY_SYMBOL.get(s)).filter((t): t is Ticker => Boolean(t)),
    [watchlist]
  );

  // Screens the full 500 against the current watchlist: a badge here means
  // "adding this wouldn't diversify anything," whether or not it's already
  // held. See src/data/overlap.ts for why a name outside the basket is scored
  // differently from one inside it.
  const overlap = useMemo(
    () => computeOverlap(basket, TICKERS, win.startIndex, win.endIndex),
    [basket, win.startIndex, win.endIndex]
  );

  const overlapCaption = useMemo(
    () => describeCandidateOverlap(overlap, basket.length),
    [overlap, basket.length]
  );

  // The table's sorted column IS the shared window, resolved to the nearest
  // horizon; tapping a column that is already leading flips the direction,
  // tapping another moves the shared window there. One time axis everywhere.
  const sortColumn = useMemo(() => horizonIndexForWindow(win), [win]);
  const cycleColumn = useCallback(
    (column: number) => {
      if (column === sortColumn) {
        setBestFirst((b) => !b);
      } else {
        setPreset(HORIZONS[column].key);
        setBestFirst(true);
      }
    },
    [sortColumn, setPreset]
  );

  // Live row counts for the caption - the same predicates the bodies use.
  const stockCount = useMemo(
    () => filterUniverse(TICKERS, query, sector).length,
    [query, sector]
  );
  const familyCount = useMemo(() => filterFamilies(query).length, [query]);

  const caption = useMemo(() => {
    const through = `through ${formatDateShort(DATES[range.endIndex])}`;
    const skipNote = range.skip > 0 ? ` · ${range.skip}d skipped` : '';
    if (view === 'table') {
      // Each horizon drops its own tail, so the note lists them all.
      const skips = HORIZONS.map(
        (h) => withSkip(windowForPreset(h.key), skipEnabled, sessionsStale).skip
      );
      const names =
        stockCount === TICKERS.length
          ? `${TICKERS.length} names`
          : `${stockCount} of ${TICKERS.length} · ranks stay market-wide`;
      return `${names}${skipEnabled ? ` · skipping ${skips.join('/')}d` : ''}`;
    }
    if (view === 'families') {
      if (!FAMILY_TICKERS.length) return 'family series not published yet';
      return `${familyCount} ${familyCount === 1 ? 'family' : 'families'} · ${through}${skipNote}`;
    }
    return `${stockCount} ${stockCount === 1 ? 'name' : 'names'} · ${through}${skipNote}`;
  }, [view, stockCount, familyCount, range, skipEnabled, sessionsStale]);

  // The chip rail is the sector filter and nothing else. There used to be
  // sort chips ahead of the sectors (metric / Size / A–Z / Overlap), but the
  // metric control above already names the ranking, so they were a second
  // control for the same choice - and they pushed the sectors a full screen
  // of scrolling to the right. The list always ranks by the selected metric,
  // best first. Families have no sectors, so their rail is empty and the
  // list gets the row back.
  const chipGroups = useMemo((): Chip[][] => {
    if (view === 'families') return [];
    const sectorChips: Chip[] = [null, ...SECTORS].map((s) => ({
      key: s ?? 'all',
      label: s ?? 'All sectors',
      active: sector === s,
      onPress: () => setSector(s),
    }));
    return [sectorChips];
  }, [view, sector]);

  const viewSwitch = (
    <SegmentedControl<MarketView> segments={VIEW_SEGMENTS} value={view} onChange={setView} compact />
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <ListHeader
        title="Market"
        caption={caption}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={view === 'families' ? 'Search families' : 'Search symbol or company'}
        accessory={viewSwitch}
        win={win}
        onPreset={setPreset}
        onOpenPicker={() => setPickerOpen(true)}
        metric={metric}
        onMetric={setMetric}
        skipEnabled={skipEnabled}
        onToggleSkip={() => setSkipEnabled(!skipEnabled)}
        range={range}
        sessionsStale={sessionsStale}
        chipGroups={chipGroups}
      />

      {view === 'card' && (
        <StockListBody
          universe={TICKERS}
          query={query}
          sector={sector}
          overlap={overlap}
          overlapCaption={overlapCaption}
          showGestureHint
        />
      )}
      {view === 'table' && (
        <RankTableBody
          query={query}
          sector={sector}
          sortColumn={sortColumn}
          bestFirst={bestFirst}
          onCycleSort={cycleColumn}
        />
      )}
      {view === 'families' && (
        <FamilyBody query={query} />
      )}

      <WindowPicker
        visible={pickerOpen}
        window={win}
        onClose={() => setPickerOpen(false)}
        onApply={setCustomWindow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
