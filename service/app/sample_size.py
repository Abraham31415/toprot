import math
from statistics import NormalDist
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/sample-size", tags=["sample-size"])

DesignType = Literal[
    "single_proportion",
    "single_mean",
    "two_proportions",
    "two_means",
    "paired_means",
    "correlation",
    "sensitivity_specificity",
    "cross_sectional_or",
    "cohort_rr",
]

# Which designs use two independent groups (get a group multiplier and a
# "per group" figure) vs. a single total N.
TWO_GROUP_DESIGNS = {"two_proportions", "two_means", "cross_sectional_or", "cohort_rr"}

DROPOUT_RATES = [0.0, 0.1, 0.2, 0.3, 0.4]
EFFECT_SCALES = [0.7, 0.85, 1.0, 1.15, 1.3]


def z(p: float) -> float:
    return NormalDist().inv_cdf(p)


def n_single_proportion(expected_proportion: float, margin_of_error: float, confidence_level: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    p = expected_proportion
    return (za**2) * p * (1 - p) / (margin_of_error**2)


def n_single_mean(standard_deviation: float, margin_of_error: float, confidence_level: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    return (za**2) * (standard_deviation**2) / (margin_of_error**2)


def n_two_proportions(p1: float, p2: float, confidence_level: float, power: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    zb = z(power)
    diff = abs(p1 - p2)
    return ((za + zb) ** 2) * (p1 * (1 - p1) + p2 * (1 - p2)) / (diff**2)


def n_two_means(mean_difference: float, standard_deviation: float, confidence_level: float, power: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    zb = z(power)
    return ((za + zb) ** 2) * 2 * (standard_deviation**2) / (mean_difference**2)


def n_paired_means(mean_difference: float, sd_of_differences: float, confidence_level: float, power: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    zb = z(power)
    return ((za + zb) ** 2) * (sd_of_differences**2) / (mean_difference**2)


def n_correlation(expected_correlation: float, confidence_level: float, power: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    zb = z(power)
    fisher_z = 0.5 * math.log((1 + expected_correlation) / (1 - expected_correlation))
    return ((za + zb) / fisher_z) ** 2 + 3


def n_sensitivity_specificity(
    expected_sensitivity: float, expected_specificity: float, disease_prevalence: float, margin_of_error: float, confidence_level: float
) -> float:
    """Buderer (1996). Returns the larger of the two totals needed to estimate
    sensitivity and specificity to the requested precision."""
    za = z(1 - (1 - confidence_level) / 2)
    n_diseased = (za**2) * expected_sensitivity * (1 - expected_sensitivity) / (margin_of_error**2)
    n_healthy = (za**2) * expected_specificity * (1 - expected_specificity) / (margin_of_error**2)
    total_for_sensitivity = n_diseased / disease_prevalence
    total_for_specificity = n_healthy / (1 - disease_prevalence)
    return max(total_for_sensitivity, total_for_specificity)


def proportion_from_odds_ratio(baseline_proportion: float, odds_ratio: float) -> float:
    p0 = baseline_proportion
    return (odds_ratio * p0) / (1 - p0 + odds_ratio * p0)


def proportion_from_relative_risk(baseline_proportion: float, relative_risk: float) -> float:
    return baseline_proportion * relative_risk


def apply_dropout(n: float, dropout_rate: float) -> int:
    return math.ceil(n / (1 - dropout_rate))


def apply_fpc(n: float, population_size: Optional[float]) -> float:
    """Finite population correction. Only meaningful when sampling a known,
    bounded population (e.g. all NICU admissions at one site in a year)."""
    if not population_size or population_size <= 0:
        return n
    return n / (1 + (n - 1) / population_size)


class SampleSizeInput(BaseModel):
    design_type: DesignType
    confidence_level: float = 0.95
    power: float = 0.8
    dropout_rate: float = 0.1
    population_size: Optional[float] = None

    expected_proportion: Optional[float] = None
    margin_of_error: Optional[float] = None

    proportion_group1: Optional[float] = None
    proportion_group2: Optional[float] = None

    mean_difference: Optional[float] = None
    standard_deviation: Optional[float] = None

    expected_correlation: Optional[float] = None

    expected_sensitivity: Optional[float] = None
    expected_specificity: Optional[float] = None
    disease_prevalence: Optional[float] = None

    baseline_proportion: Optional[float] = None
    odds_ratio: Optional[float] = None
    relative_risk: Optional[float] = None


FORMULAS: dict[DesignType, dict[str, str]] = {
    "single_proportion": {
        "label": "n = Z² × p(1-p) / E²",
        "citation": "Kish L. Survey Sampling. 1965.",
    },
    "single_mean": {
        "label": "n = Z² × σ² / E²",
        "citation": "Kish L. Survey Sampling. 1965.",
    },
    "two_proportions": {
        "label": "n (per group) = (Zₐ+Zᵦ)² × [p₁(1-p₁)+p₂(1-p₂)] / (p₁-p₂)²",
        "citation": "Charan J, Biswas T. Indian J Psychol Med. 2013;35(2):121-126.",
    },
    "two_means": {
        "label": "n (per group) = (Zₐ+Zᵦ)² × 2σ² / d²",
        "citation": "Charan J, Biswas T. Indian J Psychol Med. 2013;35(2):121-126.",
    },
    "paired_means": {
        "label": "n = (Zₐ+Zᵦ)² × σₑ² / d²  (σₑ = SD of paired differences)",
        "citation": "Charan J, Biswas T. Indian J Psychol Med. 2013;35(2):121-126.",
    },
    "correlation": {
        "label": "n = [(Zₐ+Zᵦ) / 0.5·ln((1+r)/(1-r))]² + 3",
        "citation": "Fisher RA. Metron. 1921;1:3-32.",
    },
    "sensitivity_specificity": {
        "label": "n = Z² × Sn(1-Sn) / (L² × prevalence), and likewise for specificity; larger total is used",
        "citation": "Buderer NM. Acad Emerg Med. 1996;3(9):895-900.",
    },
    "cross_sectional_or": {
        "label": "p₁ derived from OR and baseline proportion, then n (per group) = (Zₐ+Zᵦ)² × [p₁(1-p₁)+p₀(1-p₀)] / (p₁-p₀)²",
        "citation": "Charan J, Biswas T. Indian J Psychol Med. 2013;35(2):121-126.",
    },
    "cohort_rr": {
        "label": "p₁ = p₀ × RR, then n (per group) = (Zₐ+Zᵦ)² × [p₁(1-p₁)+p₀(1-p₀)] / (p₁-p₀)²",
        "citation": "Charan J, Biswas T. Indian J Psychol Med. 2013;35(2):121-126.",
    },
}


def compute_base_n(inp: SampleSizeInput) -> float:
    """Returns per-group N for two-group designs, total N otherwise."""
    if inp.design_type == "single_proportion":
        if inp.expected_proportion is None or inp.margin_of_error is None:
            raise HTTPException(422, "expected_proportion and margin_of_error are required")
        return n_single_proportion(inp.expected_proportion, inp.margin_of_error, inp.confidence_level)

    if inp.design_type == "single_mean":
        if inp.standard_deviation is None or inp.margin_of_error is None:
            raise HTTPException(422, "standard_deviation and margin_of_error are required")
        return n_single_mean(inp.standard_deviation, inp.margin_of_error, inp.confidence_level)

    if inp.design_type == "two_proportions":
        if inp.proportion_group1 is None or inp.proportion_group2 is None:
            raise HTTPException(422, "proportion_group1 and proportion_group2 are required")
        return n_two_proportions(inp.proportion_group1, inp.proportion_group2, inp.confidence_level, inp.power)

    if inp.design_type == "two_means":
        if inp.mean_difference is None or inp.standard_deviation is None:
            raise HTTPException(422, "mean_difference and standard_deviation are required")
        return n_two_means(inp.mean_difference, inp.standard_deviation, inp.confidence_level, inp.power)

    if inp.design_type == "paired_means":
        if inp.mean_difference is None or inp.standard_deviation is None:
            raise HTTPException(422, "mean_difference and standard_deviation (of the differences) are required")
        return n_paired_means(inp.mean_difference, inp.standard_deviation, inp.confidence_level, inp.power)

    if inp.design_type == "correlation":
        if inp.expected_correlation is None:
            raise HTTPException(422, "expected_correlation is required")
        if not -1 < inp.expected_correlation < 1:
            raise HTTPException(422, "expected_correlation must be strictly between -1 and 1")
        return n_correlation(inp.expected_correlation, inp.confidence_level, inp.power)

    if inp.design_type == "sensitivity_specificity":
        if inp.expected_sensitivity is None or inp.expected_specificity is None or inp.disease_prevalence is None or inp.margin_of_error is None:
            raise HTTPException(422, "expected_sensitivity, expected_specificity, disease_prevalence, and margin_of_error are required")
        return n_sensitivity_specificity(
            inp.expected_sensitivity, inp.expected_specificity, inp.disease_prevalence, inp.margin_of_error, inp.confidence_level
        )

    if inp.design_type == "cross_sectional_or":
        if inp.baseline_proportion is None or inp.odds_ratio is None:
            raise HTTPException(422, "baseline_proportion and odds_ratio are required")
        p1 = proportion_from_odds_ratio(inp.baseline_proportion, inp.odds_ratio)
        return n_two_proportions(p1, inp.baseline_proportion, inp.confidence_level, inp.power)

    if inp.design_type == "cohort_rr":
        if inp.baseline_proportion is None or inp.relative_risk is None:
            raise HTTPException(422, "baseline_proportion and relative_risk are required")
        p1 = proportion_from_relative_risk(inp.baseline_proportion, inp.relative_risk)
        if not 0 < p1 < 1:
            raise HTTPException(422, "baseline_proportion x relative_risk must produce a proportion between 0 and 1")
        return n_two_proportions(p1, inp.baseline_proportion, inp.confidence_level, inp.power)

    raise HTTPException(422, "Unknown design_type")


def effect_label_and_value(inp: SampleSizeInput) -> tuple[str, float]:
    if inp.design_type in ("single_proportion", "single_mean", "sensitivity_specificity"):
        return "Margin of error", inp.margin_of_error  # type: ignore[return-value]
    if inp.design_type == "two_proportions":
        return "Difference in proportions", abs(inp.proportion_group1 - inp.proportion_group2)  # type: ignore[operator]
    if inp.design_type in ("two_means", "paired_means"):
        return "Mean difference", inp.mean_difference  # type: ignore[return-value]
    if inp.design_type == "correlation":
        return "Expected correlation", inp.expected_correlation  # type: ignore[return-value]
    if inp.design_type == "cross_sectional_or":
        return "Odds ratio", inp.odds_ratio  # type: ignore[return-value]
    return "Relative risk", inp.relative_risk  # type: ignore[return-value]


def n_for_scaled_effect(inp: SampleSizeInput, scale: float) -> float:
    if inp.design_type == "single_proportion":
        return n_single_proportion(inp.expected_proportion, inp.margin_of_error * scale, inp.confidence_level)  # type: ignore[arg-type]

    if inp.design_type == "single_mean":
        return n_single_mean(inp.standard_deviation, inp.margin_of_error * scale, inp.confidence_level)  # type: ignore[arg-type]

    if inp.design_type == "sensitivity_specificity":
        return n_sensitivity_specificity(
            inp.expected_sensitivity, inp.expected_specificity, inp.disease_prevalence, inp.margin_of_error * scale, inp.confidence_level  # type: ignore[arg-type]
        )

    if inp.design_type == "two_proportions":
        p1 = inp.proportion_group1  # type: ignore[assignment]
        p2 = inp.proportion_group2  # type: ignore[assignment]
        base_diff = abs(p1 - p2)
        scaled_diff = base_diff * scale
        direction = 1 if p2 >= p1 else -1
        scaled_p2 = min(max(p1 + direction * scaled_diff, 0.01), 0.99)
        return n_two_proportions(p1, scaled_p2, inp.confidence_level, inp.power)

    if inp.design_type in ("two_means", "paired_means"):
        fn = n_two_means if inp.design_type == "two_means" else n_paired_means
        return fn(inp.mean_difference * scale, inp.standard_deviation, inp.confidence_level, inp.power)  # type: ignore[arg-type]

    if inp.design_type == "correlation":
        scaled_r = min(max(inp.expected_correlation * scale, -0.99), 0.99)  # type: ignore[operator]
        return n_correlation(scaled_r, inp.confidence_level, inp.power)

    if inp.design_type == "cross_sectional_or":
        scaled_or = 1 + (inp.odds_ratio - 1) * scale  # type: ignore[operator]
        p1 = proportion_from_odds_ratio(inp.baseline_proportion, scaled_or)  # type: ignore[arg-type]
        return n_two_proportions(p1, inp.baseline_proportion, inp.confidence_level, inp.power)  # type: ignore[arg-type]

    # cohort_rr
    scaled_rr = 1 + (inp.relative_risk - 1) * scale  # type: ignore[operator]
    p1 = min(max(proportion_from_relative_risk(inp.baseline_proportion, scaled_rr), 0.01), 0.99)  # type: ignore[arg-type]
    return n_two_proportions(p1, inp.baseline_proportion, inp.confidence_level, inp.power)  # type: ignore[arg-type]


class SampleSizeResult(BaseModel):
    n_before_dropout: int
    n_total: int
    n_per_group: Optional[int]
    stress_test: dict
    formula_label: str
    citation: str


@router.post("/calculate", response_model=SampleSizeResult)
def calculate(inp: SampleSizeInput):
    is_two_group = inp.design_type in TWO_GROUP_DESIGNS
    group_multiplier = 2 if is_two_group else 1

    base_n = compute_base_n(inp)  # per-group N for two-group designs, total N otherwise
    base_n = apply_fpc(base_n * group_multiplier, inp.population_size) / group_multiplier

    n_before_dropout = math.ceil(base_n) * group_multiplier
    n_per_group = apply_dropout(base_n, inp.dropout_rate) if is_two_group else None
    n_total = apply_dropout(base_n, inp.dropout_rate) * group_multiplier

    effect_label, effect_value = effect_label_and_value(inp)
    columns = [
        {"label": f"{round(scale * 100)}%", "value": round(effect_value * scale, 4)}
        for scale in EFFECT_SCALES
    ]
    rows = [{"label": f"{round(d * 100)}%", "value": d} for d in DROPOUT_RATES]

    grid = []
    for dropout in DROPOUT_RATES:
        row = []
        for scale in EFFECT_SCALES:
            n_scaled = n_for_scaled_effect(inp, scale)
            n_scaled = apply_fpc(n_scaled * group_multiplier, inp.population_size) / group_multiplier
            adjusted = apply_dropout(n_scaled, dropout) * group_multiplier
            row.append(adjusted)
        grid.append(row)

    formula = FORMULAS[inp.design_type]

    return SampleSizeResult(
        n_before_dropout=n_before_dropout,
        n_total=n_total,
        n_per_group=n_per_group,
        stress_test={
            "effect_label": effect_label,
            "dropout_label": "Dropout rate",
            "rows": rows,
            "columns": columns,
            "grid": grid,
        },
        formula_label=formula["label"],
        citation=formula["citation"],
    )
