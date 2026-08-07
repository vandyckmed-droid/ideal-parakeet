// Deep price history, for factor research only - never bundled into the app.
//
// The shipped snapshot carries two years, which is the right size for a phone
// and far too short to test a twelve-month holding period: it leaves barely
// one independent formation period. This pulls ~16 years so a factor test has
// something to say.
//
// Same call count as the app's own price stage (the endpoint takes a date
// range), written to data/research-prices/ and gitignored.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fmp, mapPool, progress } from './../lib/fmp.mjs';

const FROM = '2010-01-01';
const CONCURRENCY = 8;

async function main() {
  const ds = JSON.parse(readFileSync('assets/data/market.json', 'utf8'));
  const symbols = ds.tickers.map((t) => t.s);
  mkdirSync('data/research-prices', { recursive: true });

  const to = new Date().toISOString().slice(0, 10);
  const force = process.argv.includes('--force');
  let done = 0;
  const failed = [];

  console.log(`  fetching ${symbols.length} symbols, ${FROM} -> ${to}`);

  await mapPool(symbols, CONCURRENCY, async (symbol) => {
    const path = `data/research-prices/${symbol}.json`;
    if (!force && existsSync(path)) { progress('deep', ++done, symbols.length); return; }
    try {
      const rows = await fmp('historical-price-eod/dividend-adjusted', { symbol, from: FROM, to });
      const bars = (Array.isArray(rows) ? rows : [])
        .filter((r) => r.date && Number.isFinite(r.adjClose) && r.adjClose > 0)
        .map((r) => [r.date, r.adjClose])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
      writeFileSync(path, JSON.stringify(bars));
    } catch (err) {
      failed.push({ symbol, error: String(err.message || err) });
    }
    progress('deep', ++done, symbols.length);
  });

  if (failed.length) console.log(`\n  ${failed.length} failed:`, failed.slice(0, 5).map((f) => f.symbol).join(', '));
  console.log(`\n  done: ${symbols.length - failed.length}/${symbols.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
