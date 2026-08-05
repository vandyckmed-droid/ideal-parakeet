import React from 'react';

import { TICKERS } from '../../src/data/market';
import { TickerListScreen } from '../../src/screens/TickerListScreen';

export default function MarketScreen() {
  return <TickerListScreen title="Market" universe={TICKERS} />;
}
