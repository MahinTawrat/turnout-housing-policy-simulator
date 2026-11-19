"""Known forecasts, temporal separation, source parsing and holdout tests."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from turnout import baseline


class BaselineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = json.loads((ROOT / "data/snapshot/policy_inputs.json").read_text(encoding="utf-8"))
        cls.states = cls.inputs["states"]
        cls.history = baseline.read_history(ROOT / "data/snapshot/production_history.csv", cls.states)
        cls.result, cls.report, cls.tables = baseline.build_baseline(cls.history, cls.states)
        cls.expected = json.loads((ROOT / "data/snapshot/expected_results.json").read_text(encoding="utf-8"))["production"]

    def test_four_methods_have_known_numeric_behavior(self):
        values = [10, 20, 30, 40, 50]
        self.assertEqual(baseline.forecast(values, "last_year"), [50.] * 5)
        self.assertEqual(baseline.forecast(values, "mean_3"), [40] * 5)
        self.assertEqual(baseline.forecast(values, "mean_5"), [30] * 5)
        for actual, expected in zip(baseline.forecast(values, "damped_trend_5"), [58, 64.4, 69.52, 73.616, 76.8928]):
            self.assertAlmostEqual(actual, expected)
        self.assertEqual(baseline.forecast([50, 40, 30, 20, 10], "damped_trend_5"), [2., 0., 0., 0., 0.])
        for bad in ([1, 2], [1, 2, 3, 4, -1], [1, 2, 3, 4, float("nan")]):
            with self.assertRaises(ValueError):
                baseline.forecast(bad, "last_year")
        with self.assertRaises(ValueError):
            baseline.forecast(values, "unknown")

    def test_state_years_and_structure_types_reconcile(self):
        self.assertEqual(len(self.history), 51 * 26)
        self.assertEqual(len({(r["state_abbr"], r["year"]) for r in self.history}), 1326)
        self.assertEqual({r["year"] for r in self.history}, set(range(2000, 2026)))
        self.assertEqual(sum(r["total"] for r in self.history if r["year"] == 2025), 1_431_616)
        for row in self.history:
            self.assertEqual(row["two_units"] + row["three_four_units"] + row["five_plus_units"], row["multifamily"])
            self.assertEqual(row["single_family"] + row["multifamily"], row["total"])

    def test_forecast_data_exactly_match_the_approved_release(self):
        for key, expected in self.expected.items():
            self.assertEqual(self.result[key], expected, key)

    def test_predict_cannot_read_future_outcomes(self):
        altered = [{**row, **({key: 999_999_999 for key in ("single_family", "multifamily", "total")}
            if row["year"] > 2020 else {})} for row in self.history]
        for method in baseline.METHODS:
            self.assertEqual(baseline.predict(self.history, "MN", 2020, method),
                             baseline.predict(altered, "MN", 2020, method))
        extended = self.history + [{"state_abbr": "MN", "year": 2026,
                                   "single_family": 999_999_999, "multifamily": 999_999_999}]
        self.assertEqual(baseline.predict(self.history, "MN", 2025, "last_year"),
                         baseline.predict(extended, "MN", 2025, "last_year"))

    def test_final_holdout_does_not_choose_the_model_or_calibration_range(self):
        # Distort reserved target years while preserving the final anchor. The
        # frozen development/calibration choices must not change in response.
        altered = [{**row, **({key: row[key] * 2 for key in ("single_family", "two_units", "three_four_units", "five_plus_units", "multifamily", "total")}
            if 2021 <= row["year"] < 2025 else {})} for row in self.history]
        result, report, _ = baseline.build_baseline(altered, self.states)
        self.assertEqual(result["method"], self.result["method"])
        self.assertEqual(report["development_scores"], self.report["development_scores"])
        self.assertEqual(report["calibration_score"], self.report["calibration_score"])
        self.assertEqual(report["range_scaled_errors"], self.report["range_scaled_errors"])
        self.assertNotEqual(report["final_test"], self.report["final_test"])

    def test_declared_stages_and_distinct_error_metrics(self):
        development = self.tables["development_predictions.csv"]
        calibration = self.tables["calibration_predictions.csv"]
        final = self.tables["final_test_predictions.csv"]
        self.assertEqual(len(development), 4 * 6 * 51)
        self.assertEqual(len(calibration), 5 * 51)
        self.assertEqual(len(final), 51)
        self.assertEqual({r["origin"] for r in development}, set(range(2005, 2011)))
        self.assertEqual({r["origin"] for r in calibration}, set(range(2011, 2016)))
        self.assertEqual({(r["target_start"], r["target_end"]) for r in final}, {(2021, 2025)})
        selected = min(baseline.METHODS, key=lambda method: self.report["development_scores"][method]["mean_state_APE"])
        self.assertEqual(selected, "last_year")
        self.assertEqual(self.result["method"], selected)
        self.assertAlmostEqual(self.report["final_test"]["mean_state_APE"], 12.014605165964403)
        self.assertAlmostEqual(self.result["national"]["test"]["absolute_percentage_error"], 6.154105833223187)
        mn = self.result["states"]["MN"]["test"]
        self.assertEqual(mn["predicted"], 140_740)
        self.assertEqual(mn["actual"], 132_305)
        self.assertAlmostEqual(mn["absolute_percentage_error"], 100 * 8435 / 132305)

    def test_frozen_range_and_later_stress_range_are_different_evaluations(self):
        calibration = self.tables["calibration_predictions.csv"]
        deployment = self.tables["deployment_error_history.csv"]
        calibration_errors = [baseline.quantile([r["scaled_forecast_error"] for r in calibration], p) for p in (.1, .9)]
        deployment_errors = [baseline.quantile([r["scaled_forecast_error"] for r in deployment], p) for p in (.1, .9)]
        self.assertEqual(self.report["range_scaled_errors"], calibration_errors)
        self.assertEqual(self.result["rangeScaledErrors"], deployment_errors)
        self.assertNotEqual(calibration_errors, deployment_errors)
        self.assertIn("Not tested", self.report["deployment_range_independent_coverage"])
        self.assertEqual(sum(r["range_covers_actual"] for r in self.tables["final_test_predictions.csv"]), 35)
        self.assertEqual(self.result["states"]["MN"]["low"], 44_666)
        self.assertEqual(self.result["states"]["MN"]["high"], 166_268)

    def test_invalid_history_fails_instead_of_silently_filling(self):
        for changed in (self.history[:-1], self.history + [self.history[0]]):
            with self.assertRaises(ValueError):
                baseline.validate_history(changed, self.states)
        wrong = deepcopy(self.history)
        wrong[0]["multifamily"] += 1
        with self.assertRaisesRegex(ValueError, "reconcile"):
            baseline.validate_history(wrong, self.states)
        wrong = deepcopy(self.states)
        wrong[0]["baseline_annual_units"] += 1
        with self.assertRaisesRegex(ValueError, "permit anchor"):
            baseline.validate_history(self.history, wrong)

    def test_xlsx_shared_inline_sparse_and_multiletter_cells(self):
        book = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name=" Example " sheetId="1" r:id="rId1"/></sheets></workbook>'
        rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'
        strings = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>shared </t></r><r><t>text</t></r></si></sst>'
        sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c><c r="AA1"><v>123.5</v></c><c r="AB1"/></row></sheetData></worksheet>'
        with tempfile.TemporaryDirectory(prefix="turnout_xlsx_test_") as directory:
            path = Path(directory) / "example.xlsx"
            with zipfile.ZipFile(path, "w") as archive:
                for filename, text in (("xl/workbook.xml", book), ("xl/_rels/workbook.xml.rels", rels),
                                       ("xl/sharedStrings.xml", strings), ("xl/worksheets/sheet1.xml", sheet)):
                    archive.writestr(filename, text)
            self.assertEqual(list(baseline.xlsx_sheets(path)), [("Example", [{1: "shared text", 3: "inline", 27: 123.5, 28: None}])])


if __name__ == "__main__":
    unittest.main()
