// Step 1 - assemble a candidate pool of US-listed common equities.
//
// This is deliberately a *wide* net (~800 names). The screener alone cannot
// tell a common share from a baby bond, because FMP reports the parent
// company's market cap on the bond's row. Step 3 does the real separation
// using traded liquidity, which requires the price history from step 2.
//
// Output: data/candidates.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { fmp } from './lib/fmp.mjs';

const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];
const MIN_MARKET_CAP = 1e9;
const CANDIDATE_POOL = 800; // trimmed to exactly 500 in step 3

// Common shares look like AAPL or BRK-B. Preferred series and baby bonds use
// a -P<letter> suffix (FITB-PM), warrants -W, units -U, rights -R. Allowing
// only a single trailing A or B keeps dual-class commons and drops the rest.
const SYMBOL_RE = /^[A-Z]{1,5}(-[AB])?$/;

// Instruments whose *name* gives them away, regardless of ticker shape.
const NAME_BLOCKLIST =
  /\b(depositary|preferred|pfd|debenture|notes?\s+due|subordinated|trust\s+preferred|warrant|units?|rights?|capital\s+funding|escrow|liquidating)\b/i;

// Sectors that are not operating companies.
const SECTOR_BLOCKLIST = /shell\s+companies|blank\s+check/i;

async function main() {
  const seen = new Map();

  for (const exchange of EXCHANGES) {
    const rows = await fmp('company-screener', {
      exchange,
      marketCapMoreThan: MIN_MARKET_CAP,
      isEtf: false,
      isFund: false,
      isActivelyTrading: true,
      limit: 5000,
    });
    console.log(`  ${exchange}: ${rows.length} rows`);
    for (const r of rows) seen.set(r.symbol, { ...r, exchange });
  }

  const raw = [...seen.values()];
  const rejected = { symbol: 0, name: 0, sector: 0, price: 0 };

  const filtered = raw.filter((r) => {
    if (!SYMBOL_RE.test(r.symbol)) return (rejected.symbol++, false);
    if (NAME_BLOCKLIST.test(r.companyName || '')) return (rejected.name++, false);
    const cls = `${r.sector || ''} ${r.industry || ''}`;
    if (SECTOR_BLOCKLIST.test(cls)) return (rejected.sector++, false);
    // A $1 floor only removes true penny names; large-cap ADRs such as ABEV
    // and WIT legitimately trade in low single digits, so no $5 floor here.
    if (!(r.price > 1)) return (rejected.price++, false);
    return true;
  });

  filtered.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  const candidates = filtered.slice(0, CANDIDATE_POOL).map((r) => ({
    symbol: r.symbol,
    name: r.companyName,
    exchange: r.exchange,
    sector: r.sector || 'Unknown',
    industry: r.industry || 'Unknown',
    country: r.country || 'US',
    marketCap: r.marketCap,
    beta: r.beta ?? null,
  }));

  mkdirSync('data', { recursive: true });
  writeFileSync('data/candidates.json', JSON.stringify(candidates, null, 2));

  console.log(`\n  screened ${raw.length} -> ${filtered.length} after filters`);
  console.log(`  rejected: ${JSON.stringify(rejected)}`);
  console.log(`  wrote ${candidates.length} candidates to data/candidates.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
