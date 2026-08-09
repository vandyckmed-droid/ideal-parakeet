import { GROUPING_RAW, RawGrouping } from './market';

/**
 * The shrunk correlation distances the grouping is built on, unpacked from
 * the byte array the pipeline ships in `market.json`.
 *
 * Only names with a complete return history over the correlation window are
 * in here. A name that listed part-way through cannot be correlated against
 * the rest over that window, and inventing a shorter window for it would make
 * its distances mean something different from everyone else's - so recent
 * listings are simply ungrouped, and the app says so rather than hiding them.
 */

const RAW: RawGrouping | undefined = GROUPING_RAW;

/**
 * Base64 by hand rather than `atob` or `Buffer`: neither is reliably present
 * across the two runtimes this ships to, and the payload is one flat byte
 * array, so a table lookup is the whole job.
 */
function decodeBase64(input: string): Uint8Array {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < CHARS.length; i++) lookup[CHARS.charCodeAt(i)] = i;

  let padding = 0;
  while (padding < 2 && input.charCodeAt(input.length - 1 - padding) === 61) padding++;
  const bytes = new Uint8Array((input.length / 4) * 3 - padding);

  let out = 0;
  for (let i = 0; i < input.length; i += 4) {
    const a = lookup[input.charCodeAt(i)];
    const b = lookup[input.charCodeAt(i + 1)];
    const c = lookup[input.charCodeAt(i + 2)];
    const d = lookup[input.charCodeAt(i + 3)];
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (out < bytes.length) bytes[out++] = (chunk >> 16) & 0xff;
    if (out < bytes.length) bytes[out++] = (chunk >> 8) & 0xff;
    if (out < bytes.length) bytes[out++] = chunk & 0xff;
  }
  return bytes;
}

export const GROUP_SYMBOLS: string[] = RAW ? RAW.symbols : [];
export const GROUPABLE = GROUP_SYMBOLS.length;

const PACKED: Uint8Array = RAW ? decodeBase64(RAW.distances) : new Uint8Array(0);

export const GROUPING_META = {
  sessions: RAW ? RAW.sessions : 0,
  from: RAW ? RAW.from : '',
  to: RAW ? RAW.to : '',
  /** Ledoit-Wolf intensity: 0 keeps the sample matrix, 1 is the flat target. */
  shrinkage: RAW ? RAW.shrinkage : 0,
  averageCorrelation: RAW ? RAW.averageCorrelation : 0,
};

/** Matrix row for a symbol, or -1 when the name could not be grouped. */
const INDEX_OF = new Map<string, number>();
GROUP_SYMBOLS.forEach((s, i) => INDEX_OF.set(s, i));
export function groupIndexOf(symbol: string): number {
  const i = INDEX_OF.get(symbol);
  return i === undefined ? -1 : i;
}

/** Position of pair (i,j), i < j, in the packed upper triangle. */
function pairIndex(i: number, j: number): number {
  return (i * (2 * GROUPABLE - i - 1)) / 2 + (j - i - 1);
}

/** Shrunk correlation distance between two matrix rows. Zero on the diagonal. */
export function distance(i: number, j: number): number {
  if (i === j) return 0;
  const p = i < j ? pairIndex(i, j) : pairIndex(j, i);
  return PACKED[p] / 255;
}

/**
 * Back out the correlation the distance came from: d = sqrt((1-rho)/2), so
 * rho = 1 - 2d^2. Used for the human-facing "average correlation with the
 * rest of the group" figure, where a correlation reads far better than a
 * chord distance does.
 */
export function correlationFromDistance(d: number): number {
  return 1 - 2 * d * d;
}
