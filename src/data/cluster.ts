/**
 * Balanced constrained k-medoids on the shrunk correlation distances.
 *
 * Plain k-medoids would answer "what groups exist" by producing two enormous
 * blobs and a scattering of singletons, because that genuinely is the shape of
 * equity correlation - almost everything loads on one market factor. That is a
 * true answer and a useless one. Constraining every group to within +/-20% of
 * N/K forces the algorithm to spend its resolution on the *structure between*
 * names rather than rediscovering the market factor, which is the thing the
 * view exists to show.
 *
 * The size constraint is a hard requirement, not a penalty: the assignment
 * step below cannot return an infeasible solution. What it costs is that some
 * names end up in a group they do not really belong to - which is exactly
 * what the weak-fit flag on the detail page is for.
 */

export type Cluster = {
  /** An actual member, the one minimising total distance inside the group. */
  medoid: number;
  /** Matrix indices, sorted by average correlation with the rest, best first. */
  members: number[];
  /** Per member, in `members` order: mean correlation with the rest of the group. */
  fit: number[];
  /**
   * Per member: true when the name sits closer to some other group than to
   * its own (a negative silhouette). With balanced sizes this is not a bug
   * report, it is the visible price of the balance constraint.
   */
  weak: boolean[];
  /**
   * Per member, when weak: the medoid of the group it sits closer to, so the
   * flag says where the name would rather be instead of only that it is
   * uncomfortable. -1 when the member is not flagged.
   */
  prefers: number[];
};

export type Grouping = {
  clusters: Cluster[];
  /** Sum of every member's distance to its own medoid - the objective. */
  cost: number;
  /** Target size N/K, and the bounds actually enforced. */
  target: number;
  lower: number;
  upper: number;
};

type Distance = (i: number, j: number) => number;

/**
 * Deterministic PRNG. The grouping must be reproducible: the same K has to
 * give the same answer on every launch and on both builds, or the view would
 * quietly reshuffle underneath the user and the two builds could not be
 * checked against each other.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** k-medoids++ seeding: spread the initial medoids by squared distance. */
function seedMedoids(n: number, k: number, d: Distance, rnd: () => number): number[] {
  const medoids = [Math.floor(rnd() * n) % n];
  const best = new Float64Array(n);
  for (let i = 0; i < n; i++) best[i] = d(i, medoids[0]);

  while (medoids.length < k) {
    let total = 0;
    for (let i = 0; i < n; i++) total += best[i] * best[i];
    let pick = -1;
    if (total <= 0) {
      // Every remaining point coincides with a medoid; take the first unused.
      for (let i = 0; i < n && pick < 0; i++) if (!medoids.includes(i)) pick = i;
    } else {
      let r = rnd() * total;
      for (let i = 0; i < n; i++) {
        r -= best[i] * best[i];
        if (r <= 0) { pick = i; break; }
      }
      if (pick < 0) pick = n - 1;
    }
    if (medoids.includes(pick)) {
      for (let i = 0; i < n; i++) if (!medoids.includes(i)) { pick = i; break; }
    }
    medoids.push(pick);
    for (let i = 0; i < n; i++) {
      const dv = d(i, pick);
      if (dv < best[i]) best[i] = dv;
    }
  }
  return medoids;
}

/**
 * Assign every point to a medoid subject to L <= size <= U.
 *
 * Greedy by preference margin, then repair. Points are served in order of how
 * much they care - the gap between their best and second-best medoid - so the
 * names with a clear home claim it before the capacity is gone, and the ones
 * that are nearly indifferent absorb the compromise. The repair pass then
 * moves the cheapest-to-move points into any group still short of L, so the
 * result is always feasible.
 */
function constrainedAssign(
  n: number, medoids: number[], lower: number, upper: number, d: Distance
): Int32Array {
  const k = medoids.length;
  const dist = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < k; c++) dist[i * k + c] = d(i, medoids[c]);
  }

  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const margin = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let bestV = Infinity;
    let secondV = Infinity;
    for (let c = 0; c < k; c++) {
      const v = dist[i * k + c];
      if (v < bestV) { secondV = bestV; bestV = v; }
      else if (v < secondV) secondV = v;
    }
    margin[i] = (secondV === Infinity ? 0 : secondV) - bestV;
  }
  // Descending margin; index breaks ties so the result cannot depend on sort
  // stability across engines.
  const sorted = Array.from(order).sort((a, b) => margin[b] - margin[a] || a - b);

  const assign = new Int32Array(n).fill(-1);
  const size = new Int32Array(k);
  for (const i of sorted) {
    let pick = -1;
    let bestV = Infinity;
    for (let c = 0; c < k; c++) {
      if (size[c] >= upper) continue;
      const v = dist[i * k + c];
      if (v < bestV) { bestV = v; pick = c; }
    }
    if (pick < 0) { // every group full: drop into the least-bad one
      for (let c = 0; c < k; c++) {
        const v = dist[i * k + c];
        if (v < bestV) { bestV = v; pick = c; }
      }
    }
    assign[i] = pick;
    size[pick]++;
  }

  // Repair: fill anything below L with the points that mind least.
  for (;;) {
    let needy = -1;
    for (let c = 0; c < k; c++) if (size[c] < lower) { needy = c; break; }
    if (needy < 0) break;

    let bestPoint = -1;
    let bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      const from = assign[i];
      if (from === needy || size[from] <= lower) continue;
      const cost = dist[i * k + needy] - dist[i * k + from];
      if (cost < bestCost || (cost === bestCost && i < bestPoint)) {
        bestCost = cost;
        bestPoint = i;
      }
    }
    if (bestPoint < 0) break; // cannot happen while K*L <= N, but never loop forever
    size[assign[bestPoint]]--;
    assign[bestPoint] = needy;
    size[needy]++;
  }

  // Local improvement on the constrained objective: moves that keep both
  // groups legal, then swaps, which never change a size and so are always
  // legal. Bounded passes - this is polish on top of the greedy, not the
  // search itself.
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      const from = assign[i];
      if (size[from] <= lower) continue;
      let pick = -1;
      let bestGain = 1e-12;
      for (let c = 0; c < k; c++) {
        if (c === from || size[c] >= upper) continue;
        const gain = dist[i * k + from] - dist[i * k + c];
        if (gain > bestGain) { bestGain = gain; pick = c; }
      }
      if (pick >= 0) {
        size[from]--; assign[i] = pick; size[pick]++; improved = true;
      }
    }
    // Swaps never change a size, so they are always legal. The gain of
    // exchanging i (in group a) with j (in group b) separates into one term
    // per point - (d[i,a] - d[i,b]) + (d[j,b] - d[j,a]) - so the best swap
    // between two groups is the best point on each side, found in one linear
    // scan of each. Sweeping every pair of *points* instead cost 4.2M
    // comparisons a pass on 499 names, ~17M over a full solve, and that alone
    // was seconds of blocked JS on a phone. By group pair it is ~9.5k.
    const members: number[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) members[assign[i]].push(i);
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        // Ties break on the lower index, so neither answer depends on the
        // order the member lists happen to be in after an earlier swap.
        let bi = -1;
        let gi = -Infinity;
        for (const i of members[a]) {
          const g = dist[i * k + a] - dist[i * k + b];
          if (g > gi || (g === gi && i < bi)) { gi = g; bi = i; }
        }
        let bj = -1;
        let gj = -Infinity;
        for (const j of members[b]) {
          const g = dist[j * k + b] - dist[j * k + a];
          if (g > gj || (g === gj && j < bj)) { gj = g; bj = j; }
        }
        if (bi < 0 || bj < 0 || gi + gj <= 1e-12) continue;
        assign[bi] = b;
        assign[bj] = a;
        // Exactly one point crosses each way, so the two member lists stay
        // the right size; patch them in place rather than rebuilding.
        members[a][members[a].indexOf(bi)] = bj;
        members[b][members[b].indexOf(bj)] = bi;
        improved = true;
      }
    }
    if (!improved) break;
  }

  return assign;
}

/** Member of `members` minimising total distance to the rest of the group. */
function bestMedoid(members: number[], d: Distance): number {
  let best = members[0];
  let bestTotal = Infinity;
  for (const cand of members) {
    let total = 0;
    for (const other of members) total += d(cand, other);
    if (total < bestTotal - 1e-15 || (Math.abs(total - bestTotal) <= 1e-15 && cand < best)) {
      bestTotal = total;
      best = cand;
    }
  }
  return best;
}

function totalCost(assign: Int32Array, medoids: number[], d: Distance): number {
  let cost = 0;
  for (let i = 0; i < assign.length; i++) cost += d(i, medoids[assign[i]]);
  return cost;
}

const MAX_ITERATIONS = 24;
const RESTARTS = 8;

/**
 * Cluster `n` points into `k` balanced groups.
 *
 * Several initialisations, lowest total distance wins - k-medoids is a local
 * search and a single run lands wherever its seeding pointed it.
 */
export function balancedKMedoids(
  n: number, k: number, d: Distance, sizeTolerance = 0.2
): Grouping {
  const target = n / k;
  let lower = Math.max(1, Math.floor((1 - sizeTolerance) * target));
  let upper = Math.max(lower, Math.ceil((1 + sizeTolerance) * target));
  // The bounds have to be able to hold everyone, and to be reachable at all.
  if (lower * k > n) lower = Math.floor(n / k);
  if (upper * k < n) upper = Math.ceil(n / k);

  let bestAssign: Int32Array | null = null;
  let bestMedoids: number[] = [];
  let bestCost = Infinity;

  for (let restart = 0; restart < RESTARTS; restart++) {
    const rnd = mulberry32(0x9e3779b9 ^ (restart * 2654435761) ^ (k * 40503));
    let medoids = seedMedoids(n, k, d, rnd);
    let assign = constrainedAssign(n, medoids, lower, upper, d);

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const buckets: number[][] = Array.from({ length: k }, () => []);
      for (let i = 0; i < n; i++) buckets[assign[i]].push(i);
      const next = buckets.map((members, c) =>
        members.length ? bestMedoid(members, d) : medoids[c]
      );
      let stable = true;
      for (let c = 0; c < k; c++) if (next[c] !== medoids[c]) { stable = false; break; }
      medoids = next;
      const reassigned = constrainedAssign(n, medoids, lower, upper, d);
      let same = true;
      for (let i = 0; i < n; i++) if (reassigned[i] !== assign[i]) { same = false; break; }
      assign = reassigned;
      if (stable && same) break;
    }

    const cost = totalCost(assign, medoids, d);
    if (cost < bestCost) {
      bestCost = cost;
      bestAssign = assign;
      bestMedoids = medoids;
    }
  }

  const assign = bestAssign as Int32Array;
  const buckets: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) buckets[assign[i]].push(i);

  // Per-member fit: average correlation with the rest of the group, and the
  // silhouette sign that says whether some other group would have taken it.
  const clusters: Cluster[] = buckets.map((members, c) => {
    const own = new Float64Array(members.length);
    const weak: boolean[] = [];
    const prefers: number[] = [];
    for (let m = 0; m < members.length; m++) {
      const i = members[m];
      let sum = 0;
      for (const j of members) if (j !== i) sum += d(i, j);
      own[m] = members.length > 1 ? sum / (members.length - 1) : 0;

      let bestOther = Infinity;
      let bestOtherCluster = -1;
      for (let o = 0; o < buckets.length; o++) {
        if (o === c || buckets[o].length === 0) continue;
        let s = 0;
        for (const j of buckets[o]) s += d(i, j);
        const avg = s / buckets[o].length;
        if (avg < bestOther) { bestOther = avg; bestOtherCluster = o; }
      }
      const isWeak = members.length > 1 && bestOther < own[m];
      weak.push(isWeak);
      prefers.push(isWeak ? bestMedoids[bestOtherCluster] : -1);
    }

    const order = members
      .map((_, m) => m)
      .sort((a, b) => own[a] - own[b] || members[a] - members[b]);

    return {
      medoid: bestMedoids[c],
      members: order.map((m) => members[m]),
      // Distance back to correlation happens at the display layer; keep the
      // mean *distance* here so the ordering is on the measured quantity.
      fit: order.map((m) => own[m]),
      weak: order.map((m) => weak[m]),
      prefers: order.map((m) => prefers[m]),
    };
  });

  // Biggest groups first is meaningless here (they are all the same size by
  // construction); tightest first is not, so order by mean internal distance.
  clusters.sort((a, b) => {
    const am = a.fit.reduce((x, y) => x + y, 0) / Math.max(1, a.fit.length);
    const bm = b.fit.reduce((x, y) => x + y, 0) / Math.max(1, b.fit.length);
    return am - bm || a.medoid - b.medoid;
  });

  return { clusters, cost: bestCost, target, lower, upper };
}
