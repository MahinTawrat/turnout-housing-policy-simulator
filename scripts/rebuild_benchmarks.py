"""Parse independently published CA/NC population projections after acquisition."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from turnout.benchmarks import rebuild_benchmarks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-dir',required=True,type=Path,help='Official core acquisition cache.')
    parser.add_argument('--geographies',type=Path,default=ROOT/'config/geographies.json')
    parser.add_argument('--output',type=Path,default=ROOT/'data/generated/benchmarks')
    args = parser.parse_args()
    print(json.dumps(rebuild_benchmarks(args.raw_dir,args.geographies,args.output),indent=2))


if __name__=='__main__':
    main()
