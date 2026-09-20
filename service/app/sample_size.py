import math
from statistics import NormalDist
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/sample-size", tags=["sample-size"])

DesignType = Literal["single_proportion", "two_proportions", "two_means"]

DROPOUT_RATES = [0.0, 0.1, 0.2, 0.3, 0.4]
EFFECT_SCALES = [0.7, 0.85, 1.0, 1.15, 1.3]


def z(p: float) -> float:
    return NormalDist().inv_cdf(p)


def n_single_proportion(expected_proportion: float, margin_of_error: float, confidence_level: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    p = expected_proportion
    return (za**2) * p * (1 - p) / (margin_of_error**2)


def n_two_proportions(p1: float, p2: float, confidence_level: float, power: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    zb = z(power)
    diff = abs(p1 - p2)
    return ((za + zb) ** 2) * (p1 * (1 - p1) + p2 * (1 - p2)) / (diff**2)


def n_two_means(mean_difference: float, standard_deviation: float, confidence_level: float, power: float) -> float:
    za = z(1 - (1 - confidence_level) / 2)
    zb = z(power)
    return ((za + zb) ** 2) * 2 * (standard_deviation**2) / (mean_difference**2)


def apply_dropout(n: float, dropout_rate: float) -> int:
    return math.ceil(n / (1 - dropout_rate))


class SampleSizeInput(BaseModel):
    design_type: DesignType
    confidence_level: float = 0.95
    power: float = 0.8
    dropout_rate: float = 0.1

    expected_proportion: Optional[float] = None
    margin_of_error: Optional[float] = None

    proportion_group1: Optional[float] = None
    proportion_group2: Optional[float] = None

    mean_difference: Optional[float] = None
    standard_deviation: Optional[float] = None


def compute_base_n(inp: SampleSizeInput) -> float:
    if inp.design_type == "single_proportion":
        if inp.expected_proportion is None or inp.margin_of_error is None:
            raise HTTPException(422, "expected_proportion and margin_of_error are required")
        return n_single_proportion(inp.expected_proportion, inp.margin_of_error, inp.confidence_level)

    if inp.design_type == "two_proportions":
        if inp.proportion_group1 is None or inp.proportion_group2 is None:
            raise HTTPException(422, "proportion_group1 and proportion_group2 are required")
        return n_two_proportions(inp.proportion_group1, inp.proportion_group2, inp.confidence_level, inp.power)

    if inp.design_type == "two_means":
        if inp.mean_difference is None or inp.standard_deviation is None:
            raise HTTPException(422, "mean_difference and standard_deviation are required")
        return n_two_means(inp.mean_difference, inp.standard_deviation, inp.confidence_level, inp.power)

    raise HTTPException(422, "Unknown design_type")


def effect_label_and_value(inp: SampleSizeInput) -> tuple[str, float]:
    if inp.design_type == "single_proportion":
        return "Margin of error", inp.margin_of_error  # type: ignore[return-value]
    if inp.design_type == "two_proportions":
        return "Difference in proportions", abs(inp.proportion_group1 - inp.proportion_group2)  # type: ignore[operator]
    return "Mean difference", inp.mean_difference  # type: ignore[return-value]


def n_for_scaled_effect(inp: SampleSizeInput, scale: float) -> float:
    if inp.design_type == "single_proportion":
        return n_single_proportion(inp.expected_proportion, inp.margin_of_error * scale, inp.confidence_level)  # type: ignore[arg-type]

    if inp.design_type == "two_proportions":
        p1 = inp.proportion_group1  # type: ignore[assignment]
        p2 = inp.proportion_group2  # type: ignore[assignment]
        base_diff = abs(p1 - p2)
        scaled_diff = base_diff * scale
        # hold p1 fixed, move p2 toward/away from it to realize the scaled difference
        direction = 1 if p2 >= p1 else -1
        scaled_p2 = min(max(p1 + direction * scaled_diff, 0.01), 0.99)
        return n_two_proportions(p1, scaled_p2, inp.confidence_level, inp.power)

    return n_two_means(inp.mean_difference * scale, inp.standard_deviation, inp.confidence_level, inp.power)  # type: ignore[arg-type]


class SampleSizeResult(BaseModel):
    n_before_dropout: int
    n_total: int
    n_per_group: Optional[int]
    stress_test: dict


@router.post("/calculate", response_model=SampleSizeResult)
def calculate(inp: SampleSizeInput):
    is_single = inp.design_type == "single_proportion"
    group_multiplier = 1 if is_single else 2

    base_n = compute_base_n(inp)  # total N for single_proportion, per-group N otherwise
    n_before_dropout = math.ceil(base_n) * group_multiplier
    n_per_group = apply_dropout(base_n, inp.dropout_rate) if not is_single else None
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
            adjusted = apply_dropout(n_scaled, dropout) * group_multiplier
            row.append(adjusted)
        grid.append(row)

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
    )
