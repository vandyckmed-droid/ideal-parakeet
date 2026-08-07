// Reconstruct point-in-time S&P 500 membership, and fetch prices for every
// name that was ever a member - including the ones that were removed.
//
// This is the fix for the bias that makes the other factor test unusable.
// Testing on today's 500 largest is testing on winners: that set returned an
// average 1,489% since 2010 against roughly 500-600% for the index itself, and
// the difference is selection, not skill. Anything that loaded on "was still
// large in 2026" would look predictive.
//
// Method: start from today's membership and walk the change log backwards.
// Each record says a name was added and another removed on a date, so undoing
// them in reverse order reproduces the roster as it stood.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fmp, mapPool, progress } from './../lib/fmp.mjs';

const FROM = '2010-01-01';
const CONCURRENCY = 8;

function buildTimeline() {
  const current = JSON.parse(readFileSync('data/sp500/current.json', 'utf8'));
  const changes = JSON.parse(readFileSync('data/sp500/changes.json', 'utf8'))
    .filter((c) => c.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  let members = new Set(current.map((c) => c.symbol).filter(Boolean));
  // Snapshots keyed by the date the roster changed, walking backwards.
  const snapshots = [{ date: '2999-12-31', members: new Set(members) }];

  for (const c of changes) {
    // Undo this change: whatever was added was not a member before it,
    // whatever was removed was.
    if (c.symbol) members.delete(c.symbol);
    if (c.removedTicker) members.add(c.removedTicker);
    snapshots.push({ date: c.date, members: new Set(members) });
  }
  snapshots.sort((a, b) => (a.date < b.date ? -1 : 1));
  return snapshots;
}

function main() {
  const snapshots = buildTimeline();
  mkdirSync('data/sp500', { recursive: true });
  writeFileSync(
    'data/sp500/timeline.json',
    JSON.stringify(snapshots.map((s) => ({ date: s.date, members: [...s.members] })))
  );

  const ever = new Set();
  for (const s of snapshots) for (const m of s.members) ever.add(m);
  ever.delete('');

  // Sanity: roster size should hover near 500 across the test window, not
  // drift. If it does drift the change log has gaps and nothing below is safe.
  console.log('  roster size at a few dates:');
  for (const probe of ['2010-01-04', '2014-01-02', '2018-01-02', '2022-01-03', '2026-01-02']) {
    let best = null;
    for (const s of snapshots) if (s.date <= probe) best = s;
    console.log(`    ${probe}  ${best ? best.members.size : 0} members`);
  }
  console.log(`  names ever in the index: ${ever.size}`);

  return [...ever];
}

const ever = main();

// --- fetch prices for the ones we do not already have ------------------------
const DIR = 'data/research-prices';
mkdirSync(DIR, { recursive: true });
const missing = ever.filter((s) => !existsSync(`${DIR}/${s}.json`));
console.log(`\n  ${missing.length} symbols not yet on disk; fetching`);

const to = new Date().toISOString().slice(0, 10);
let done = 0;
const failed = [];
await mapPool(missing, CONCURRENCY, async (symbol) => {
  try {
    const rows = await fmp('historical-price-eod/dividend-adjusted', { symbol, from: FROM, to });
    const bars = (Array.isArray(rows) ? rows : [])
      .filter((r) => r.date && Number.isFinite(r.adjClose) && r.adjClose > 0)
      .map((r) => [r.date, r.adjClose])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    writeFileSync(`${DIR}/${symbol}.json`, JSON.stringify(bars));
  } catch (err) {
    failed.push(symbol);
  }
  progress('pit-prices', ++done, missing.length);
});

console.log(`\n  fetched ${missing.length - failed.length}/${missing.length}`);
if (failed.length) console.log(`  no data for ${failed.length} (delisted long ago, or renamed): ${failed.slice(0, 12).join(', ')}`);
