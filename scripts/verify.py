"""Check the built site, source inventory and narrow secret patterns."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import sys
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

ROOT=Path(__file__).resolve().parents[1]


class LocalReferences(HTMLParser):
    def __init__(self):
        super().__init__();self.references=[]

    def handle_starttag(self,tag,attrs):
        self.references.extend(value for key,value in attrs if key in ('src','href') and value)


def verify():
    web=ROOT/'dist'
    errors=[];checked=0
    index=(web/'index.html').read_text(encoding='utf-8')
    build=json.loads((ROOT/'build/build_report.json').read_text(encoding='utf-8'))
    for name,digest in build['files'].items():
        path=web/name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:errors.append('Built file changed after build: '+name)
    for page in sorted(web.rglob('*.html')):
        parser=LocalReferences();parser.feed(page.read_text(encoding='utf-8'))
        for ref in parser.references:
            target=urlsplit(ref)
            if target.scheme or target.netloc or not target.path:continue
            path=(page.parent/unquote(target.path)).resolve()
            if not path.is_relative_to(web.resolve()) or not path.is_file():
                errors.append('Missing local page asset: '+page.relative_to(web).as_posix()+' -> '+ref)
            checked+=1
    metadata=(web/'assets/challenge-metadata.js').read_text(encoding='utf-8')
    catalog,_=json.JSONDecoder().raw_decode(metadata.split('window.SOURCE_CATALOG=',1)[1])
    for row in catalog['datasets']+catalog['research']:
        ref=row.get('local_download')
        if ref and not (web/ref).is_file():errors.append('Missing source download: '+ref)
    model=json.loads((ROOT/'build/model/policy_scenarios.json').read_text(encoding='utf-8'))
    if len(model['states'])!=51 or len(model['counties'])!=3144:errors.append('Unexpected geography coverage')
    for case in ('lower','central','upper'):
        if model['national']['bases'][case]!=sum(r['bases'][case] for r in model['states'].values()):errors.append('National baseline reconciliation: '+case)
    secrets=[rb'\bgh[pousr]_[A-Za-z0-9_]{30,}',rb'\bgithub_pat_[A-Za-z0-9_]{50,}',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',rb'\bAKIA[0-9A-Z]{16}\b']
    paths=[ROOT/'README.md',ROOT/'package.json',ROOT/'pyproject.toml']
    for directory in ('src','scripts','tests','config','.github','docs'):
        paths.extend(p for p in (ROOT/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    for path in paths:
        content=path.read_bytes()
        if any(re.search(pattern,content) for pattern in secrets):errors.append('Potential committed credential: '+path.relative_to(ROOT).as_posix())
        if re.search(rb'[A-Z]:[\\/]+Users[\\/]+[^\r\n"/\\]+[\\/]',content):errors.append('Personal machine path: '+path.relative_to(ROOT).as_posix())
    report={'buildVersion':build['version'],'status':'FAIL' if errors else 'PASS','page_assets_checked':checked,'source_entries':len(catalog['datasets']),
            'states':len(model['states']),'counties':len(model['counties']),'narrow_secret_scan_files':len(paths),'errors':errors,
            'limits':'Local checks do not establish the status of GitHub security settings or remote scans.'}
    (ROOT/'build/release_validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
    if errors:raise SystemExit(1)
    return report


if __name__=='__main__':verify()
