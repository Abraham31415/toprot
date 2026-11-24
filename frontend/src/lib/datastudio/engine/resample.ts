// Principal component analysis on the correlation matrix, and resampling methods (bootstrap confidence intervals, permutation tests)
// driven by a seeded generator so every result can be reproduced exactly from the seed stored with it.

import { chi2Sf, normCdf, normPpf } from "@/lib/stats/dist";
import { AnalysisError } from "./common";
import { symInverse, type Mat } from "./linalg";

/**
 * mulberry32: a small, fast 32-bit generator with good statistical quality for resampling. Returns uniform numbers in [0, 1).
 * The Python reference generator ports it bit for bit, so bootstrap and permutation results are checked exactly.
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantile with linear interpolation (R type 7, NumPy default). x must be sorted. */
export function quantileSorted(x: number[], q: number): number {
  const h = (x.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return x[lo] + (h - lo) * (x[hi] - x[lo]);
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
export function median(x: number[]): number { const s = [...x].sort((a, b) => a - b); return quantileSorted(s, 0.5); }

// --- PCA ----------------------------------------------------------------------------------------------------------------------------

/** Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations. Eigenvalues descending; vectors are the columns of `vectors`. */
export function symEigen(A: Mat): { values: number[]; vectors: Mat } {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v: Mat = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  const order = a.map((r, i) => [r[i], i] as const).sort((x, y) => y[0] - x[0]);
  return { values: order.map(([val]) => val), vectors: v.map((row) => order.map(([, i]) => row[i])) };
}

/**
 * PCA of standardized variables (the correlation matrix). Loadings are eigenvector x sqrt(eigenvalue), i.e. the correlation between each
 * variable and each component; the sign of each component is fixed so that its largest loading is positive. Also returns Bartlett's
 * test of sphericity and the Kaiser-Meyer-Olkin measure of sampling adequacy.
 */
export function pca(rows: number[][]) {
  const n = rows.length, k = rows[0]?.length ?? 0;
  if (k < 2) throw new AnalysisError("PCA needs at least two variables.");
  if (n < k + 1) throw new AnalysisError(`PCA of ${k} variables needs more than ${k} complete observations; only ${n} are available.`);
  const cols = Array.from({ length: k }, (_, j) => rows.map((r) => r[j]));
  const means = cols.map(mean);
  const sds = cols.map((c, j) => Math.sqrt(c.reduce((s, v) => s + (v - means[j]) ** 2, 0) / (n - 1)));
  const zero = sds.findIndex((s) => !(s > 0));
  if (zero >= 0) throw new AnalysisError(`Variable ${zero + 1} is constant, so it cannot be standardized.`);
  const Z = cols.map((c, j) => c.map((v) => (v - means[j]) / sds[j]));
  const R: Mat = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => Z[a].reduce((s, v, i) => s + v * Z[b][i], 0) / (n - 1)));
  const { values, vectors } = symEigen(R);
  const vec = vectors.map((r) => r.slice());
  for (let c = 0; c < k; c++) {
    let big = 0;
    for (let r = 0; r < k; r++) if (Math.abs(vec[r][c]) > Math.abs(vec[big][c])) big = r;
    if (vec[big][c] < 0) for (let r = 0; r < k; r++) vec[r][c] = -vec[r][c];
  }
  const total = values.reduce((s, v) => s + v, 0);
  const loadings = vec.map((r) => r.map((v, c) => v * Math.sqrt(Math.max(0, values[c]))));
  // Bartlett's test of sphericity and KMO need the determinant and inverse of R.
  const logDet = values.reduce((s, v) => s + Math.log(Math.max(v, 1e-300)), 0);
  const bartlett = -(n - 1 - (2 * k + 5) / 6) * logDet, bDf = (k * (k - 1)) / 2;
  const inv = symInverse(R);
  let kmo = NaN;
  if (!inv.aliased.length) {
    let r2 = 0, a2 = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) if (a !== b) { r2 += R[a][b] ** 2; a2 += (-inv.inv[a][b] / Math.sqrt(inv.inv[a][a] * inv.inv[b][b])) ** 2; }
    kmo = r2 / (r2 + a2);
  }
  return { n, k, R, eigenvalues: values, vectors: vec, loadings, explained: values.map((v) => v / total), bartlett, bartlettDf: bDf, bartlettP: chi2Sf(bartlett, bDf), kmo, singular: values[k - 1] < 1e-10 };
}

// --- Bootstrap ----------------------------------------------------------------------------------------------------------------------

export type BootStat = "mean" | "median";
const statFn = (s: BootStat) => (s === "mean" ? mean : median);

/**
 * Nonparametric bootstrap of the mean or median: B resamples of size n drawn with replacement using mulberry32(seed) (index =
 * floor(u * n)). Returns the percentile interval and the bias-corrected and accelerated (BCa) interval (Efron 1987; jackknife
 * acceleration, as SciPy's bootstrap).
 */
export function bootstrapCi(x: number[], stat: BootStat, B: number, seed: number, conf = 0.95) {
  const n = x.length;
  if (n < 3) throw new AnalysisError("The bootstrap needs at least three observations.");
  const fn = statFn(stat);
  const rand = mulberry32(seed);
  const reps = new Array<number>(B);
  const buf = new Array<number>(n);
  for (let b = 0; b < B; b++) { for (let i = 0; i < n; i++) buf[i] = x[Math.floor(rand() * n)]; reps[b] = fn(buf); }
  const est = fn(x);
  const sorted = [...reps].sort((a, b) => a - b);
  const alpha = (1 - conf) / 2;
  const percentile = [quantileSorted(sorted, alpha), quantileSorted(sorted, 1 - alpha)] as [number, number];
  // BCa
  // Proportion below the estimate, counting ties as half (SciPy's percentile-of-score convention).
  const below = reps.filter((v) => v < est).length + reps.filter((v) => v <= est).length;
  const z0 = normPpf(below / (2 * B));
  const jack = x.map((_, i) => fn(x.filter((_, k) => k !== i)));
  const jm = mean(jack);
  const num = jack.reduce((s, v) => s + (jm - v) ** 3, 0), den = 6 * jack.reduce((s, v) => s + (jm - v) ** 2, 0) ** 1.5;
  const acc = den > 0 ? num / den : 0;
  const adj = (zq: number) => normCdf(z0 + (z0 + zq) / (1 - acc * (z0 + zq)));
  let bca: [number, number] | null = null;
  if (Number.isFinite(z0)) {
    const a1 = adj(normPpf(alpha)), a2 = adj(normPpf(1 - alpha));
    if (Number.isFinite(a1) && Number.isFinite(a2)) bca = [quantileSorted(sorted, a1), quantileSorted(sorted, a2)];
  }
  const bm = mean(reps);
  const se = Math.sqrt(reps.reduce((s, v) => s + (v - bm) ** 2, 0) / (B - 1));
  return { estimate: est, se, bias: bm - est, percentile, bca, z0, acceleration: acc, B, seed, reps };
}

// --- Permutation test ---------------------------------------------------------------------------------------------------------------

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx;
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}
function choose(n: number, k: number): number { let r = 1; for (let i = 1; i <= k; i++) { r = (r * (n - k + i)) / i; if (r > 1e12) return Infinity; } return Math.round(r); }

/**
 * Two-sided permutation test for a difference in means (group A minus group B), p = proportion of relabelled differences at least
 * as extreme in absolute value as the observed one. Uses every relabelling when there are at most `maxExact` of them; otherwise B
 * random relabellings (Fisher-Yates shuffles with mulberry32(seed)) and p = (count + 1) / (B + 1), which keeps the test valid.
 */
export function permutationTest(a: number[], b: number[], B: number, seed: number, maxExact = 100000) {
  const na = a.length, nb = b.length, n = na + nb;
  if (na < 2 || nb < 2) throw new AnalysisError("Each group needs at least two observations for a permutation test.");
  const all = [...a, ...b];
  const total = all.reduce((s, v) => s + v, 0);
  const diffOf = (sumA: number) => sumA / na - (total - sumA) / nb;
  const obs = mean(a) - mean(b);
  const tol = 1e-9 * Math.max(1, Math.abs(obs));
  const nComb = choose(n, na);
  if (nComb <= maxExact) {
    let count = 0, cnt = 0;
    for (const c of combinations(n, na)) { let s = 0; for (const i of c) s += all[i]; if (Math.abs(diffOf(s)) >= Math.abs(obs) - tol) count++; cnt++; }
    return { observed: obs, p: count / cnt, exact: true, permutations: cnt, count, seed };
  }
  const rand = mulberry32(seed);
  const perm = all.slice();
  let count = 0;
  for (let r = 0; r < B; r++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    let s = 0;
    for (let i = 0; i < na; i++) s += perm[i];
    if (Math.abs(diffOf(s)) >= Math.abs(obs) - tol) count++;
  }
  return { observed: obs, p: (count + 1) / (B + 1), exact: false, permutations: B, count, seed };
}
