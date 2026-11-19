"""Pin compact, processed official-build inputs for the offline public release."""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import re
import shutil

ROOT=Path(__file__).resolve().parents[1]


def freeze(inputs,output):
    inputs,output=Path(inputs),Path(output)
    manifest=json.loads((inputs/'official_build_manifest.json').read_text(encoding='utf-8'))
    if manifest['status']!='PASS':raise ValueError('Official build has not passed')
    output.mkdir(parents=True,exist_ok=True)
    for name in ('analytical_inputs.json','county_permits_history_1990_2025.csv'):
        raw=(inputs/name).read_bytes();packed=gzip.compress(raw,compresslevel=9,mtime=0)
        if gzip.decompress(packed)!=raw:raise RuntimeError('Compressed input verification failed')
        (output/(name+'.gz')).write_bytes(packed)
    for name in ('policy_inputs.json','production_history.csv','independent_benchmarks.csv'):
        shutil.copy2(inputs/name,output/name)
    display=inputs/'spatial/display/assets'
    state=json.loads((display/'state-geo.js').read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))
    counties={}
    for path in sorted((display/'counties/geo').glob('*.js')):
        match=re.search(r'window\.COUNTY_GEO\[[^\]]+\]\s*=(\{.*\});',path.read_text(encoding='utf-8'))
        if not match:raise ValueError('Unexpected display adapter: '+path.name)
        counties[path.stem]=json.loads(match[1])
    if len(state['features'])!=51 or sum(len(r['features']) for r in counties.values())!=3144:raise ValueError('Official map coverage mismatch')
    (output/'maps.json.gz').write_bytes(gzip.compress(json.dumps({'state':state,'counties':counties},separators=(',',':')).encode(),compresslevel=9,mtime=0))
    (output/'spatial').mkdir(exist_ok=True)
    for name in ('spatial_manifest.json','transit_exposure.csv','transit_exposure_delta.csv'):
        shutil.copy2(inputs/'spatial'/name,output/'spatial'/name)
    shutil.copy2(inputs/'spatial/display/display_boundaries_manifest.json',output/'spatial/display_boundaries_manifest.json')
    record={**manifest,'files':{p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file() and p.name!='release.json'}}
    (output/'release.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':'PASS','processed_files':len(record['files']),'spatial_version':record['spatial_version']},indent=2))
    return record


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inputs',type=Path,default=ROOT/'data/generated/official')
    p.add_argument('--output',type=Path,default=ROOT/'data/release')
    args=p.parse_args();freeze(args.inputs,args.output)
