// Thin client for the Financial Modeling Prep "stable" API.
// The legacy /api/v3 endpoints are dead for keys issued after 2025-08-31.

const BASE = 'https://financialmodelingprep.com/stable';

export const API_KEY = process.env.API_KEY || process.env.FMP_API_KEY;
if (!API_KEY) {
  console.error('Missing API_KEY (or FMP_API_KEY) in the environment.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a stable-API endpoint with retry on transport errors and 429/5xx.
 * FMP signals errors both by status code and by a JSON body carrying an
 * "Error Message" key, so both are treated as retryable failures.
 */
export async function fmp(path, params = {}, { retries = 5 } = {}) {
  const qs = new URLSearchParams({ ...params, apikey: API_KEY });
  const url = `${BASE}/${path}?${qs}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(2 ** attempt * 500, 16000));
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);

      const body = await res.json();
      if (body && !Array.isArray(body) && body['Error Message']) {
        throw new Error(`FMP: ${body['Error Message']}`);
      }
      return body;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Run `worker` over `items` with bounded concurrency, preserving order. */
export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run)
  );
  return results;
}

/** Single-line progress that does not spam CI logs. */
export function progress(label, done, total) {
  const pct = ((done / total) * 100).toFixed(0);
  const line = `  ${label}: ${done}/${total} (${pct}%)`;
  if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
  else if (done === total || done % 100 === 0) console.log(line);
  if (done === total && process.stdout.isTTY) process.stdout.write('\n');
}
