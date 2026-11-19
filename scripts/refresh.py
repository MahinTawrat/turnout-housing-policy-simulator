"""Acquire official inputs, rebuild the analysis, and build the same web interface.

The official spatial reconstruction is separately versioned. It does not claim
to recover the missing original transit extraction or silently overwrite the
approved frozen snapshot. Large source files stay in the excluded local cache.
"""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from turnout.acquisition import acquire, atomic_json
from turnout.baseline import parse_history
from turnout.benchmarks import rebuild_benchmarks
from turnout.cleaning import clean_policy_inputs
from turnout.evidence import rebuild_evidence
from turnout.history import clean_county_history, write_browser_history
from turnout.spatial import reconstruct_exposure


def refresh(cache_dir,output_dir,*,refresh_sources=False,seed_dirs=(),prepare_only=False):
    cache_dir,output_dir=Path(cache_dir),Path(output_dir)
    output_dir.mkdir(parents=True,exist_ok=True)
    print('Acquiring and verifying official data.',flush=True)
    acquired=acquire(cache_dir,refresh=refresh_sources,groups=('all',),seed_dirs=seed_dirs)
    print('Parsing independent population benchmarks.',flush=True)
    benchmarks=rebuild_benchmarks(cache_dir,ROOT/'config/geographies.json',output_dir)
    print('Rebuilding ACS, population and HUD evidence.',flush=True)
    rebuilt=rebuild_evidence(ROOT/'data/snapshot/analytical_inputs.json.gz',ROOT/'data/snapshot/analytical_geography.json',output_dir,
        benchmarks_path=benchmarks['csv'],raw_dir=cache_dir)
    print('Rebuilding observed county permit history.',flush=True)
    history=clean_county_history(cache_dir,output_dir/'county_permits_history_1990_2025.csv')
    geographies=json.loads((ROOT/'config/geographies.json').read_text(encoding='utf-8'))
    write_browser_history(output_dir/'county_permits_history_1990_2025.csv',output_dir/'history',current_fips=[r['fips'] for r in geographies['counties']])
    print('Reconstructing versioned transit exposure and official map boundaries.',flush=True)
    spatial=reconstruct_exposure(cache_dir,output_dir/'spatial',comparison_inputs=ROOT/'data/snapshot/policy_inputs.json')
    print('Cleaning policy inputs and state permit history.',flush=True)
    inputs=clean_policy_inputs(cache_dir/'st2025a.txt',cache_dir/'co2025a.txt',output_dir/'analytical_model.json',
        ROOT/'config/geographies.json',output_dir/'spatial/transit_exposure.json',output_dir/'policy_inputs.json')
    state_history=parse_history(cache_dir/'state_history.xlsx',inputs['states'])
    with (output_dir/'production_history.csv').open('w',newline='',encoding='utf-8') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(state_history[0]));writer.writeheader();writer.writerows(state_history)
    report={'status':'PASS','mode':'official','sources_verified':len(acquired['sources']),
            'spatial_version':spatial['reconstruction_version'],'historical_rows':history.get('rows'),
            'display_version':json.loads((output_dir/'spatial/display/display_boundaries_manifest.json').read_text(encoding='utf-8'))['display_reconstruction_version'],
            'source_snapshot_preserved':True,
            'interpretation':'Separately versioned official reconstruction. Transit and display results can differ from the approved frozen release.'}
    atomic_json(output_dir/'official_build_manifest.json',report)
    if not prepare_only:
        from build import build
        build(output_dir,'official')
    print(json.dumps(report,indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir',type=Path,default=ROOT/'data/raw')
    parser.add_argument('--output',type=Path,default=ROOT/'data/generated/official')
    parser.add_argument('--refresh-sources',action='store_true',help='Permit revised upstream data while retaining previous cached bytes')
    parser.add_argument('--seed-dir',type=Path,action='append',default=[])
    parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args()
    refresh(args.cache_dir,args.output,refresh_sources=args.refresh_sources,seed_dirs=args.seed_dir,prepare_only=args.prepare_only)
