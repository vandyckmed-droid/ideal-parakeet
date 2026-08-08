// Step 1 - the universe is the S&P 500, by declaration rather than by screen.
//
// The list comes straight from FMP's sp500-constituent endpoint - the same
// source the Research tab's backtest uses for point-in-time membership - so
// the Market tab and the backtest describe the same set of companies. The
// exchange screeners are consulted only for metadata (market cap, industry,
// country) that the constituent list doesn't carry.
//
// FMP lists dotted share classes (BRK.B, BF.B); prices are keyed dash-style
// (BRK-B), so symbols are normalised on the way in.
//
// Output: data/candidates.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { fmp } from './lib/fmp.mjs';

const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];

async function main() {
  const constituents = await fmp('sp500-constituent');
  console.log(`  sp500-constituent: ${constituents.length} rows`);

  // Screener rows keyed by symbol, purely as a metadata lookup.
  const meta = new Map();
  for (const exchange of EXCHANGES) {
    const rows = await fmp('company-screener', {
      exchange,
      marketCapMoreThan: 1,
      isEtf: false,
      isFund: false,
      isActivelyTrading: true,
      limit: 5000,
    });
    console.log(`  ${exchange}: ${rows.length} screener rows`);
    for (const r of rows) meta.set(r.symbol, { ...r, exchange });
  }

  // A few members trade on venues the three screeners don't cover (CBOE
  // listings, mostly); their metadata comes from the profile endpoint.
  for (const c of constituents) {
    const symbol = (c.symbol || '').replace(/\./g, '-');
    if (!symbol || meta.has(symbol)) continue;
    const [p] = await fmp('profile', { symbol });
    if (p) {
      meta.set(symbol, {
        companyName: p.companyName,
        exchange: p.exchange || '',
        sector: p.sector,
        industry: p.industry,
        country: p.country,
        marketCap: p.marketCap,
        beta: p.beta ?? null,
      });
      console.log(`  profile fill: ${symbol}`);
    }
  }

  let matched = 0;
  const candidates = constituents
    .filter((c) => c.symbol)
    .map((c) => {
      const symbol = c.symbol.replace(/\./g, '-');
      const m = meta.get(symbol);
      if (m) matched++;
      return {
        symbol,
        name: m?.companyName || c.name || symbol,
        exchange: m?.exchange || '',
        sector: m?.sector || c.sector || 'Unknown',
        industry: m?.industry || c.subSector || 'Unknown',
        country: m?.country || 'US',
        marketCap: m?.marketCap ?? null,
        beta: m?.beta ?? null,
      };
    })
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

  // The index holds ~503 lines (a few companies list two share classes). A
  // short list means the endpoint returned junk; refuse to pass it on.
  if (candidates.length < 490 || candidates.length > 520) {
    console.error(`  got ${candidates.length} constituents - expected ~503`);
    process.exit(1);
  }

  mkdirSync('data', { recursive: true });
  writeFileSync('data/candidates.json', JSON.stringify(candidates, null, 2));

  console.log(`\n  ${candidates.length} constituents, ${matched} with screener metadata`);
  console.log(`  wrote data/candidates.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
