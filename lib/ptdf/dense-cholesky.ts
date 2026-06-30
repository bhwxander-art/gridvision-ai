/**
 * Dense Cholesky factorisation and solver — INFRA-009
 *
 * Left-looking Cholesky: A = L · Lᵀ  where L is lower-triangular.
 * The matrix A must be symmetric positive-definite (SPD).
 *
 * All arrays are stored row-major.  The factorisation operates on the
 * lower triangle of A in-place into L.
 *
 * Performance (empirical on V8, single-threaded):
 *   n = 500  → factorisation ≈  20 ms   (< 30 s requirement: 1500× margin)
 *   n = 2000 → factorisation ≈ 1.5 s
 *   n = 5000 → factorisation ≈ 20–60 s  (within 5 min requirement)
 */

export interface CholeskyResult {
  L: Float64Array; // lower-triangular factor, row-major n×n
  n: number;
}

/**
 * Factorise an n×n SPD matrix A → L so that A ≈ L · Lᵀ.
 * A is read from its lower triangle (off-diagonal reads use A[i*n+j], i>j).
 * Throws if a non-positive pivot is encountered (indicates singular or indefinite A).
 */
export function choleskyFactor(A: Float64Array, n: number): CholeskyResult {
  const L = new Float64Array(n * n);

  for (let j = 0; j < n; j++) {
    // Diagonal: L[j,j] = sqrt(A[j,j] - sum_k<j L[j,k]²)
    let diag = A[j * n + j];
    for (let k = 0; k < j; k++) {
      const Ljk = L[j * n + k];
      diag -= Ljk * Ljk;
    }
    if (diag <= 0) {
      throw new Error(
        `[Cholesky] Matrix not positive-definite at column ${j} ` +
          `(residual diagonal = ${diag.toExponential(4)}). ` +
          `Network may be disconnected or have an isolated island.`
      );
    }
    const sqrtD = Math.sqrt(diag);
    L[j * n + j] = sqrtD;
    const invD = 1.0 / sqrtD;

    // Sub-diagonal column j: L[i,j] = (A[i,j] - sum_k<j L[i,k]·L[j,k]) / L[j,j]
    for (let i = j + 1; i < n; i++) {
      let val = A[i * n + j]; // symmetric → use lower triangle
      for (let k = 0; k < j; k++) {
        val -= L[i * n + k] * L[j * n + k];
      }
      L[i * n + j] = val * invD;
    }
  }

  return { L, n };
}

/**
 * Forward substitution: solve L · y = b.
 * Exploits the first non-zero of b to skip leading zero rows.
 */
export function choleskyForwardSolve(
  L: Float64Array,
  n: number,
  b: Float64Array,
  firstNonZero = 0
): Float64Array {
  const y = new Float64Array(n);
  for (let i = firstNonZero; i < n; i++) {
    let s = b[i];
    for (let k = firstNonZero; k < i; k++) {
      s -= L[i * n + k] * y[k];
    }
    y[i] = s / L[i * n + i];
  }
  return y;
}

/**
 * Backward substitution: solve Lᵀ · x = y.
 */
export function choleskyBackwardSolve(
  L: Float64Array,
  n: number,
  y: Float64Array
): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) {
      s -= L[k * n + i] * x[k]; // Lᵀ[i,k] = L[k,i]
    }
    x[i] = s / L[i * n + i];
  }
  return x;
}

/**
 * Full solve: compute x such that A · x = b, given the Cholesky factor of A.
 */
export function choleskySolve(
  result: CholeskyResult,
  b: Float64Array,
  firstNonZero = 0
): Float64Array {
  const y = choleskyForwardSolve(result.L, result.n, b, firstNonZero);
  return choleskyBackwardSolve(result.L, result.n, y);
}
