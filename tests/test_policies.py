"""Core arithmetic, aggregation and full frozen-release regression tests."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))
from turnout.baseline import build_baseline, read_history
from turnout.policies import BASES, LEVELS, POLICIES, allocate_county_baseline, build_scenarios, county_effect, parameters, validate_inputs
from rebuild_model import build_models


def read_json(path):
    return Path(path).read_text(encoding="utf-8")


class PolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = json.loads(read_json(ROOT / "data/snapshot/policy_inputs.json"))
        cls.assumptions = json.loads(read_json(ROOT / "config/assumptions.json"))
        cls.expected = json.loads(read_json(ROOT / "data/snapshot/expected_results.json"))
        history = read_history(ROOT / "data/snapshot/production_history.csv", cls.inputs["states"])
        cls.production = build_baseline(history, cls.inputs["states"])[0]
        cls.result, cls.report, cls.tables = build_scenarios(cls.inputs, cls.production, cls.assumptions)

    def test_independent_hand_calculated_examples(self):
        # 10000*.01; 10000*.0025*2; 1000*.2*.25;
        # 1000*(25000/250000)*.5; 1000*.5*(.4*30000/250000)*.5.
        record = {"sf_detached_units": 10_000, "tod_housing_share_new": .2, "scenario_cost_base": 250_000}
        expected = {"adu": 100, "missing_middle": 50, "tod": 50, "fee": 50, "parking": 12}
        for policy, answer in expected.items():
            self.assertEqual(county_effect(record, 1000, policy, "default", self.assumptions), answer)

    def test_savings_cap_is_applied_before_response(self):
        record = {"sf_detached_units": 0, "tod_housing_share_new": 0, "scenario_cost_base": 10_000}
        self.assertEqual(county_effect(record, 1000, "fee", "default", self.assumptions), 150)
        self.assertEqual(county_effect(record, 1000, "parking", "default", self.assumptions), 75)

    def test_county_rounding_is_ties_to_even(self):
        record = {"sf_detached_units": 50}
        self.assertEqual(county_effect(record, 0, "adu", "default", self.assumptions), 0)
        self.assertEqual(county_effect({"sf_detached_units": 150}, 0, "adu", "default", self.assumptions), 2)

    def test_missing_activity_does_not_become_zero_or_erase_stock_policy(self):
        record = {"sf_detached_units": 10_000, "tod_housing_share_new": .2, "scenario_cost_base": 250_000}
        self.assertEqual(county_effect(record, None, "adu", "default", self.assumptions), 100)
        self.assertEqual(county_effect(record, None, "missing_middle", "default", self.assumptions), 50)
        for policy in ("fee", "parking", "tod"):
            self.assertIsNone(county_effect(record, None, policy, "default", self.assumptions))
            self.assertEqual(county_effect(record, 0, policy, "default", self.assumptions), 0)
        for cost in (None, 0):
            for policy in ("fee", "parking"):
                self.assertIsNone(county_effect({**record, "scenario_cost_base": cost}, 1000, policy, "default", self.assumptions))
        self.assertEqual(county_effect({**record, "scenario_cost_base": None}, 1000, "tod", "default", self.assumptions), 50)

    def test_allocation_preserves_missing_and_does_not_invent_zero_reference_shares(self):
        self.assertIsNone(allocate_county_baseline(None, 1000, 2000))
        self.assertEqual(allocate_county_baseline(100, 1000, 2000), 200)
        self.assertEqual(allocate_county_baseline(0, 0, 0), 0)
        self.assertIsNone(allocate_county_baseline(0, 0, 500))

    def test_state_transit_and_coverage_use_distinct_aggregation_rules(self):
        states = [{"state_abbr": "AA", "baseline_annual_units": 200, "baseline_5yr_units": 1000,
                   "tod_housing_share_new": .4, "reconciliation_factor": 1.2}]
        counties = [{"fips": f"0100{i}", "state_abbr": "AA", "county_name": f"Example {i}",
            "sf_detached_units": 50, "baseline_annual_units": 100, "baseline_5yr_units": 500,
            "tod_housing_share_new": exposure, "scenario_cost_base": 250_000}
            for i, exposure in ((1, .1), (3, 0))]
        production = {"states": {"AA": {"low": 0, "fiveYear": 1000, "high": 2000}}, "countyMethod": "Test allocation"}
        result, _, _ = build_scenarios({"states": states, "counties": counties}, production, self.assumptions)
        state = result["states"]["AA"]
        self.assertEqual(state["scenarios"]["central"]["adu"]["default"], 0)  # Two .5s round separately.
        self.assertEqual(state["countySums"]["central"]["tod"]["default"], 12)
        self.assertEqual(state["scenarios"]["central"]["tod"]["default"], 100)
        self.assertEqual(state["scenarios"]["central"]["fee"]["default"], 60)  # 25+25, then *1.2.
        self.assertEqual(state["coverageFactors"]["upper"], 1)  # 2000 allocated / 2000 state.
        self.assertEqual(state["scenarios"]["upper"]["fee"]["default"], 100)

    def test_all_143820_cases_match_the_frozen_release(self):
        # Regression expectations are evidence about the old release, not inputs.
        for key in ("states", "counties", "national"):
            self.assertEqual(self.result[key], self.expected["policy"][key], key)
        self.assertEqual(self.report["central_geography_policy_response_cases"], 47_940)
        self.assertEqual(len(self.tables["policy_county_comparisons.csv"]), 141_480)
        self.assertEqual(len(self.tables["policy_state_comparisons.csv"]), 2_295)
        self.assertEqual((len(self.result["states"]) + len(self.result["counties"]) + 1) * 3 * 15, 143_820)

    def test_minnesota_default_and_national_reference_are_known_anchors(self):
        mn = self.result["states"]["MN"]
        self.assertEqual(mn["bases"]["central"], 104_735)
        self.assertEqual({p: mn["scenarios"]["central"][p]["default"] for p in POLICIES},
            {"adu": 16_803, "missing_middle": 8_398, "tod": 653, "parking": 1_086, "fee": 4_528})
        self.assertEqual(self.result["national"]["bases"]["central"], 7_158_080)

    def test_stock_results_stay_fixed_when_only_the_baseline_changes(self):
        for geography in list(self.result["states"].values()) + list(self.result["counties"].values()):
            for policy in ("adu", "missing_middle"):
                self.assertEqual(geography["scenarios"]["lower"][policy], geography["scenarios"]["central"][policy])
                self.assertEqual(geography["scenarios"]["upper"][policy], geography["scenarios"]["central"][policy])

    def test_new_inputs_change_outputs_without_changing_expected_fixture(self):
        changed = deepcopy(self.inputs)
        county = changed["counties"][0]
        fips, state = county["fips"], county["state_abbr"]
        county["sf_detached_units"] += 10_000
        result, _, _ = build_scenarios(changed, self.production, self.assumptions)
        for case in BASES:
            self.assertEqual(result["counties"][fips]["scenarios"][case]["adu"]["default"],
                self.result["counties"][fips]["scenarios"][case]["adu"]["default"] + 100)
            self.assertEqual(result["states"][state]["scenarios"][case]["adu"]["default"],
                self.result["states"][state]["scenarios"][case]["adu"]["default"] + 100)

    def test_invalid_assumptions_and_output_columns_fail_clearly(self):
        for value in (-.1, 1.1, float("nan")):
            changed = deepcopy(self.assumptions)
            changed["parameters"]["ADU 5-year take-up"]["default"] = value
            with self.assertRaises(ValueError):
                parameters(changed)
        changed = deepcopy(self.inputs)
        changed["counties"][0]["adu_added_default"] = 999
        with self.assertRaisesRegex(ValueError, "Stored policy outputs"):
            validate_inputs(changed)
        changed = deepcopy(self.inputs)
        changed["counties"][0]["fips"] = 1001
        with self.assertRaisesRegex(ValueError, "five-character"):
            validate_inputs(changed)
        with self.assertRaises(ValueError):
            county_effect({}, 0, "unknown", "default", self.assumptions)

    def test_build_driver_never_reads_regression_expected_results(self):
        original_read = Path.read_text
        def guarded_read(path, *args, **kwargs):
            if path.name == "expected_results.json":
                raise AssertionError("Calculation tried to read stored output expectations")
            return original_read(path, *args, **kwargs)
        with tempfile.TemporaryDirectory(prefix="turnout_model_test_") as directory:
            with mock.patch.object(Path, "read_text", guarded_read):
                built = build_models(directory, ROOT / "data/snapshot/policy_inputs.json",
                    ROOT / "data/snapshot/production_history.csv", ROOT / "config/assumptions.json")
            self.assertFalse(built["manifest"]["stored_policy_outputs_used_as_inputs"])
            self.assertEqual(built["policy"]["states"]["MN"], self.result["states"]["MN"])
            self.assertTrue((Path(directory) / "production-forecast.js").read_text(encoding="utf-8").startswith("window.PRODUCTION_FORECAST="))
            self.assertTrue((Path(directory) / "policy-scenarios.js").read_text(encoding="utf-8").startswith("window.FORECAST_POLICY="))


if __name__ == "__main__":
    unittest.main()
