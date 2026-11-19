"""Create a deterministic Hostinger/static-host package after local checks pass."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parents[1]


def package():
    build=json.loads((ROOT/'build/build_report.json').read_text())
    for name in ('release_validation.json','frontend_validation.json'):
        report=json.loads((ROOT/'build'/name).read_text())
        if report['status']!='PASS' or report.get('buildVersion')!=build['version']:raise RuntimeError('Current build has not passed required check: '+name)
    web=ROOT/'dist';target=ROOT/'build/The_Turnout_Hostinger.zip'
    payload={p.relative_to(web).as_posix():p.read_bytes() for p in sorted(web.rglob('*')) if p.is_file()}
    manifest={name:hashlib.sha256(data).hexdigest() for name,data in payload.items()}
    payload['SHA256SUMS.json']=(json.dumps(manifest,indent=2)+'\n').encode('utf-8')
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted(payload.items()):
            entry=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(entry,data)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip():raise RuntimeError('Package integrity failure')
    print(json.dumps({'archive':target.name,'files':len(payload),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2))


if __name__=='__main__':package()
