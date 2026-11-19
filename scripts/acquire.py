"""Download and verify official data; optionally build observed history/GIS outputs."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from turnout.acquisition import acquire


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache-dir', type=Path, default=ROOT / 'data/raw')
    p.add_argument('--group', '--groups', nargs='+', choices=['core', 'history', 'spatial', 'all'], default=['core'])
    p.add_argument('--state', nargs='+', help='State abbreviations or FIPS; spatial default is all 50 states plus DC')
    p.add_argument('--seed-dir', action='append', type=Path, default=[], help='Reuse existing official raw files after format/hash verification')
    p.add_argument('--refresh', action='store_true', help='Retrieve revised upstream data, retaining replaced cache versions')
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--history-output', type=Path)
    p.add_argument('--history-browser-output', type=Path, help='Write pure observed-history JS in this assets/history directory')
    p.add_argument('--spatial-output', type=Path, help='Write versioned transit exposure and official display GeoJSON')
    p.add_argument('--comparison-inputs', type=Path, help='Neutral frozen policy-input JSON used only for GIS delta reporting')
    args = p.parse_args()
    if not 1 <= args.workers <= 8:
        p.error('--workers must be between 1 and 8')
    manifest = acquire(args.cache_dir, args.refresh, tuple(args.group), args.state, args.seed_dir, max_workers=args.workers)
    summary = {'status': 'PASS', 'verified_sources': len(manifest['sources']),
               'manifest': str(args.cache_dir / 'acquisition_manifest.json')}
    if args.history_output:
        from turnout.history import clean_county_history, write_browser_history
        summary['history'] = clean_county_history(args.cache_dir, args.history_output)
        if args.history_browser_output:
            summary['history_browser'] = write_browser_history(args.history_output, args.history_browser_output)
    if args.spatial_output:
        from turnout.spatial import reconstruct_exposure
        summary['spatial'] = reconstruct_exposure(args.cache_dir, args.spatial_output,
                                                args.state, args.comparison_inputs)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
