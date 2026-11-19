"""Build the analytical outputs from portable numerical inputs (offline).

Frozen mode uses the checked-in compact snapshot. An official-data refresh may
pass newly cleaned input/history paths; it must not overwrite the frozen
reference merely to make a regression test pass. Raw acquisition is separate.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from turnout.baseline import PLAN, build_baseline, read_history
from turnout.policies import build_scenarios


def write_csv(path, rows):
    path = Path(path)
    with path.open("w", encoding="utf-8", newline="") as stream:
        if rows:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def build_models(output_dir, policy_input_path, history_path, assumptions_path=None):
    """Recompute baseline and all five policies; no regression outputs are read.

    Returns the generated models and validation summaries for another build
    driver. All exported paths are relative to output_dir. This function reads
    no original website assets and needs only Python's standard library.
    """
    output_dir, policy_input_path, history_path = map(Path, (output_dir, policy_input_path, history_path))
    assumptions_path = Path(assumptions_path) if assumptions_path else ROOT / "config/assumptions.json"
    inputs = json.loads(policy_input_path.read_text(encoding="utf-8"))
    assumptions = json.loads(assumptions_path.read_text(encoding="utf-8"))
    history = read_history(history_path, inputs["states"])
    source = {
        "url": "https://www.census.gov/construction/bps/xls/state_history.xlsx",
        "file": history_path.name,
        "sha256": hashlib.sha256(history_path.read_bytes()).hexdigest(),
        "terms": "Public U.S. Census Bureau statistics; source attribution retained.",
        "data_release": "Final 2025 series released in 2026; history is a revised snapshot, not real-time vintages.",
        "input_mode": inputs.get("source", {}).get("mode", "caller-supplied cleaned inputs"),
    }
    production, baseline_report, baseline_tables = build_baseline(history, inputs["states"], source)
    scenarios, policy_report, policy_tables = build_scenarios(inputs, production, assumptions)
    output_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "production_forecast.json": production,
        "policy_scenarios.json": scenarios,
        "production_validation.json": baseline_report,
        "policy_validation.json": policy_report,
        "analysis_plan.json": PLAN,
    }
    for filename, value in files.items():
        write_json(output_dir / filename, value)
    for filename, global_name, value in (
        ("production-forecast.js", "PRODUCTION_FORECAST", production),
        ("policy-scenarios.js", "FORECAST_POLICY", scenarios),
    ):
        (output_dir / filename).write_text("window." + global_name + "=" + json.dumps(
            value, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + ";\n", encoding="utf-8")
    for filename, rows in {**baseline_tables, **policy_tables}.items():
        write_csv(output_dir / filename, rows)
    manifest = {
        "schema_version": "1.0",
        "inputs": {"policy_inputs": {"filename": policy_input_path.name,
            "sha256": hashlib.sha256(policy_input_path.read_bytes()).hexdigest()},
            "history": {"filename": history_path.name, "sha256": source["sha256"]},
            "assumptions": {"filename": assumptions_path.name,
                "sha256": hashlib.sha256(assumptions_path.read_bytes()).hexdigest()}},
        "stored_policy_outputs_used_as_inputs": False,
        "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(output_dir.iterdir()) if path.is_file() and path.name != "model_build_manifest.json"},
    }
    write_json(output_dir / "model_build_manifest.json", manifest)
    return {"production": production, "policy": scenarios,
            "baseline_validation": baseline_report, "policy_validation": policy_report,
            "manifest": manifest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "build/model")
    parser.add_argument("--policy-inputs", type=Path, default=ROOT / "data/snapshot/policy_inputs.json")
    parser.add_argument("--history", type=Path, default=ROOT / "data/snapshot/production_history.csv")
    parser.add_argument("--assumptions", type=Path, default=ROOT / "config/assumptions.json")
    args = parser.parse_args()
    result = build_models(args.output_dir, args.policy_inputs, args.history, args.assumptions)
    print(json.dumps({"selected_method": result["production"]["method"],
        "states": len(result["policy"]["states"]), "counties": len(result["policy"]["counties"]),
        "central_cases": result["policy_validation"]["central_geography_policy_response_cases"],
        "national_five_year_reference": result["production"]["national"]["fiveYear"],
        "output_dir": str(args.output_dir)}, indent=2))


if __name__ == "__main__":
    main()
