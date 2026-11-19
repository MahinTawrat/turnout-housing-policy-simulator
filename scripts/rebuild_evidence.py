"""Rebuild observed housing context and conditional demographic scenarios."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from turnout.evidence import rebuild_evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',type=Path,default=ROOT/'data/snapshot/analytical_inputs.json.gz')
    parser.add_argument('--reference',type=Path,default=ROOT/'data/snapshot/analytical_geography.json')
    parser.add_argument('--benchmarks',type=Path,default=ROOT/'data/snapshot/independent_benchmarks.csv')
    parser.add_argument('--raw-dir',type=Path,help='Flat official-source acquisition cache; replaces snapshot input.')
    parser.add_argument('--output',type=Path,default=ROOT/'data/generated/evidence')
    parser.add_argument('--assets',type=Path,help='Write decision-data.js and refreshed observed-context adapters here.')
    parser.add_argument('--downloads',type=Path,help='Write public ACS, population, CHAS and benchmark CSVs here.')
    args = parser.parse_args()
    summary = rebuild_evidence(
        args.snapshot,args.reference,args.output,benchmarks_path=args.benchmarks,
        browser_assets_dir=args.assets,downloads_dir=args.downloads,raw_dir=args.raw_dir,
    )
    print(json.dumps(summary,indent=2))


if __name__=='__main__':
    main()
