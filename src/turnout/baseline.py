"""Historical permit baseline and frozen evaluation protocol.

Four simple methods are selected on declared development folds. The 2021–2025
holdout is kept separate from model selection and from the later descriptive
stress envelope. This module performs no network or website reads.
"""
from __future__ import annotations

import csv
import math
import posixpath
import statistics
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

METHODS = ('last_year', 'mean_3', 'mean_5', 'damped_trend_5')


LABELS = {'last_year':'Latest year held flat', 'mean_3':'Recent three-year average',
          'mean_5':'Recent five-year average', 'damped_trend_5':'Five-year damped trend'}


PLAN = {
    'outcome':'New privately owned housing units authorized by building permits',
    'geographies':'50 states and DC; territories excluded',
    'observed_years':[2000,2025], 'forecast_years':[2026,2030],
    'candidate_methods':list(METHODS),
    'development_origins':list(range(2005,2011)),
    'calibration_origins':list(range(2011,2016)),
    'final_test_origin':2020,
    'horizon_years':5, 'damping':0.8,
    'selection_rule':'Lowest equal-weight mean state five-year absolute percentage error on development origins; ties follow candidate order. One method nationally, not 51 locally selected methods.',
    'interval_rule':'Pooled state (actual minus predicted) five-year errors divided by the preceding five-year observed total at calibration origins; 10th and 90th interpolated percentiles applied to that same trailing-total scale, clipped at zero and expanded to contain the point estimate. Descriptive historical-error envelope, not a calibrated probability interval.',
    'deployment_range_rule':'After preserving the frozen final-test results, refresh only the descriptive deployment error envelope using all completed origins 2005–2020. The refreshed range has no independent coverage test. Do not reselect the point model or overwrite the frozen interval evaluation.',
    'information_limits':['Latest revised history, not archived real-time vintages.',
      'Rolling target windows overlap; errors are dependent.',
      'Development targets end in 2015; calibration targets end in 2016–2020 and overlap some earlier development target years.',
      '2021–2025 outcomes are excluded from selection and calibration.',
      'National range sums state stress bounds; it has no nominal probability coverage.',
      'Forecast window is 2026–2030 with a 2025 observation cutoff, not a forecast issued in 2025. The final 2025 data were released in 2026. No 2026 observations are used.',
      'Existing regulatory/economic conditions are represented implicitly by recent production; no legal-status or future macroeconomic model is fitted.'],
}


NS = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def xlsx_sheets(path):
    """Read cell values from XLSX without installing a spreadsheet dependency."""
    with zipfile.ZipFile(path) as z:
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            shared=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        book=ET.fromstring(z.read('xl/workbook.xml'))
        for sheet in book.find('s:sheets',NS):
            rid=sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target=rels[rid]
            entry=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
            rows=[]
            for row in ET.fromstring(z.read(entry)).findall('.//s:sheetData/s:row',NS):
                cells={}
                for cell in row.findall('s:c',NS):
                    ref=cell.attrib['r']; letters=''.join(c for c in ref if c.isalpha())
                    col=0
                    for letter in letters:col=26*col+ord(letter)-64
                    value=cell.find('s:v',NS)
                    if cell.attrib.get('t')=='inlineStr':v=''.join(cell.find('s:is',NS).itertext())
                    elif value is None:v=None
                    elif cell.attrib.get('t')=='s':v=shared[int(value.text)]
                    else:
                        try:v=float(value.text);v=int(v) if v.is_integer() else v
                        except ValueError:v=value.text
                    cells[col]=v
                rows.append(cells)
            yield sheet.attrib['name'].strip(),rows


def parse_history(path,states):
    supported={s['state_abbr'] for s in states}
    types={'Total Units':'total','1 Unit':'single_family','2 Units':'two_units',
           '3-4 Units':'three_four_units','5+ Units':'five_plus_units'}
    records={}
    for title,rows in xlsx_sheets(path):
        if title not in types:continue
        header=next(r for r in rows if r.get(1)=='Universe' and str(r.get(2)).strip()=='Year' and r.get(3)=='AL')
        columns={abbr:c+1 for c,abbr in header.items() if abbr in supported}
        if set(columns)!=supported:raise ValueError('Missing state columns: '+title)
        for row in rows:
            year=row.get(2)
            if not isinstance(year,int) or not 2000<=year<=2025:continue
            for abbr,col in columns.items():
                value=row.get(col)
                if not isinstance(value,(int,float)) or value<0 or int(value)!=value:
                    raise ValueError(f'Invalid permit count: {abbr} {year} {title} {value}')
                r=records.setdefault((abbr,year),{'state_abbr':abbr,'year':year,'survey_universe':row.get(1)})
                r[types[title]]=int(value)
    if len(records)!=51*26:raise ValueError('History must have 1,326 state-year rows')
    for (abbr,year),r in records.items():
        if set(types.values())-r.keys():raise ValueError('Missing structure type')
        r['multifamily']=r['two_units']+r['three_four_units']+r['five_plus_units']
        if r['single_family']+r['multifamily']!=r['total']:
            raise ValueError(f'Structure counts do not reconcile: {abbr} {year}')
    # Workbook prose says "thousands", but its numeric cells contain unit counts.
    # Anchor every state to the independently checked final 2025 model inputs.
    for s in states:
        if records[s['state_abbr'],2025]['total']!=s['baseline_annual_units']:
            raise ValueError('2025 units disagree with independently audited Census count: '+s['state_abbr'])
    return sorted(records.values(),key=lambda r:(r['state_abbr'],r['year']))


def forecast(values,method,horizon=5):
    if len(values)<5 or any(not math.isfinite(x) or x<0 for x in values):raise ValueError('Invalid series')
    if method=='last_year':return [float(values[-1])]*horizon
    if method.startswith('mean_'):
        width=int(method.split('_')[1]);return [statistics.mean(values[-width:])]*horizon
    if method!='damped_trend_5':raise ValueError(method)
    y=values[-5:];center=statistics.mean(y)
    slope=sum((i-2)*(v-center) for i,v in enumerate(y))/10
    endpoint=center+2*slope
    return [max(0.,endpoint+slope*sum(PLAN['damping']**j for j in range(1,h+1))) for h in range(1,horizon+1)]


def predict(history,abbr,origin,method):
    rows=[r for r in history if r['state_abbr']==abbr and r['year']<=origin]
    if not rows or rows[-1]['year']!=origin:raise ValueError('Incomplete origin')
    sf=forecast([r['single_family'] for r in rows],method)
    mf=forecast([r['multifamily'] for r in rows],method)
    return [{'year':origin+i+1,'single_family':sf[i],'multifamily':mf[i],'total':sf[i]+mf[i]} for i in range(5)]


def fold(history,states,origin,method,stage):
    result=[]
    for s in states:
        abbr=s['state_abbr'];p=predict(history,abbr,origin,method)
        observed=[r for r in history if r['state_abbr']==abbr and origin<r['year']<=origin+5]
        if len(observed)!=5:raise ValueError('Missing test outcomes')
        predicted=sum(r['total'] for r in p);actual=sum(r['total'] for r in observed)
        scale=sum(r['total'] for r in history if r['state_abbr']==abbr and origin-5<r['year']<=origin)
        result.append({'stage':stage,'method':method,'state_abbr':abbr,'origin':origin,
             'target_start':origin+1,'target_end':origin+5,'predicted':predicted,'actual':actual,
             'error':predicted-actual,'absolute_error':abs(predicted-actual),
             'absolute_percentage_error':abs(predicted-actual)/actual*100,
             'trailing_five_year_scale':scale,'scaled_forecast_error':(actual-predicted)/max(scale,1)})
    return result


def score(rows):
    return {'cases':len(rows),'mean_state_APE':statistics.mean(r['absolute_percentage_error'] for r in rows),
            'median_state_APE':statistics.median(r['absolute_percentage_error'] for r in rows),
            'WAPE':100*sum(r['absolute_error'] for r in rows)/sum(r['actual'] for r in rows),
            'bias_pct':100*sum(r['error'] for r in rows)/sum(r['actual'] for r in rows)}


def quantile(values,p):
    v=sorted(values);at=(len(v)-1)*p;lo=math.floor(at);hi=math.ceil(at)
    return v[lo]+(v[hi]-v[lo])*(at-lo)


def range_for(point,errors,scale):
    return [round(max(0,min(point,point+scale*errors[0]))),round(max(point,point+scale*errors[1]))]

def validate_history(history, states):
    """Validate the supported 2000–2025 state series and independent 2025 anchors."""
    supported = {row['state_abbr'] for row in states}
    expected = {(state, year) for state in supported for year in range(2000, 2026)}
    actual = [(row['state_abbr'], row['year']) for row in history]
    if len(actual) != len(set(actual)) or set(actual) != expected:
        raise ValueError('History requires one row per supported state and year, 2000–2025')
    fields = ('total','single_family','two_units','three_four_units','five_plus_units','multifamily')
    for row in history:
        for field in fields:
            value = row.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"Invalid integer permit count: {row['state_abbr']} {row['year']} {field}")
        if row['two_units'] + row['three_four_units'] + row['five_plus_units'] != row['multifamily']:
            raise ValueError('Multifamily structure types do not reconcile')
        if row['single_family'] + row['multifamily'] != row['total']:
            raise ValueError('Single-family and multifamily totals do not reconcile')
    final = {row['state_abbr']: row['total'] for row in history if row['year'] == 2025}
    if any(final[row['state_abbr']] != row['baseline_annual_units'] for row in states):
        raise ValueError('Final history year does not match the supplied official permit anchor')
    return sorted(history, key=lambda row: (row['state_abbr'], row['year']))


def read_history(path, states):
    """Read the small canonical CSV; raw XLSX parsing is separately available."""
    numeric = ('year','survey_universe','total','single_family','two_units',
               'three_four_units','five_plus_units','multifamily')
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        records = []
        for row in csv.DictReader(stream):
            records.append({key: int(value) if key in numeric else value for key, value in row.items()})
    return validate_history(records, states)


def build_baseline(history, states, source=None):
    """Return predictions, honest evaluation metadata and exportable tables."""
    history = validate_history(history, states)
    manifest = source or {'description': 'Caller-supplied canonical Census BPS history',
                          'source_url': 'https://www.census.gov/construction/bps/xls/state_history.xlsx'}

    development=[]
    for method in METHODS:
        for origin in PLAN['development_origins']:development.extend(fold(history,states,origin,method,'development'))
    scores={m:score([r for r in development if r['method']==m]) for m in METHODS}
    selected=min(METHODS,key=lambda m:scores[m]['mean_state_APE'])
    calibration=[]
    for origin in PLAN['calibration_origins']:calibration.extend(fold(history,states,origin,selected,'calibration'))
    errors=[quantile([r['scaled_forecast_error'] for r in calibration],p) for p in (.1,.9)]
    final_test=fold(history,states,2020,selected,'final_test')
    final_flat=fold(history,states,2020,'last_year','final_test_flat_comparator')
    # Diagnostics after selection: do not use these outcomes to reselect a model.
    candidate_final_diagnostics={}
    for method in METHODS:
        rows=fold(history,states,2020,method,'final_candidate_diagnostic')
        national_actual=sum(r['actual'] for r in rows)
        candidate_final_diagnostics[method]={**score(rows),'nationalAPE':100*abs(sum(r['predicted'] for r in rows)-national_actual)/national_actual}
    for r in final_test:
        r['range_low'],r['range_high']=range_for(r['predicted'],errors,r['trailing_five_year_scale'])
        r['range_covers_actual']=r['range_low']<=r['actual']<=r['range_high']
    # No model is reselected after inspecting the final test.
    deployment_errors=[]
    for origin in range(2005,2021):deployment_errors.extend(fold(history,states,origin,selected,'deployment_error_history'))
    deployment_bounds=[quantile([r['scaled_forecast_error'] for r in deployment_errors],p) for p in (.1,.9)]
    production={};annual=[]
    for s in states:
        abbr=s['state_abbr'];forecast_rows=predict(history,abbr,2025,selected)
        for row in forecast_rows:
            row['single_family']=round(row['single_family']);row['multifamily']=round(row['multifamily'])
            row['total']=row['single_family']+row['multifamily'];annual.append({'state_abbr':abbr,**row})
        total=sum(r['total'] for r in forecast_rows)
        scale=sum(r['total'] for r in history if r['state_abbr']==abbr and r['year']>=2021)
        bounds=range_for(total,deployment_bounds,scale)
        production[abbr]={'fiveYear':total,'low':bounds[0],'high':bounds[1],
           'oldFiveYear':s['baseline_5yr_units'],'annual':forecast_rows,
           'history':[{'year':r['year'],'total':r['total'],'single_family':r['single_family'],'multifamily':r['multifamily']} for r in history if r['state_abbr']==abbr],
           'test':next(r for r in final_test if r['state_abbr']==abbr)}
    national={k:sum(r[k] for r in production.values()) for k in ('fiveYear','low','high','oldFiveYear')}
    national['annual']=[{'year':year,**{k:sum(r[k] for r in annual if r['year']==year) for k in ('single_family','multifamily','total')}} for year in range(2026,2031)]
    national['history']=[{'year':year,**{k:sum(r[k] for r in history if r['year']==year) for k in ('single_family','multifamily','total')}} for year in range(2000,2026)]
    ntest_pred=sum(r['predicted'] for r in final_test);ntest_actual=sum(r['actual'] for r in final_test)
    national['test']={'predicted':ntest_pred,'actual':ntest_actual,'absolute_percentage_error':abs(ntest_pred-ntest_actual)/ntest_actual*100}
    result={'method':selected,'methodLabel':LABELS[selected],'years':[2026,2030],
       'observedYears':[2000,2025],'national':national,'states':production,'rangeScaledErrors':deployment_bounds,
       'source':manifest,'plan':PLAN,
       'rangeLabel':'Refreshed historical-error sensitivity range; not a confidence interval or independently coverage-tested interval',
       'countyMethod':'State forecast allocated using the county share of 2025 state permits. This is not an independently backtested county forecast; unallocated state permit balances remain unallocated.'}
    report={'selected_method':selected,'selected_label':LABELS[selected],
       'history_rows':len(history),'structure_types_reconcile':True,'all_2025_state_inputs_match':True,
       'workbook_unit_note':'Workbook prose says thousands, but numeric cells are raw unit counts: all 51 states match independently audited final 2025 counts without scaling.',
       'development_scores':scores,'calibration_score':score(calibration),'range_scaled_errors':errors,
       'final_test':score(final_test),'final_test_flat':score(final_flat),
       'candidate_final_diagnostics':candidate_final_diagnostics,
       'final_test_range_coverage_pct':100*sum(r['range_covers_actual'] for r in final_test)/len(final_test),
       'deployment_range_scaled_errors':deployment_bounds,'deployment_error_cases':len(deployment_errors),
       'deployment_range_independent_coverage':'Not tested: this descriptive range is refreshed after final evaluation using all completed historical folds. Frozen final-test coverage above concerns the earlier calibration-only range.',
       'final_test_national':national['test'],'forecast_national':{k:national[k] for k in ('fiveYear','low','high','oldFiveYear')},
       'information_limits':PLAN['information_limits'],'source':manifest,
       'policy_response_validation':'Not established by baseline backtesting. Policy sensitivity parameters remain a separate evidence/assumption layer.'}
    tables = {
        'state_permit_history_2000_2025.csv': history,
        'development_predictions.csv': development,
        'calibration_predictions.csv': calibration,
        'final_test_predictions.csv': final_test,
        'final_test_flat_predictions.csv': final_flat,
        'forecast_2026_2030.csv': annual,
        'deployment_error_history.csv': deployment_errors,
        'state_forecast_summary.csv': [
            {'state_abbr': state, **{key: row[key] for key in ('fiveYear','low','high','oldFiveYear')}}
            for state, row in production.items()
        ],
    }
    return result, report, tables
