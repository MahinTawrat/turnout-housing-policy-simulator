"""Build the approved interactive website and recompute its analytical results."""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from turnout.browser import write_browser_data
from turnout.evidence import rebuild_evidence
from rebuild_model import build_models


def build(inputs_dir=None, mode='release'):
    source=Path(inputs_dir) if inputs_dir else ROOT/('data/snapshot' if mode=='frozen' else 'data/release')
    model=ROOT/'build/model';evidence_dir=ROOT/'build/evidence';dist=ROOT/'dist'
    if dist.exists():
        if dist.resolve()!=ROOT.resolve()/'dist':raise ValueError('Unexpected website output path')
        shutil.rmtree(dist)
    shutil.copytree(ROOT/'src/web',dist)
    assumptions=json.loads((ROOT/'config/assumptions.json').read_text(encoding='utf-8'))
    policy_inputs=json.loads((source/'policy_inputs.json').read_text(encoding='utf-8'))
    result=build_models(model,source/'policy_inputs.json',source/'production_history.csv')
    evidence_inputs=source/'analytical_inputs.json'
    if not evidence_inputs.exists():evidence_inputs=source/'analytical_inputs.json.gz'
    rebuild_evidence(evidence_inputs,ROOT/'data/snapshot/analytical_geography.json',evidence_dir,
        benchmarks_path=source/'independent_benchmarks.csv' if (source/'independent_benchmarks.csv').exists() else ROOT/'data/snapshot/independent_benchmarks.csv',
        browser_assets_dir=evidence_dir/'assets',downloads_dir=dist/'data')
    evidence=json.loads((evidence_dir/'analytical_model.json').read_text(encoding='utf-8'))
    assets=dist/'assets';downloads=dist/'data';downloads.mkdir(parents=True,exist_ok=True)
    for name in ('production-forecast.js','policy-scenarios.js'):
        shutil.copy2(model/name,assets/name)
    for path in model.glob('*.csv'):shutil.copy2(path,downloads/path.name)
    aliases={'forecast_final_state_holdout.csv':'final_test_predictions.csv'}
    for alias,original in aliases.items():shutil.copy2(model/original,downloads/alias)
    scores=result['baseline_validation']['development_scores']
    import csv
    with (downloads/'forecast_method_test_scores.csv').open('w',newline='',encoding='utf-8') as stream:
        rows=[{'method':name,**values} for name,values in scores.items()]
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    shutil.copy2(evidence_dir/'assets/decision-data.js',assets/'decision-data.js')
    legacy=ROOT/'data/snapshot/legacy_context' if mode=='frozen' else evidence_dir/'assets'
    for name in ('housing-needs.js','housing-types.js','structure-evidence.js','chas-affordability.js'):
        if mode=='frozen':(assets/name).write_bytes(gzip.decompress((legacy/(name+'.gz')).read_bytes()))
        else:shutil.copy2(legacy/name,assets/name)
    history_name='county_permits_history_1990_2025.csv'
    if mode in ('frozen','release'):(downloads/history_name).write_bytes(gzip.decompress((source/(history_name+'.gz')).read_bytes()))
    else:shutil.copy2(source/history_name,downloads/history_name)
    if mode=='frozen':shutil.copytree(ROOT/'data/snapshot/history',assets/'history',dirs_exist_ok=True)
    else:
        from turnout.history import write_browser_history
        geography_ids=json.loads((ROOT/'config/geographies.json').read_text(encoding='utf-8'))
        write_browser_history(downloads/history_name,assets/'history',current_fips=[r['fips'] for r in geography_ids['counties']])
    catalog=json.loads((ROOT/'config/source_catalog.json').read_text(encoding='utf-8'))
    if mode in ('official','release'):
        spatial=source/'spatial'
        overview_path=assets/'national-county-overview.js'
        overview=json.loads(overview_path.read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))
        if mode=='release':
            from turnout.browser import assignment
            maps=json.loads(gzip.decompress((source/'maps.json.gz').read_bytes()))
            assignment(assets/'state-geo.js','STATE_GEO',maps['state'])
            for abbr,geo in maps['counties'].items():
                path=assets/'counties/geo'/f'{abbr}.js';path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('window.COUNTY_GEO=window.COUNTY_GEO||{};window.COUNTY_GEO['+json.dumps(abbr)+']='+json.dumps(geo,separators=(',',':'))+';\n',encoding='utf-8')
            overview['geo']={'type':'FeatureCollection','features':[f for geo in maps['counties'].values() for f in geo['features']]}
        else:
            shutil.copytree(spatial/'display/assets',assets,dirs_exist_ok=True)
            county_geo=spatial/'display/counties.geojson'
            if not county_geo.exists():county_geo=spatial/'display/countys.geojson'
            overview['geo']=json.loads(county_geo.read_text(encoding='utf-8'))
        overview_path.write_text('window.NATIONAL_COUNTY_OVERVIEW='+json.dumps(overview,separators=(',',':'))+';\n',encoding='utf-8')
        for name in ('transit_exposure.csv','spatial_manifest.json','transit_exposure_delta.csv'):
            shutil.copy2(spatial/name,downloads/name)
        display_manifest=spatial/('display_boundaries_manifest.json' if mode=='release' else 'display/display_boundaries_manifest.json')
        shutil.copy2(display_manifest,downloads/'display_boundaries_manifest.json')
        catalog['datasets'].append({'id':'spatial_reconstruction','title':'Versioned transit reconstruction',
            'what':'Selected BTS stop modes, half-mile buffers, ACS tract weights, official map boundaries and input hashes.',
            'used':'Rebuild transit exposure and document differences from the inherited snapshot.',
            'source_url':'https://www.bts.gov/national-transit-map',
            'download_url':'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
            'local_download':'data/spatial_manifest.json','note':'This official reconstruction is a new version; it does not recover the missing original extraction.'})
        catalog['datasets'].append({'id':'acs_errata148','title':'Census notice: withheld New York tract data',
            'what':'Census withheld housing data for 14 tracts in the Wyandanch and Brentwood areas.',
            'used':'Explain unavailable Suffolk County, New York and national transit estimates.',
            'source_url':'https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html',
            'download_url':'https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html',
            'note':'Missing tract observations remain unavailable; they are not replaced with zero or older estimates.'})
        catalog['datasets'].append({'id':'display_boundaries','title':'Census 2024 display maps',
            'what':'Generalized state and county boundaries at 1:20,000,000 scale.',
            'used':'Draw the interactive map; detailed tract boundaries are used separately for calculations.',
            'source_url':'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
            'download_url':'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_20m.zip',
            'local_download':'data/display_boundaries_manifest.json',
            'note':'The manifest identifies both state and county files, source hashes and the display version.'})
    geographies=json.loads((ROOT/'config/geographies.json').read_text(encoding='utf-8'))
    version_hash=hashlib.sha256((model/'policy-scenarios.js').read_bytes()+(assets/'decision-data.js').read_bytes())
    for path in sorted((ROOT/'src/web').rglob('*')):
        if path.is_file() and path.suffix in ('.js','.css','.html'):
            version_hash.update(path.relative_to(ROOT/'src/web').as_posix().encode());version_hash.update(path.read_bytes())
    version_hash.update(json.dumps(catalog,sort_keys=True).encode())
    if mode=='release':version_hash.update((source/'maps.json.gz').read_bytes())
    elif mode=='official':version_hash.update((source/'spatial/display/display_boundaries_manifest.json').read_bytes())
    version=version_hash.hexdigest()[:12]
    browser=write_browser_data(dist,policy_inputs,evidence,result['production'],result['policy'],assumptions,geographies,catalog,version)
    if mode in ('official','release'):
        release={'mode':mode,'spatialVersion':json.loads((source/'spatial/spatial_manifest.json').read_text())['reconstruction_version'],
            'transitMissingReason':'Census did not publish housing counts for 14 New York areas. Transit estimates that need those counts are not available.'}
        with (assets/'challenge-metadata.js').open('a',encoding='utf-8') as stream:stream.write('window.DATA_RELEASE='+json.dumps(release,separators=(',',':'))+';\n')
    index=(dist/'index.html').read_text(encoding='utf-8')
    import re
    index=re.sub(r'(assets/[^"?]+)\?[^"<]+',lambda m:m[1]+'?v='+version,index)
    (dist/'index.html').write_text(index,encoding='utf-8',newline='\n')
    shutil.copy2(ROOT/'LICENSE',dist/'LICENSE.txt')
    files={p.relative_to(dist).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dist.rglob('*')) if p.is_file()}
    report={'status':'PASS','mode':mode,'version':version,'states':browser['states'],'counties':browser['counties'],
        'model_results_recomputed':True,'source_refresh':mode=='official','files':files}
    (ROOT/'build/build_report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='files'},indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs',type=Path)
    parser.add_argument('--mode',choices=('frozen','release','official'),default='release')
    args=parser.parse_args();build(args.inputs,args.mode)
