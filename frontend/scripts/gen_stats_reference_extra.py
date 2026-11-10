"""Append matched case-control and repeated-measures reference values (independent Python implementation + Monte Carlo)."""
import json, math, sys
import numpy as np
from scipy import stats

path = sys.argv[1]
out = json.load(open(path))
za, zb = stats.norm.ppf(0.975), stats.norm.ppf(0.8)


def sets_needed(p0, OR, M):
    p1 = OR * p0 / (1 - p0 + OR * p0)
    v0 = v1 = d = 0.0
    for j in range(1, M + 1):
        # exactly j exposed in the set (case + M controls)
        qa = p1 * stats.binom.pmf(j - 1, M, p0)  # case exposed
        qb = (1 - p1) * stats.binom.pmf(j, M, p0)  # case not exposed
        q = qa + qb
        pi = qa / q
        v0 += q * j * (M + 1 - j) / (M + 1) ** 2
        v1 += q * pi * (1 - pi)
        d += q * (pi - j / (M + 1))
    return math.ceil((za * math.sqrt(v0) + zb * math.sqrt(v1)) ** 2 / d ** 2 - 1e-9), p1


def simulate_power(p0, OR, M, N, reps=20000, seed=12345):
    rng = np.random.default_rng(seed)
    p1 = OR * p0 / (1 - p0 + OR * p0)
    case = rng.random((reps, N)) < p1
    ctrl = (rng.random((reps, N, M)) < p0).sum(axis=2)
    j = case.astype(int) + ctrl
    informative = (j >= 1) & (j <= M)
    T = np.where(informative, case - j / (M + 1), 0.0).sum(axis=1)
    V0 = np.where(informative, j * (M + 1 - j) / (M + 1) ** 2, 0.0).sum(axis=1)
    Z = np.divide(T, np.sqrt(V0), out=np.zeros_like(T), where=V0 > 0)
    return float((np.abs(Z) > za).mean())


cases = []
for p0, OR, M in [(0.3, 2.0, 1), (0.3, 2.0, 3), (0.2, 2.5, 2), (0.4, 3.0, 4)]:
    N, p1 = sets_needed(p0, OR, M)
    cases.append({"p0": p0, "or": OR, "m": M, "sets": N, "power": simulate_power(p0, OR, M, N)})
out["matchedM"] = cases


# repeated measures: variance factor c'Rc computed with numpy
def R(structure, rho, m):
    i = np.arange(m)
    return np.full((m, m), rho) + (1 - rho) * np.eye(m) if structure == "cs" else rho ** np.abs(i[:, None] - i[None, :])


def factor(summary, structure, rho, m):
    r = R(structure, rho, m)
    if summary == "mean":
        c = np.full(m, 1 / m)
    elif summary == "slope":
        t = np.arange(m) - (m - 1) / 2
        c = t / (t ** 2).sum()
    else:
        c = np.concatenate([[-1.0], np.full(m - 1, 1 / (m - 1))])
    return float(c @ r @ c)


rm = []
for summary, structure, rho, m in [("mean", "cs", 0.5, 4), ("mean", "ar1", 0.6, 5), ("slope", "cs", 0.5, 4), ("slope", "ar1", 0.7, 6), ("change", "cs", 0.4, 3), ("change", "ar1", 0.5, 4)]:
    v = factor(summary, structure, rho, m)
    n1 = math.ceil(2 * (za + zb) ** 2 * 400 * v / 25 - 1e-9)  # SD 20, delta 5
    rm.append({"summary": summary, "structure": structure, "rho": rho, "m": m, "factor": v, "perGroup": n1})
out["repeated"] = rm
json.dump(out, open(path, "w"), indent=1)
print(json.dumps(cases, indent=1))
