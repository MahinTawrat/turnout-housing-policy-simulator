"""Transparent five-year policy sensitivity calculations.

Inputs contain stocks, permit references, costs and exposure, never stored policy
answers. County results are rounded first (Python ties to even). State transit
uses state exposure directly; cost reforms use the documented coverage factor.
These are conditional scenarios, not measured causal effects or completions.
"""
from __future__ import annotations

import math
from collections import defaultdict

POLICIES = ("adu", "missing_middle", "tod", "parking", "fee")
LEVELS = ("low", "default", "high")
BASES = {"lower": "low", "central": "fiveYear", "upper": "high"}
PARAMETERS = (
    "ADU 5-year take-up",
    "Missing-middle 5-year redevelopment share",
    "Missing-middle net additional units per redevelopment",
    "TOD production uplift in exposed areas",
    "Parking reform share of baseline development affected",
    "Parking spaces avoided per affected unit",
    "Parking construction cost per avoided space",
    "Parking cost-to-supply elasticity",
    "Development fee savings per unit",
    "Development fee cost-to-supply elasticity",
)


def _number(value, label, *, nullable=False):
    if value is None and nullable:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number" + (" or null" if nullable else ""))
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{label} must be finite and nonnegative")


def parameters(assumptions):
    """Accept the versioned configuration or an explicit parameter dictionary."""
    result = assumptions.get("parameters", assumptions)
    for name in PARAMETERS:
        if name not in result:
            raise ValueError(f"Missing assumption: {name}")
        for level in LEVELS:
            _number(result[name].get(level), f"{name}/{level}")
    for name in ("ADU 5-year take-up", "Missing-middle 5-year redevelopment share",
                 "Parking reform share of baseline development affected"):
        if any(result[name][level] > 1 for level in LEVELS):
            raise ValueError(f"{name} must be a share between zero and one")
    cap = assumptions.get("cost_ratio_cap", .30)
    _number(cap, "cost_ratio_cap")
    if cap > 1:
        raise ValueError("cost_ratio_cap must not exceed one")
    return result


def validate_inputs(inputs):
    """Reject malformed geographies and any stored policy-output columns."""
    states, counties = inputs["states"], inputs["counties"]
    if not states or not counties:
        raise ValueError("At least one state and county are required")
    seen_states, seen_counties = set(), set()
    for record, kind in [(r, "state") for r in states] + [(r, "county") for r in counties]:
        if any("_added_" in key or "_pct_vs_baseline_" in key for key in record):
            raise ValueError("Stored policy outputs are not valid calculation inputs")
        abbr = record.get("state_abbr")
        if not isinstance(abbr, str) or not abbr:
            raise ValueError("A state abbreviation is required")
        if kind == "state":
            if abbr in seen_states:
                raise ValueError(f"Duplicate state: {abbr}")
            seen_states.add(abbr)
            _number(record.get("reconciliation_factor"), f"{abbr} coverage factor", nullable=True)
        else:
            fips = record.get("fips")
            if not isinstance(fips, str) or len(fips) != 5 or not fips.isdigit():
                raise ValueError("County FIPS must be a five-character digit string")
            if fips in seen_counties:
                raise ValueError(f"Duplicate county: {fips}")
            seen_counties.add(fips)
            _number(record.get("sf_detached_units"), f"{fips} detached stock")
            _number(record.get("scenario_cost_base"), f"{fips} cost", nullable=True)
        for field in ("baseline_annual_units", "baseline_5yr_units"):
            _number(record.get(field), f"{abbr} {field}", nullable=kind == "county")
        exposure = record.get("tod_housing_share_new")
        _number(exposure, f"{abbr} transit exposure", nullable=True)
        if exposure is not None and exposure > 1:
            raise ValueError("Transit exposure must be a share between zero and one")
    if any(r["state_abbr"] not in seen_states for r in counties):
        raise ValueError("County has an unsupported parent state")
    if seen_states != {r["state_abbr"] for r in counties}:
        raise ValueError("Every state must have county inputs")


def county_effect(record, baseline, policy, level, assumptions):
    """Compute one county result; None remains unavailable, distinct from zero.

    Stock policies can add homes with zero or missing permit activity. Cost
    savings are divided by the permit-valuation proxy, capped before applying
    the response assumption. Voluntary parking remains possible: only the
    assumed avoided spaces on affected development generate savings.
    """
    if policy not in POLICIES or level not in LEVELS:
        raise ValueError("Unknown policy or response level")
    values = assumptions.get("parameters", assumptions)
    a = lambda key: values[key][level]
    if policy == "adu":
        return round(record["sf_detached_units"] * a("ADU 5-year take-up"))
    if policy == "missing_middle":
        return round(record["sf_detached_units"] * a("Missing-middle 5-year redevelopment share")
                     * a("Missing-middle net additional units per redevelopment"))
    if baseline is None:
        return None
    if policy == "tod":
        if record["tod_housing_share_new"] is None:
            return None
        return round(baseline * record["tod_housing_share_new"] * a("TOD production uplift in exposed areas"))
    cost = record["scenario_cost_base"]
    if cost is None or cost <= 0:
        return None
    cap = assumptions.get("cost_ratio_cap", .30)
    if policy == "fee":
        return round(baseline * min(cap, a("Development fee savings per unit") / cost)
                     * a("Development fee cost-to-supply elasticity"))
    savings = a("Parking spaces avoided per affected unit") * a("Parking construction cost per avoided space")
    return round(baseline * a("Parking reform share of baseline development affected")
                 * min(cap, savings / cost) * a("Parking cost-to-supply elasticity"))


def allocate_county_baseline(county_reference, state_reference, state_forecast):
    """Use a fixed observed permit share, without inventing missing coverage."""
    if county_reference is None:
        return None
    if state_reference == 0:
        return 0 if state_forecast == 0 else None
    return round(county_reference * state_forecast / state_reference)


def build_scenarios(inputs, production, assumptions):
    """Return browser-compatible scenarios, validation metadata and CSV tables.

    The expected regression fixture is deliberately not an argument and is never
    loaded here. Every answer is recomputed from the supplied input variables.
    """
    validate_inputs(inputs)
    values = parameters(assumptions)
    states, counties = inputs["states"], inputs["counties"]
    by_state = defaultdict(list)
    for record in counties:
        by_state[record["state_abbr"]].append(record)
    result = {
        "states": {}, "counties": {}, "national": {"bases": {}, "scenarios": {}},
        "status": "Policy responses are sensitivity assumptions; verified incremental effects remain unavailable.",
        "zeroResponse": "Zero additional production is an explicit stress case for every reform. Low/Default/High are not lower/central/upper probability bounds.",
        "costConvention": "2025 permit valuations and standardized savings are held fixed in dollar terms. The inherited 2026 parking cost assumptions are not converted to a common dollar year.",
        "countyMethod": production["countyMethod"],
    }
    state_rows, county_rows = [], []
    for state_input in states:
        abbr = state_input["state_abbr"]
        group = by_state[abbr]
        state = {"bases": {}, "scenarios": {}, "countySums": {}, "coverageFactors": {},
                 "oldFiveYear": state_input["baseline_5yr_units"]}
        for case, key in BASES.items():
            baseline = production["states"][abbr][key]
            _number(baseline, f"{abbr}/{case} forecast")
            state["bases"][case] = baseline
            county_bases = {r["fips"]: allocate_county_baseline(r["baseline_5yr_units"],
                            state_input["baseline_5yr_units"], baseline) for r in group}
            county_sum = sum(v or 0 for v in county_bases.values())
            # Keep the exact audited coverage precision for an unchanged point
            # reference; use allocated coverage for a different baseline case.
            factor = (state_input["reconciliation_factor"] if baseline == state_input["baseline_5yr_units"]
                      else baseline / county_sum if county_sum else 1 if baseline == 0 else None)
            state["coverageFactors"][case] = factor
            for record in group:
                fips = record["fips"]
                county = result["counties"].setdefault(fips, {"state": abbr, "bases": {},
                            "scenarios": {}, "oldFiveYear": record["baseline_5yr_units"]})
                county["bases"][case] = county_bases[fips]
                outputs = {p: {level: county_effect(record, county_bases[fips], p, level, assumptions)
                              for level in LEVELS} for p in POLICIES}
                county["scenarios"][case] = outputs
                for policy in POLICIES:
                    for level in LEVELS:
                        extra = outputs[policy][level]
                        local_base = county_bases[fips]
                        county_rows.append({"state": abbr, "fips": fips, "county": record["county_name"],
                            "baseline_case": case, "policy": policy, "response": level,
                            "baseline": local_base, "extra": extra,
                            "with_response": None if local_base is None or extra is None else local_base + extra})
            state["countySums"][case] = {p: {level: sum(result["counties"][r["fips"]]["scenarios"][case][p][level] or 0
                for r in group) for level in LEVELS} for p in POLICIES}
            state["scenarios"][case] = {}
            for policy in POLICIES:
                state["scenarios"][case][policy] = {}
                for level in LEVELS:
                    if policy == "tod":
                        exposure = state_input["tod_housing_share_new"]
                        extra = None if exposure is None else round(baseline * exposure
                                      * values["TOD production uplift in exposed areas"][level])
                    else:
                        total = state["countySums"][case][policy][level]
                        extra = total if policy in ("adu", "missing_middle") else None if factor is None else round(total * factor)
                    state["scenarios"][case][policy][level] = extra
                    state_rows.append({"state": abbr, "baseline_case": case, "policy": policy,
                        "response": level, "baseline": baseline, "extra": extra,
                        "with_response": None if extra is None else baseline + extra,
                        "coverage_factor": factor if policy in ("fee", "parking") else None})
        result["states"][abbr] = state
    for case in BASES:
        result["national"]["bases"][case] = sum(r["bases"][case] for r in result["states"].values())
        result["national"]["scenarios"][case] = {}
        for policy in POLICIES:
            result["national"]["scenarios"][case][policy] = {}
            for level in LEVELS:
                state_values = [r["scenarios"][case][policy][level] for r in result["states"].values()]
                result["national"]["scenarios"][case][policy][level] = (None if any(value is None for value in state_values)
                    else sum(state_values))
    result["national"]["countySums"] = {case: {p: {level: sum(r["countySums"][case][p][level]
        for r in result["states"].values()) for level in LEVELS} for p in POLICIES} for case in BASES}
    input_rows = []
    for record in counties:
        row = {key: record.get(key) for key in ("state_abbr", "county_name", "fips", "sf_detached_units",
            "baseline_annual_units", "baseline_5yr_units", "permit_valuation_total", "avg_permit_value_per_unit",
            "scenario_cost_base", "tod_housing_share_new")}
        row["state_cost_fallback"] = record.get("avg_permit_value_per_unit") is None
        row.update({"baseline_" + case: result["counties"][record["fips"]]["bases"][case] for case in BASES})
        input_rows.append(row)
    report = {"states": len(states), "counties": len(counties), "state_scenarios": len(state_rows),
        "county_scenarios": len(county_rows),
        "central_geography_policy_response_cases": (len(states) + len(counties) + 1) * len(POLICIES) * len(LEVELS),
        "original_point_baselines_unchanged": all(production["states"][r["state_abbr"]]["fiveYear"] == r["baseline_5yr_units"] for r in states),
        "stored_policy_outputs_used_as_inputs": False,
        "causal_response_calibration": "Unavailable: parameters are transparent sensitivity assumptions.",
        "national_ranges": "Baseline stress cases crossed with separate response assumptions, not a joint confidence region.",
        "county_allocation": result["countyMethod"], "zero_response_extra": 0,
        "rounding": "Python ties-to-even; county first, except direct state transit; state cost reforms round after coverage reconciliation.",
        "unavailable_county_permit_references": sum(r["baseline_5yr_units"] is None for r in counties),
        "national": result["national"]}
    tables = {"policy_state_comparisons.csv": state_rows, "policy_county_comparisons.csv": county_rows,
        "policy_county_inputs.csv": input_rows,
        "policy_parameter_assumptions.csv": [{"parameter": key, **value} for key, value in values.items()]}
    return result, report, tables
