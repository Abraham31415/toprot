// Dense linear algebra for model fitting. Matrices are arrays of rows. Sizes are small (p <= a few hundred), so clarity wins.

export type Mat = number[][];

export const zeros = (r: number, c: number): Mat => Array.from({ length: r }, () => new Array<number>(c).fill(0));
export const transpose = (A: Mat): Mat => (A.length ? A[0].map((_, j) => A.map((r) => r[j])) : []);

export function matmul(A: Mat, B: Mat): Mat {
  const n = A.length, m = B[0]?.length ?? 0, k = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let t = 0; t < k; t++) { const a = A[i][t]; if (a === 0) continue; const Bt = B[t]; const Ci = C[i]; for (let j = 0; j < m; j++) Ci[j] += a * Bt[j]; }
  return C;
}

/** X'WX for an n x p design (W diagonal, optional). */
export function crossprod(X: Mat, w?: number[]): Mat {
  const p = X[0]?.length ?? 0;
  const C = zeros(p, p);
  for (let i = 0; i < X.length; i++) {
    const r = X[i], wi = w ? w[i] : 1;
    for (let a = 0; a < p; a++) { const ra = r[a] * wi; if (ra === 0) continue; for (let b = a; b < p; b++) C[a][b] += ra * r[b]; }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) C[a][b] = C[b][a];
  return C;
}

export function matvec(A: Mat, x: number[]): number[] { return A.map((r) => r.reduce((s, v, j) => s + v * x[j], 0)); }
/** X'Wy */
export function crossvec(X: Mat, y: number[], w?: number[]): number[] {
  const p = X[0]?.length ?? 0;
  const out = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) { const wy = y[i] * (w ? w[i] : 1); for (let a = 0; a < p; a++) out[a] += X[i][a] * wy; }
  return out;
}

/**
 * Inverse of a symmetric positive (semi-)definite matrix by Gauss-Jordan elimination with a rank check. Columns whose pivot falls below
 * tol (relative to the matrix scale) are reported as aliased instead of producing an unstable inverse.
 */
export function symInverse(A: Mat, tol = 1e-10): { inv: Mat; aliased: number[] } {
  const n = A.length;
  const scale = Math.max(1e-300, ...A.map((r, i) => Math.abs(r[i])));
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const aliased: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  for (let c = 0; c < n; c++) {
    // Pivot on the diagonal to preserve the column identity (needed to name the aliased variable).
    const piv = M[c][c];
    if (!(Math.abs(piv) > tol * Math.max(scale, Math.abs(A[c][c])))) { aliased.push(c); continue; }
    used[c] = true;
    const inv = 1 / piv;
    for (let j = 0; j < 2 * n; j++) M[c][j] *= inv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return { inv: M.map((r) => r.slice(n)), aliased };
}

/** Detects exact (or numerically exact) collinearity: returns the indices of columns that are linear combinations of earlier ones. */
export function aliasedColumns(X: Mat, tol = 1e-9): number[] {
  // Gram-Schmidt on centred-and-scaled columns; a column whose residual norm vanishes is aliased.
  const n = X.length, p = X[0]?.length ?? 0;
  const basis: number[][] = [];
  const out: number[] = [];
  for (let j = 0; j < p; j++) {
    let v = X.map((r) => r[j]);
    const norm0 = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm0 === 0) { out.push(j); continue; }
    v = v.map((x) => x / norm0);
    for (let pass = 0; pass < 2; pass++)
      for (const b of basis) { let d = 0; for (let i = 0; i < n; i++) d += v[i] * b[i]; for (let i = 0; i < n; i++) v[i] -= d * b[i]; }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm < tol * 1e3) { out.push(j); continue; }
    basis.push(v.map((x) => x / norm));
  }
  return out;
}

export function solveSym(A: Mat, b: number[]): number[] | null {
  const { inv, aliased } = symInverse(A);
  if (aliased.length) return null;
  return matvec(inv, b);
}

/**
 * Least squares by Householder QR (more accurate than the normal equations when predictors are on very different scales).
 * Returns the coefficients and (X'X)^-1 = R^-1 R^-T, or null when X is rank deficient.
 */
export function qrLeastSquares(X: Mat, y: number[]): { beta: number[]; xtxInv: Mat } | null {
  const n = X.length, p = X[0]?.length ?? 0;
  const A = X.map((r) => r.slice());
  const b = y.slice();
  const diag = new Array<number>(p).fill(0);
  let maxNorm = 0;
  for (let j = 0; j < p; j++) maxNorm = Math.max(maxNorm, Math.sqrt(A.reduce((s, r) => s + r[j] * r[j], 0)));
  for (let k = 0; k < p; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += A[i][k] * A[i][k];
    norm = Math.sqrt(norm);
    if (norm <= 1e-12 * Math.max(1, maxNorm)) return null;
    const alpha = A[k][k] > 0 ? -norm : norm;
    const v = new Array<number>(n).fill(0);
    v[k] = A[k][k] - alpha;
    for (let i = k + 1; i < n; i++) v[i] = A[i][k];
    const vv = v.reduce((s, x) => s + x * x, 0);
    if (vv === 0) { diag[k] = alpha; continue; }
    for (let j = k; j < p; j++) {
      let s = 0;
      for (let i = k; i < n; i++) s += v[i] * A[i][j];
      const f = (2 * s) / vv;
      for (let i = k; i < n; i++) A[i][j] -= f * v[i];
    }
    let s = 0;
    for (let i = k; i < n; i++) s += v[i] * b[i];
    const f = (2 * s) / vv;
    for (let i = k; i < n; i++) b[i] -= f * v[i];
    diag[k] = A[k][k];
  }
  if (diag.some((d) => Math.abs(d) <= 1e-10 * Math.max(1, maxNorm))) return null;
  // Back substitution R beta = Q'y, and R^-1.
  const beta = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < p; j++) s -= A[i][j] * beta[j]; beta[i] = s / A[i][i]; }
  const Rinv = zeros(p, p);
  for (let i = p - 1; i >= 0; i--) {
    Rinv[i][i] = 1 / A[i][i];
    for (let j = i + 1; j < p; j++) { let s = 0; for (let k = i + 1; k <= j; k++) s += A[i][k] * Rinv[k][j]; Rinv[i][j] = -s / A[i][i]; }
  }
  const xtxInv = zeros(p, p);
  for (let i = 0; i < p; i++) for (let j = i; j < p; j++) { let s = 0; for (let k = j; k < p; k++) s += Rinv[i][k] * Rinv[j][k]; xtxInv[i][j] = s; xtxInv[j][i] = s; }
  return { beta, xtxInv };
}
