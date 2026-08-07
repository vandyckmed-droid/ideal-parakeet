import React, { useMemo, useState } from 'react';

import { SegmentedControl } from '../components/SegmentedControl';
import { BY_SYMBOL, TICKERS, Ticker } from '../data/market';
import { computeOverlap, describeCandidateOverlap } from '../data/overlap';
import { useAppState } from '../state/AppState';
import { RankTableScreen } from './RankTableScreen';
import { TickerListScreen } from './TickerListScreen';

type MarketView = 'card' | 'table';

const VIEW_SEGMENTS: { key: MarketView; label: string }[] = [
  { key: 'card', label: 'Card' },
  { key: 'table', label: 'Table' },
];

/**
 * The Market tab, in two views of the same 500 names.
 *
 * Card is the original: one window at a time, with the sparkline, price and
 * overlap badge that need the room. Table trades all of that for five horizons
 * side by side.
 *
 * Which view is showing is local state rather than something persisted. The
 * screen stays mounted for the life of the session, so the choice survives
 * switching to the Watchlist tab and back, which is the only continuity that
 * matters here; a view mode restored from disk on a cold start would be a
 * setting, and this is a glance.
 */
export function MarketScreen() {
  const { watchlist, window: win } = useAppState();
  const [view, setView] = useState<MarketView>('card');

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

  const viewSwitch = (
    <SegmentedControl<MarketView> segments={VIEW_SEGMENTS} value={view} onChange={setView} />
  );

  if (view === 'table') return <RankTableScreen headerAccessory={viewSwitch} />;

  return (
    <TickerListScreen
      title="Market"
      universe={TICKERS}
      overlap={overlap}
      overlapCaption={overlapCaption}
      headerAccessory={viewSwitch}
      showCaption
      showGestureHint
    />
  );
}
