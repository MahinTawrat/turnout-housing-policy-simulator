"""Describe changes from the approved reference; never feed them into calculations."""
from pathlib import Path
import csv
import hashlib
import json

ROOT=Path(__file__).resolve().parents[1]


def report_changes():
    old=json.loads((ROOT/'data/snapshot/expected_results.json').read_text())['policy']
    new=json.loads((ROOT/'build/model/policy_scenarios.json').read_text())
    rows=[]
    for scope in ('national','states','counties'):
        before={'US':old[scope]} if scope=='national' else old[scope]
        after={'US':new[scope]} if scope=='national' else new[scope]
        for geoid,r in after.items():
            for policy in ('adu','missing_middle','fee','parking','tod'):
                for level in ('low','default','high'):
                    previous=before[geoid]['scenarios']['central'][policy][level]
                    current=r['scenarios']['central'][policy][level]
                    if previous==current:continue
                    if policy!='tod':raise ValueError('Unexpected non-transit policy change; review before release')
                    rows.append({'scope':scope,'geography':geoid,'policy':policy,'response':level,'previous_extra':previous,
                        'released_extra':current,'difference':None if previous is None or current is None else current-previous,
                        'reason':'Official ACS suppression: unavailable point' if current is None else 'Separately versioned official BTS/TIGER exposure reconstruction'})
    output=ROOT/'data/release/policy_changes.csv'
    with output.open('w',newline='',encoding='utf-8') as stream:
        if rows:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    mn=new['states']['MN']['scenarios']['central']
    text='''# Official-source release notes

The approved interface and five-year model are retained. The current release replaces inherited transit exposure with the documented official-source reconstruction. The earlier figures remain reproducible with `python scripts/build.py --mode frozen`.

All ADU, missing-middle, fees and parking additions match the approved reference across states, counties and the United States. The historical permit baseline is unchanged. Transit exposure changes are recorded in [the comparison CSV](../data/release/policy_changes.csv).

## Minnesota, Default assumptions

| Conditional scenario | Possible extra homes |
|---|---:|
| ADU | 16,803 |
| Missing middle | 8,398 |
| Fees | 4,528 |
| Parking | 1,086 |
| Transit | '''+f"{mn['tod']['default']:,}"+''' |

Transit changes from 653 to 647 under the documented reconstruction; the ranking is unchanged. This ranks modeled additions under chosen assumptions, not the best local policy. Materials using the earlier transit figure describe the frozen reference version and should be updated if presenting the current official-source release.

## Withheld New York tract data

[Census Errata 148](https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html) explains withheld observations for 14 tracts. Transit point estimates that depend on them—Suffolk County, New York State and the national transit aggregate—remain unavailable. They are not filled with zero, another vintage or an undisclosed partial sum. The other four reforms remain available.

The source manifests record the exact missing IDs and processing. The published-area minus available-tract difference is not a separately observed missing-tract count or a confidence interval.
'''
    (ROOT/'docs/RELEASE_NOTES.md').write_text(text,encoding='utf-8')
    manifest_path=ROOT/'data/release/release.json';manifest=json.loads(manifest_path.read_text())
    manifest['files']['policy_changes.csv']=hashlib.sha256(output.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'changed_central_response_cases':len(rows),'non_transit_changes':0,'minnesota_transit':mn['tod']['default']},indent=2))


if __name__=='__main__':report_changes()
