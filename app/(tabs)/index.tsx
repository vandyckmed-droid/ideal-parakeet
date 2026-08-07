import React, { useMemo } from 'react';

import { BY_SYMBOL, TICKERS, Ticker } from '../../src/data/market';
import { computeOverlap, describeCandidateOverlap } from '../../src/data/overlap';
import { TickerListScreen } from '../../src/screens/TickerListScreen';
import { useAppState } from '../../src/state/AppState';

export default function MarketScreen() {
  const { watchlist, window: win } = useAppState();

  const basket = useMemo(
    () =>
      watchlist
        .map((s) => BY_SYMBOL.get(s))
        .filter((t): t is Ticker => Boolean(t)),
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

  return (
    <TickerListScreen
      title="Market"
      universe={TICKERS}
      overlap={overlap}
      overlapCaption={overlapCaption}
    />
  );
}
