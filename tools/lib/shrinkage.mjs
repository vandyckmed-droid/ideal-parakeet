// Ledoit-Wolf shrinkage of the sample correlation matrix, and the correlation
// distance the grouping is built on.
//
// Reference: Ledoit & Wolf (2004), "Honey, I Shrunk the Sample Covariance
// Matrix", J. Portfolio Management. The target is their constant-correlation
// model: keep every variance, replace every correlation with the average one.
//
// WHY SHRINK AT ALL. With ~500 names and ~500 daily observations the sample
// correlation matrix is at the edge of (and often past) the point where it can
// be trusted pairwise: the noisiest entries are the extreme ones, so the most
// correlated-looking pairs are disproportionately the ones whose correlation
// was overestimated. Clustering on raw sample correlations chases exactly that
// noise. Shrinkage pulls every estimate toward the average by an amount chosen
// to minimise expected squared error, which is precisely the right correction
// for a procedure that will act on the extremes.
//
// THE CONVENIENT COLLAPSE. The shrunk covariance is d*F + (1-d)*S. Because the
// constant-correlation target keeps the sample variances (f_ii = s_ii), the
// shrunk diagonal equals the sample diagonal, and the shrunk *correlation*
// reduces to a plain linear pull of each sample correlation toward the mean:
//
//     rho_ij = d * rbar + (1 - d) * r_ij
//
// So the whole estimator, once the intensity is known, is one line. The work
// below is all in computing the intensity honestly.

/**
 * Sample statistics needed by the shrinkage intensity, in one pass per pair.
 *
 * For a pair (i,j) write z_t = y_it * y_jt for demeaned returns y. Then
 *   s_ij  = mean(z)
 *   pi_ij = var(z)                      = mean(z^2) - s_ij^2
 *   th_ii = cov(y_i^2, z)               = mean(y_i^2 z) - s_ii * s_ij
 *   th_jj = cov(y_j^2, z)               = mean(y_j^2 z) - s_jj * s_ij
 * all of which come from four running sums, so the O(N^2 T) sweep is done
 * once rather than once per quantity.
 */
export function ledoitWolfCorrelation(returns, n, t) {
  // returns: Float64Array, row-major n x t, one row per name.
  const y = new Float64Array(n * t); // demeaned
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < t; k++) sum += returns[i * t + k];
    const mean = sum / t;
    for (let k = 0; k < t; k++) y[i * t + k] = returns[i * t + k] - mean;
  }

  // Squared demeaned returns, reused by every pair this name takes part in.
  const yy = new Float64Array(n * t);
  for (let p = 0; p < n * t; p++) yy[p] = y[p] * y[p];

  // Variances (LW use the 1/T convention throughout, not Bessel's 1/(T-1) -
  // the asymptotics behind the intensity are derived that way).
  const s = new Float64Array(n); // s_ii
  const sd = new Float64Array(n); // sqrt(s_ii)
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < t; k++) sum += yy[i * t + k];
    s[i] = sum / t;
    sd[i] = Math.sqrt(s[i]);
  }

  // Diagonal contribution to pi: pi_ii = var(y_i^2) = mean(y_i^4) - s_ii^2.
  // rho's diagonal term is exactly this same sum, so both start here.
  let piHat = 0;
  for (let i = 0; i < n; i++) {
    let sum4 = 0;
    for (let k = 0; k < t; k++) {
      const v = yy[i * t + k];
      sum4 += v * v;
    }
    piHat += sum4 / t - s[i] * s[i];
  }
  let rhoHat = piHat; // sum_i pi_ii

  const m = (n * (n - 1)) / 2;
  const corr = new Float64Array(m); // sample correlation, upper triangle
  const cov = new Float64Array(m); // sample covariance, upper triangle

  // First sweep: sample covariance, so rbar (and therefore the target) is
  // known before the misspecification term is accumulated.
  let idx = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++, idx++) {
      let sum = 0;
      for (let k = 0; k < t; k++) sum += y[i * t + k] * y[j * t + k];
      const sij = sum / t;
      cov[idx] = sij;
      corr[idx] = sij / (sd[i] * sd[j]);
    }
  }

  let rbar = 0;
  for (let p = 0; p < m; p++) rbar += corr[p];
  rbar /= m;

  // Second sweep: pi (estimation variance), gamma (target misspecification)
  // and rho's off-diagonal term (covariance between the sample entries and
  // the target's own sampling error - the piece a naive derivation forgets,
  // and the reason the intensity is not simply pi/gamma).
  let gammaHat = 0;
  idx = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++, idx++) {
      const sij = cov[idx];
      let sumZ2 = 0;
      let sumIiZ = 0;
      let sumJjZ = 0;
      for (let k = 0; k < t; k++) {
        const z = y[i * t + k] * y[j * t + k];
        sumZ2 += z * z;
        sumIiZ += yy[i * t + k] * z;
        sumJjZ += yy[j * t + k] * z;
      }
      const piIj = sumZ2 / t - sij * sij;
      const thIi = sumIiZ / t - s[i] * sij;
      const thJj = sumJjZ / t - s[j] * sij;

      const fij = rbar * sd[i] * sd[j];
      const gij = fij - sij;

      // Every ordered pair counts, and (j,i) contributes the same as (i,j)
      // for each of these - z is symmetric in i and j - so one pass over the
      // upper triangle doubled is the full double sum.
      piHat += 2 * piIj;
      gammaHat += 2 * gij * gij;
      rhoHat += rbar * ((sd[j] / sd[i]) * thIi + (sd[i] / sd[j]) * thJj);
    }
  }

  // kappa = (pi - rho) / gamma; intensity = kappa / T, clamped to [0,1].
  // gamma == 0 means the sample already IS the constant-correlation target,
  // in which case shrinking is a no-op either way.
  const kappa = gammaHat > 0 ? (piHat - rhoHat) / gammaHat : 0;
  const intensity = Math.max(0, Math.min(1, kappa / t));

  const shrunk = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const v = intensity * rbar + (1 - intensity) * corr[p];
    shrunk[p] = v > 1 ? 1 : v < -1 ? -1 : v;
  }

  return { correlation: shrunk, intensity, averageCorrelation: rbar, observations: t };
}

/**
 * Correlation to distance: d = sqrt((1 - rho) / 2).
 *
 * This is a true metric on the unit sphere (it is the chord distance between
 * standardised return vectors), so "close" composes the way a clustering
 * algorithm assumes: identical names sit at 0, uncorrelated at ~0.707,
 * perfectly opposed at 1.
 */
export function correlationDistance(rho) {
  return Math.sqrt(Math.max(0, (1 - rho) / 2));
}

/**
 * Pack the upper triangle as one byte per pair.
 *
 * Distance lives in [0,1] by construction, so a byte holds it to ~0.004. That
 * is deliberately generous where it matters: d is steepest in rho near rho=1,
 * so a uniform grid in d resolves the highly-correlated pairs - the ones that
 * decide a grouping - far more finely than a uniform grid in rho would. One
 * step at the top end separates rho=1 from rho=0.99997.
 */
export function packDistances(correlation) {
  const bytes = new Uint8Array(correlation.length);
  for (let p = 0; p < correlation.length; p++) {
    const d = correlationDistance(correlation[p]);
    bytes[p] = Math.max(0, Math.min(255, Math.round(d * 255)));
  }
  return bytes;
}

/** Index of pair (i,j), i < j, in a packed upper triangle of n items. */
export function pairIndex(i, j, n) {
  return (i * (2 * n - i - 1)) / 2 + (j - i - 1);
}
