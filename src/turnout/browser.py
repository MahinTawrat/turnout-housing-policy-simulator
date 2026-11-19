"""Generate browser records from analytical inputs and calculated scenarios."""
from __future__ import annotations
from collections import defaultdict
import json
from pathlib import Path

POLICIES=('adu','missing_middle','tod','parking','fee')
LEVELS=('low','default','high')


def assignment(path, name, value):
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    Path(path).write_text('window.'+name+'='+json.dumps(value,separators=(',',':'),ensure_ascii=False,allow_nan=False)+';\n',encoding='utf-8')


def records(inputs, evidence, policy, geographies):
    """Adapt neutral input fields; policy answers always come from the engine."""
    counties=[];states=[]
    identity={r['fips']:r for r in geographies['counties']}
    grouped=defaultdict(list)
    for source in inputs['counties']:
        row={**identity[source['fips']],**source}
        observed=evidence['county'][row['fips']]['evidence']
        row['housing_units']=observed['stock']['total']
        row['bps_available']=row['baseline_annual_units'] is not None
        row['bps_coverage_status']='Observed county BPS' if row['bps_available'] else 'County BPS unavailable'
        row['sf_detached_share']=row['sf_detached_units']/row['housing_units'] if row['housing_units'] else None
        row['tod_housing_share']=row['tod_housing_share_new']
        row['tod_housing_den_new']=row['housing_units']
        row['tod_housing_base_new']=row['housing_units']*row['tod_housing_share_new'] if row['housing_units'] is not None and row['tod_housing_share_new'] is not None else None
        row['tod_method']='Housing-weighted tract exposure within 0.5 mile of qualifying fixed-guideway transit; version recorded in source manifest.'
        scenario=policy['counties'][row['fips']]
        _answers(row,scenario)
        counties.append(row);grouped[row['state_abbr']].append(row)
    for source in inputs['states']:
        row=dict(source);group=grouped[row['state_abbr']]
        observed=evidence['state'][row['state_fips']]['evidence']
        row['housing_units']=observed['stock']['total']
        row['detached_sf_units']=sum(r['sf_detached_units'] for r in group)
        row['counties']=len(group)
        row['counties_missing_bps']=sum(not r['bps_available'] for r in group)
        row['old_county_sum_annual']=sum(r['baseline_annual_units'] or 0 for r in group)
        row['old_county_sum_5yr']=5*row['old_county_sum_annual']
        row['bps_housing_coverage_share']=sum(r['housing_units'] or 0 for r in group if r['bps_available'])/sum(r['housing_units'] or 0 for r in group)
        row['tod_housing_share']=row['tod_housing_share_new']
        row['tod_housing_den_new']=row['housing_units']
        row['tod_housing_base_new']=row['housing_units']*row['tod_housing_share_new'] if row['housing_units'] is not None and row['tod_housing_share_new'] is not None else None
        _answers(row,policy['states'][row['state_abbr']])
        states.append(row)
    return states,counties


def _answers(row,scenario):
    baseline=scenario['bases']['central']
    for p in POLICIES:
        for level in LEVELS:
            added=scenario['scenarios']['central'][p][level]
            row[f'{p}_added_{level}']=added
            row[f'{p}_total_{level}']=None if baseline is None or added is None else baseline+added
            row[f'{p}_pct_vs_baseline_{level}']=100*added/baseline if baseline and added is not None else None


def coverage(counties,evidence):
    def one(rows):
        return {'counties':len(rows),'permit_available':sum(r['bps_available'] for r in rows),
          'permit_missing':sum(not r['bps_available'] for r in rows),
          'permit_zero':sum(r['baseline_annual_units']==0 for r in rows),
          'cost_state_fallback':sum(r['avg_permit_value_per_unit'] is None for r in rows),
          'acs_available':sum(evidence['county'][r['fips']]['evidence']['stock']['total'] is not None for r in rows),
          'chas_available':sum(evidence['county'][r['fips']]['evidence'].get('chas',{}).get('lowTotal') is not None for r in rows)}
    return {'national':one(counties),'states':{abbr:one([r for r in counties if r['state_abbr']==abbr]) for abbr in sorted({r['state_abbr'] for r in counties})}}


def write_browser_data(output_dir,inputs,evidence,production,policy,assumptions,geographies,catalog,version):
    output=Path(output_dir);assets=output/'assets';assets.mkdir(parents=True,exist_ok=True)
    states,counties=records(inputs,evidence,policy,geographies)
    baseline={'annual':sum(s['baseline_annual_units'] for s in states),'fiveYear':production['national']['fiveYear']}
    with (assets/'core-data.js').open('w',encoding='utf-8',newline='\n') as stream:
        values={'APP_VERSION':version,'STATE_DATA':states,'ASSUMPTIONS':list(assumptions['parameters'].values()),
                'STATE_COMPARISON':[],'NATIONAL_BASELINE':baseline,'COUNTY_DATA':{},'COUNTY_GEO':{}}
        for name,value in values.items():stream.write('window.'+name+'='+json.dumps(value,separators=(',',':'),ensure_ascii=False)+';\n')
    for abbr in sorted({r['state_abbr'] for r in counties}):
        path=assets/'counties/data'/f'{abbr}.js';path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text('window.COUNTY_DATA['+json.dumps(abbr)+']='+json.dumps([r for r in counties if r['state_abbr']==abbr],separators=(',',':'),ensure_ascii=False)+';\n',encoding='utf-8')
    overview_path=assets/'national-county-overview.js'
    if overview_path.exists():
        text=overview_path.read_text(encoding='utf-8-sig');overview=json.loads(text.split('=',1)[1].strip().rstrip(';'))
        overview['values']={r['fips']:{'state':r['state_abbr'],'name':r.get('county_full_name',r['county_name']),
          'b':policy['counties'][r['fips']]['bases']['central'],
          'a':{p:[policy['counties'][r['fips']]['scenarios']['central'][p][l] for l in LEVELS] for p in POLICIES}} for r in counties}
        assignment(overview_path,'NATIONAL_COUNTY_OVERVIEW',overview)
    data_coverage=coverage(counties,evidence)
    (assets/'challenge-metadata.js').write_text('window.SOURCE_CATALOG='+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+';\nwindow.DATA_COVERAGE='+json.dumps(data_coverage,separators=(',',':'))+';\n',encoding='utf-8')
    return {'states':len(states),'counties':len(counties),'coverage':data_coverage}
