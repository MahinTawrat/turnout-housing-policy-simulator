"""Observed housing evidence and conditional population/household scenarios.

The model keeps ACS stocks and survey margins, HUD housing problems and
population continuations separate from permit production and construction need.
Only Python's standard library is required. No browser assets are input data.
"""
from __future__ import annotations

import copy
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone
import csv
import hashlib
import gzip
import io
import json
import math
from pathlib import Path
import statistics
import zipfile

TABLES = ['B01001','B01002','B11016','B19013','B25002','B25003','B25004','B25007','B25010','B25014','B25024','B25031','B25034','B25042','B25064','B25070','B25077','B25124']
SCENARIOS = {'central': [2023,2024,2025], 'longHistory': [2021,2022,2023,2024,2025], 'latestYear': [2025]}
COMPONENTS = ['BIRTHS','DEATHS','DOMESTICMIG','INTERNATIONALMIG']
RETAIN_CELLS={'B01001':list(range(1,50)),'B01002':[1],'B11016':[1,3,10,11],'B19013':[1],
    'B25002':[1,2,3],'B25003':[1,2,3],'B25004':list(range(1,9)),'B25007':list(range(1,22)),
    'B25010':[1],'B25014':[1,2,5,6,7,8,11,12,13],'B25024':list(range(1,12)),
    'B25031':list(range(2,8)),'B25034':[7,8,9,10,11],'B25042':list(range(1,16)),
    'B25064':[1],'B25070':list(range(1,12)),'B25077':[1],
    'B25124':[38,39,41,53,55,56,57,58,60,62,63,64,65,67,69,70,71,72]}

def compact_inputs(inputs):
    for table,rows in inputs['acs'].items():
        keep={f'{table}_{kind}{i:03}' for i in RETAIN_CELLS[table] for kind in ['E','M']}
        for key,row in rows.items(): rows[key]={k:v for k,v in row.items() if k in keep}
    for t,rows in inputs['chas'].items():
        cols=[75,76,77,84,91,113,120,127] if t=='1' else [77,84,91]
        keep={f'T{t}_{kind}{i}' for i in cols for kind in ('est','moe')}
        for key,row in rows.items(): rows[key]={k:v for k,v in row.items() if k in keep}
    inputs['metadata']={'populationVintage':'2025','populationYears':list(range(2020,2026)),
        'populationDate':'July 1','acsPeriod':'2020–2024 ACS 5-year','chasPeriod':'2018–2022',
        'normalization':'ACS/HUD suppressed or negative special values are null. Population migration and residual remain signed.',
        'retention':'Only required analytical cells retained; full source field inventories and SHA256 hashes are in sourceManifest.',
        'notAFullRawDataArchive':True}
    return inputs

def number(x):
    try:
        n=float(x)
        return n if math.isfinite(n) and n >= 0 else None
    except (TypeError,ValueError): return None

def signed(x):
    try:
        n=float(x)
        return n if math.isfinite(n) else None
    except (TypeError,ValueError): return None

def total(values):
    return sum(values) if all(v is not None for v in values) else None

def moe(values):
    """Approximate 90% MOE for a sum: RSS of published ACS cell MOEs.

    This approximation does not include covariance and is not a separately
    published ACS margin. Missing components remain missing, including zeros.
    """
    return math.sqrt(sum(v*v for v in values)) if all(v is not None for v in values) else None

def divide(a,b,scale=1):
    return a/b*scale if a is not None and b is not None and b>0 else None

def annual_component(row,years):
    """Annual count continuation; residual is excluded because it is not a mechanism."""
    values = [[signed(row.get(component + str(year))) for component in COMPONENTS]
              for year in years]
    if not values or any(value is None for values_in_year in values for value in values_in_year):
        raise ValueError('Population continuation requires finite components for every selected year.')
    return statistics.mean(births-deaths+domestic+international
                           for births,deaths,domestic,international in values)

def project_population(row):
    p=float(row['POPESTIMATE2025'])
    variants={name:max(0,p+5*annual_component(row,years)) for name,years in SCENARIOS.items()}
    return {'low':min(variants.values()),'central':variants['central'],'high':max(variants.values())},variants

def household_change(p25,p30,gq25,avg_size):
    """Conditional change with household size and GQ population share held constant."""
    values = [signed(value) for value in (p25,p30,gq25,avg_size)]
    if any(value is None for value in values):
        return None
    p25,p30,gq25,avg_size = values
    return (p30-p25)*(1-gq25/p25)/avg_size if p25>0 and avg_size>0 and 0<=gq25<=p25 else None

def construction_requirement(growth, suppressed=None, replacement=None, reserve_change=None,
                             usable_vacancies=None, expected_completions=None, net_conversions=None):
    """Accounting function; every missing term remains missing, including a missing zero.

    growth is signed net household change. Usable vacancies are verified *excess*
    stock released after retaining a normal turnover reserve. Supply streams must
    be mutually exclusive. No observed problem counts enter this identity.
    """
    terms=[growth,suppressed,replacement,reserve_change,usable_vacancies,expected_completions,net_conversions]
    if any(x is None for x in terms): return None
    if any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in terms):
        raise ValueError('all supplied accounting terms must be finite numbers')
    if any(x<0 for x in [suppressed,replacement,usable_vacancies,expected_completions]):
        raise ValueError('suppression, replacement and supply counts must be nonnegative')
    return max(0,growth+suppressed+replacement+reserve_change-usable_vacancies-expected_completions-net_conversions)

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def audit_sources(raw, filenames=None):
    """Inventory evidence source hashes, full field lists and archive members.

    A shared acquisition cache also holds permit history and spatial inputs.
    Those are audited by their respective models/the acquisition manifest;
    they must not be embedded as large text notes in the evidence manifest.
    """
    out=[]
    for p in sorted(raw.iterdir()):
        if not p.is_file(): continue
        if filenames is not None and p.name not in filenames: continue
        item={'file':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}
        if p.suffix.lower() in ['.csv','.dat']:
            with p.open(encoding='cp1252',newline='') as f:
                reader=csv.reader(f,delimiter='|' if p.suffix=='.dat' else ',')
                item['columns']=next(reader)
        elif p.suffix.lower()=='.zip':
            with zipfile.ZipFile(p) as z:
                members=[]
                for info in z.infolist():
                    if info.is_dir(): continue
                    first=z.read(info).decode('cp1252').splitlines()[0]
                    members.append({'file':info.filename,'bytes':info.file_size,'columns':next(csv.reader([first]))})
                item['members']=members
        elif p.suffix.lower()=='.txt': item['notes']=p.read_text(encoding='utf-8-sig',errors='replace')
        out.append(item)
    return out

def load_raw(raw, reference):
    expected=set(reference['county'])|set(reference['state'])|{'US'}
    acs={}
    for table in TABLES:
        path=raw/('acsdt5y2024-'+table.lower()+'.dat')
        records={}
        with path.open(encoding='utf-8-sig',newline='') as f:
            for row in csv.DictReader(f,delimiter='|'):
                geo=row.get('GEO_ID','')
                if not geo.startswith(('0100000US','0400000US','0500000US')): continue
                key=geo.split('US',1)[1] or 'US'
                if key not in expected: continue
                if key in records: raise ValueError('duplicate ACS geography '+table+' '+key)
                records[key]={k:number(v) for k,v in row.items() if k!='GEO_ID'}
        acs[table]=records
    population={}
    with (raw/'co-est2025-alldata.csv').open(encoding='cp1252',newline='') as f:
        for row in csv.DictReader(f):
            key=row['STATE'] if row['SUMLEV']=='040' else row['STATE']+row['COUNTY']
            if key not in expected: continue
            if key in population: raise ValueError('duplicate population key '+key)
            population[key]=row
    states=[r for k,r in population.items() if len(k)==2]
    numeric=[k for k in states[0] if k.startswith(('POPESTIMATE','GQESTIMATES','NPOPCHG','BIRTHS','DEATHS','NATURALCHG','DOMESTICMIG','INTERNATIONALMIG','NETMIG','RESIDUAL'))]
    population['US']={'STNAME':'United States','CTYNAME':'United States',**{k:str(sum(float(r[k]) for r in states)) for k in numeric}}
    chas={}
    with zipfile.ZipFile(raw/'2018thru2022-050-csv.zip') as z:
        for t in [1,2]:
            records={}
            for row in csv.DictReader(io.StringIO(z.read(f'050/Table{t}.csv').decode('cp1252'))):
                key=row['geoid'].split('US')[-1]
                if key in reference['county']:
                    if key in records: raise ValueError('duplicate CHAS geography '+str(t)+' '+key)
                    records[key]={k:number(v) for k,v in row.items() if k.startswith(f'T{t}_')}
            chas[str(t)]=records
    filenames = {f'acsdt5y2024-{table.lower()}.dat' for table in TABLES}
    filenames.update(('co-est2025-alldata.csv','2018thru2022-050-csv.zip'))
    return {'acs':acs,'population':population,'chas':chas,'sourceManifest':audit_sources(raw,filenames)}

def backtest(row):
    observed=float(row['POPESTIMATE2025'])
    p20,p21,p22=[float(row['POPESTIMATE'+str(y)]) for y in [2020,2021,2022]]
    forecasts={'naive':p22,'earlyTrend':max(0,p22+3*(p22-p20)/2),
               'earlyComponents':max(0,p22+3*annual_component(row,[2021,2022])),
               'lastYearTrend':max(0,p22+3*(p22-p21))}
    return {'observed':observed,'forecasts':forecasts,'ape':divide(abs(forecasts['earlyComponents']-observed),observed,100),
            'naiveAPE':divide(abs(p22-observed),observed,100),
            'trend2020to2022APE':divide(abs(forecasts['earlyTrend']-observed),observed,100),
            'method':'train July 2020–2022; evaluate July 2025 within Vintage 2025 (revised-vintage pseudo holdout)'}

def backtest_recent_window(row):
    """Same three-component-year estimator as the central scenario, shorter holdout."""
    observed=float(row['POPESTIMATE2025']); p20=float(row['POPESTIMATE2020']);p23=float(row['POPESTIMATE2023'])
    forecasts={'naive':p23,'earlyTrend':max(0,p23+2*(p23-p20)/3),
        'earlyComponents':max(0,p23+2*annual_component(row,[2021,2022,2023])),
        'lastYearTrend':max(0,p23+2*(p23-float(row['POPESTIMATE2022'])))}
    return {'observed':observed,'forecasts':forecasts,'method':'three-year component mean 2021–2023; hold out July 2023–2025 (two years); revised Vintage 2025'}

def population_input_issues(row):
    """Validate the complete history needed for scenarios and pseudo holdouts."""
    if not row:
        return ['missing geography']
    required = [f'POPESTIMATE{year}' for year in range(2020,2026)]
    required += [f'{component}{year}' for year in range(2021,2026)
                 for component in COMPONENTS + ['RESIDUAL']]
    required += ['GQESTIMATES2025','NATURALCHG2025']
    issues = [field for field in required if signed(row.get(field)) is None]
    if any(signed(row.get(f'POPESTIMATE{year}')) is not None
           and float(row[f'POPESTIMATE{year}']) <= 0 for year in range(2020,2026)):
        issues.append('population must be positive')
    p25,gq = signed(row.get('POPESTIMATE2025')),signed(row.get('GQESTIMATES2025'))
    if p25 is not None and gq is not None and not 0 <= gq <= p25:
        issues.append('group quarters outside population bounds')
    return issues


def make_record(key,inputs):
    acs=inputs['acs']; source_pop=inputs['population'].get(key)
    pop = source_pop if not population_input_issues(source_pop) else None
    flags=['Conditional continuation scenarios; not a validated local forecast.',
           'Construction requirement unavailable: completions, losses, suppression and usable excess vacancies unverified.',
           'ACS 2020–2024, Census July 2025 and HUD 2018–2022 measure different periods.']
    def v(table,i,kind='E'):
        return acs.get(table,{}).get(key,{}).get(f'{table}_{kind}{i:03}')
    def s(table,indices,kind='E'): return total([v(table,i,kind) for i in indices])
    def m(table,indices): return moe([v(table,i,'M') for i in indices])
    hh=v('B25003',1); avg=v('B25010',1)
    h1=v('B11016',10); h2=s('B11016',[3,11]); h3=hh-h1-h2 if all(x is not None for x in [hh,h1,h2]) else None
    renter=v('B25003',3); owner=v('B25003',2)
    crowded_r=s('B25014',[11,12,13]); crowded_o=s('B25014',[5,6,7])
    crowd_m=m('B25014',[11,12,13]); o_m=m('B25014',[5,6,7])
    for_rent=v('B25004',2); for_sale=v('B25004',4)
    burden=s('B25070',[7,8,9,10]); burden_denom=s('B25070',list(range(2,11)))
    under18=s('B01001',[3,4,5,6,27,28,29,30]); age65=s('B01001',list(range(20,26))+list(range(44,50)))
    stock={'total':v('B25024',1),'detached':v('B25024',2),'attached':v('B25024',3),
           'twoFour':s('B25024',[4,5]),'fivePlus':s('B25024',[6,7,8,9]),'pre1980':s('B25034',[7,8,9,10,11]),
           'duplex':v('B25024',4),'threeFour':v('B25024',5),'fiveNine':v('B25024',6),'tenNineteen':v('B25024',7),
           'twentyFortynine':v('B25024',8),'fiftyPlus':v('B25024',9),'mobile':v('B25024',10)}
    if hh is not None and hh<1000: flags.append('Small area: fewer than 1,000 ACS households.')
    if crowd_m is not None and crowded_r is not None and crowd_m>=crowded_r: flags.append('Renter crowding estimate has a 90% MOE at least as large as its estimate.')
    if renter and v('B25003',3,'M') is not None and v('B25003',3,'M')/renter>.3: flags.append('Renter-household estimate has a relative MOE above 30%.')
    if not pop:
        population=None; demand={'hhACS':hh,'hh2025Proxy':None,'hhChange':{'low':None,'central':None,'high':None},'constructionRequired':None,'constructionStatus':'UNAVAILABLE'}; bt=None
        flags.append('Population source has no matching geography; no projected values produced.' if not source_pop
                     else 'Population inputs incomplete or invalid; no projected values produced.')
    else:
        p25=float(pop['POPESTIMATE2025']); gq=float(pop['GQESTIMATES2025']); p30,variants=project_population(pop)
        population={'p2020':float(pop['POPESTIMATE2020']),'p2025':p25,'p2030':p30,'scenarioValues':variants,
            'births2025':float(pop['BIRTHS2025']),'deaths2025':float(pop['DEATHS2025']),
            'domesticMigration2025':float(pop['DOMESTICMIG2025']),'internationalMigration2025':float(pop['INTERNATIONALMIG2025']),
            'naturalChange2025':float(pop['NATURALCHG2025']),'residual2025':float(pop['RESIDUAL2025']),
            'groupQuarters2025':gq,'history':{str(y):float(pop['POPESTIMATE'+str(y)]) for y in range(2020,2026)}}
        deltas={k:household_change(p25,p,gq,avg) for k,p in p30.items()}
        demand={'hhACS':hh,'hh2025Proxy':divide(p25-gq,avg),'hhChange':deltas,
            'constructionRequired':None,'constructionStatus':'UNAVAILABLE','expectedCompletions':None,'replacement':None,'suppressedFormation':None,'usableVacancies':None,'netConversions':None,'reserveChange':None,'householdSize':avg,'householdSizeMOE':v('B25010',1,'M'),
            'householdAssumption':'2025 household baseline is a proxy: (population minus group quarters)/ACS average household size. 2030 keeps this size and 2025 group-quarter share constant.',
            'missingTerms':['suppressed household formation','replacement and losses','change in turnover reserve','verified usable excess vacancies','expected completions','net conversions'],
            'formationSensitivity':{'sizeMinusMOE':household_change(p25,p30['central'],gq,avg-v('B25010',1,'M')) if avg and v('B25010',1,'M') is not None and avg>v('B25010',1,'M') else None,
                                  'sizePlusMOE':household_change(p25,p30['central'],gq,avg+v('B25010',1,'M')) if avg and v('B25010',1,'M') is not None else None}}
        bt=backtest(pop)
        bt['matchingThreeYearWindow']=backtest_recent_window(pop)
        if p30['central']<p25: flags.append('Central continuation declines; affordability, quality and replacement needs can persist.')
        if p30['low']<p25<p30['high']: flags.append('Direction of population change differs across continuation scenarios.')
        if abs(p30['central']/p25-1)>.25: flags.append('Extreme continuation: population changes by more than 25% in five years; do not use without local review.')
        if bt['ape'] is not None and bt['ape']>5: flags.append('Earlier component continuation missed 2025 population by more than 5% in revised-vintage pseudo holdout.')
        if any(p==0 for p in variants.values()): flags.append('A continuation reached the zero-population boundary; model is unsuitable here.')
        if gq/p25>.15: flags.append('Group-quarter population exceeds 15%; aggregate household formation proxy is especially uncertain.')
    evidence={'householdSize':[h1,h2,h3], 'householdSizeMOE':[v('B11016',10,'M'),m('B11016',[3,11]),None],
        'bedrooms':{'owner':[v('B25042',i) for i in range(3,9)],'renter':[v('B25042',i) for i in range(10,16)]},
        'bedroomMOE':{'owner':[v('B25042',i,'M') for i in range(3,9)],'renter':[v('B25042',i,'M') for i in range(10,16)]},
        'rents':[v('B25031',i) for i in range(2,8)],'rentMOE':[v('B25031',i,'M') for i in range(2,8)],
        'vacancy':{'all':v('B25002',3),'forRent':for_rent,'forSale':for_sale,'seasonal':v('B25004',6),'other':v('B25004',8),
            'migrantWorkers':v('B25004',7),'rentedSoldNotOccupied':s('B25004',[3,5]),'market':total([for_rent,for_sale]),
            'forRentMOE':v('B25004',2,'M'),'forSaleMOE':v('B25004',4,'M'),
            'rentalRate':divide(for_rent,total([renter,for_rent,v('B25004',3)]),100),'saleRate':divide(for_sale,total([owner,for_sale,v('B25004',5)]),100),
            'usableExcess':None},
        'crowding':{'renter':crowded_r,'owner':crowded_o,'renterMOE':crowd_m,'ownerMOE':o_m,'renterRate':divide(crowded_r,renter,100)},
        'stock':stock,'burden':{'denominator':burden_denom,'above30':burden,'severe':v('B25070',10),'above30MOE':m('B25070',[7,8,9,10]),'rate':divide(burden,burden_denom,100)},
        'householdStructure':{'oneRenter':v('B25124',39),'oneRenterTwoFour':v('B25124',41),
            'largeRenter':s('B25124',[53,60,67]),'largeRenterTwoFour':s('B25124',[55,62,69]),
            'largeRenterFivePlus':s('B25124',[56,57,58,63,64,65,70,71,72]),
            'largeRenterTwoFourMOE':m('B25124',[55,62,69]),
            'note':'3+ person renter households by occupied structure; observed counts, not the future building-type mix.'},
        'age':{'under18':under18,'age65plus':age65,'median':v('B01002',1)},
        'income':v('B19013',1),'owner':owner,'renter':renter,
        'headshipAge':{'labels':['15–24','25–34','35–44','45–54','55–59','60–64','65–74','75–84','85+'],
            'households':[s('B25007',[i,i+10]) for i in range(3,12)],
            'population':[s('B01001',ids) for ids in [[6,7,8,9,10,30,31,32,33,34],[11,12,35,36],[13,14,37,38],[15,16,39,40],[17,41],[18,19,42,43],[20,21,22,44,45,46],[23,24,47,48],[25,49]]],
            'note':'Observed age-specific householder/population ratios include group quarters in population denominators; no age-specific future headship or age-composition forecast.'}}
    evidence['headshipAge']['householderPopulationRatio']=[divide(h,p) for h,p in zip(evidence['headshipAge']['households'],evidence['headshipAge']['population'])]
    return {'fips':key,'name':source_pop.get('CTYNAME') if source_pop else key,'population':population,'demand':demand,'evidence':evidence,'backtest':bt,'flags':flags}

def add_chas(record,key,inputs,county_ids):
    ids=[key] if len(key)==5 else [f for f in county_ids if key=='US' or f[:2]==key]
    a=inputs.get('chas',{}).get('1',{}); b=inputs.get('chas',{}).get('2',{})
    if not ids or not all(f in a and f in b for f in ids):
        record['flags'].append('HUD CHAS inputs incomplete; housing-problem counts unavailable.')
        return
    def sm(table,prefix,cols): return total([table[f].get(f'{prefix}_est{i}') for f in ids for i in cols])
    problem=sm(a,'T1',[77,84,91]); no_problem=sm(a,'T1',[113,120,127]); severe=sm(b,'T2',[77,84,91])
    if any(value is None for value in (problem,no_problem,severe,sm(a,'T1',[76]),sm(a,'T1',[75]))):
        record['flags'].append('HUD CHAS inputs incomplete; housing-problem counts unavailable.')
        return
    record['evidence']['chas']={'lowProblem':problem,'lowTotal':problem+no_problem,'lowSevere':severe,
        'allProblem':sm(a,'T1',[76]),'renterTotal':sm(a,'T1',[75]),'rate':divide(problem,problem+no_problem,100),
        'aggregation':'published rounded county estimates' if len(key)==5 else 'approximate sum of rounded county estimates, not official HUD state/national totals',
        'period':'2018–2022','definition':'Renter households at or below 80% HAMFI with one or more of four housing problems; not homes required.'}

def tidy(value):
    if isinstance(value,float): return round(value,6) if math.isfinite(value) else None
    if isinstance(value,dict): return {k:tidy(v) for k,v in value.items()}
    if isinstance(value,list): return [tidy(v) for v in value]
    return value

def csv_write(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    keys=list(dict.fromkeys(k for r in rows for k in r))
    with path.open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=keys); writer.writeheader(); writer.writerows(rows)


MODEL_META = {'version': '9.0',
 'buildDate': '2026-11-08',
 'observedPeriod': 'ACS 2020–2024; Census July 2025; HUD CHAS 2018–2022',
 'scenarioLabels': {'central': 'repeat annual mean 2023–2025 components',
                    'longHistory': 'repeat annual mean 2021–2025 components',
                    'latestYear': 'repeat 2025 components'},
 'method': '2030 = 2025 + five times (mean births − deaths + domestic + international migration); '
           'no residual continuation.',
 'range': 'Envelope of three historical continuation assumptions, not a statistical confidence '
          'interval; local bounds need not sum to state bounds.',
 'householdAssumption': 'ACS average household size and 2025 group-quarter share held constant; no '
                        'age-specific formation or suppressed demand forecast.',
 'backtest': 'Revised-vintage pseudo holdout; all historical observations from Vintage 2025. No '
             'ex-ante vintage backtest or household backtest is available.',
 'construction': 'Unavailable without verified losses, suppression, usable excess vacancies, '
                 'reserve changes, conversions and expected completions.',
 'bedroomMix': 'No numeric future mix: marginal household size and bedroom distributions do not '
               'identify matching preferences, incomes or joint need.'}


def _error_summary(records, recent=False):
    valid = [record for record in records.values() if record['backtest']]
    result = {}
    for method in ('naive','earlyTrend','earlyComponents','lastYearTrend'):
        observations = [record['backtest']['observed'] for record in valid]
        predictions = [(record['backtest']['matchingThreeYearWindow'] if recent
                        else record['backtest'])['forecasts'][method] for record in valid]
        errors = [abs(prediction-observed) for prediction,observed in zip(predictions,observations)]
        apes = [error/observed*100 for error,observed in zip(errors,observations)]
        result[method] = {
            'n':len(valid), 'MAE_persons':statistics.mean(errors) if errors else None,
            'median_APE_pct':statistics.median(apes) if apes else None,
            'mean_APE_pct':statistics.mean(apes) if apes else None,
            'WAPE_pct':divide(sum(errors),sum(observations),100),
            'p90_APE_pct':sorted(apes)[min(len(apes)-1,int(len(apes)*.9))] if apes else None,
        }
    return result


def _sum_or_missing(records, getter):
    values = [getter(record) for record in records]
    return total(values) if values else None


def build_evidence(inputs, reference, benchmarks=()):
    """Calculate evidence from normalized inputs, without reading browser assets.

    Returns (model, validation_report, csv_tables). Inputs are not mutated.
    Reference contains explicit ``state`` and ``county`` FIPS-keyed mappings.
    Missing observations never become an assumed zero or construction need.
    """
    inputs = compact_inputs(copy.deepcopy(inputs))
    output = {'meta':copy.deepcopy(MODEL_META),'state':{},'county':{}}
    for scope in ('state','county'):
        for key in reference[scope]:
            record = make_record(key,inputs)
            add_chas(record,key,inputs,reference['county'])
            output[scope][key] = record
    output['national'] = make_record('US',inputs)
    add_chas(output['national'],'US',inputs,reference['county'])
    tables,benchmark_rows,benchmark_issues = {},[],[]
    for benchmark in benchmarks:
        key = benchmark['fips']
        record = output['state' if len(key)==2 else 'county'].get(key)
        if not record or not record['population']:
            continue
        published25,published30 = number(benchmark.get('p2025')),number(benchmark.get('p2030'))
        if not published25 or published30 is None or published30 <= 0:
            benchmark_issues.append({'fips':key,'issue':'missing or nonpositive benchmark population'})
            continue
        population = record['population']
        rebased = population['p2025']*published30/published25
        comparison = {
            'source':benchmark['source'],'vintage':benchmark['vintage'],'url':benchmark['url'],
            'published2025':float(published25),'published2030':float(published30),
            'rebased2030':rebased,'differencePct':(population['p2030']['central']-rebased)/rebased*100,
            'status':'Independent projection comparison, not observed forecast accuracy; 2025 baselines and methods differ.',
        }
        record['benchmark'] = comparison
        benchmark_rows.append({'fips':key,'model2030central':population['p2030']['central'],**comparison})
    tables['analytical_benchmark_comparison.csv'] = tidy(benchmark_rows)
    summaries,recent_summaries,back_rows = {},{},[]
    scopes = [('state',output['state']),('county',output['county']),('national',{'US':output['national']})]
    for scope,records in scopes:
        summaries[scope] = _error_summary(records)
        recent_summaries[scope] = _error_summary(records,recent=True)
        for recent in (False,True):
            for key,record in records.items():
                if not record['backtest']:
                    continue
                bt = record['backtest']['matchingThreeYearWindow'] if recent else record['backtest']
                back_rows.append({
                    'scope':scope,'fips':key,
                    'horizon':'2 years / three-year estimator' if recent else '3 years / two-year estimator',
                    'observed2025':bt['observed'],
                    **{'forecast_'+name:value for name,value in bt['forecasts'].items()},
                })
    expected = set(reference['county'])|set(reference['state'])|{'US'}
    joins = {table:{'expected':len(expected),'matched':len(rows),'missing':sorted(expected-set(rows))}
             for table,rows in inputs['acs'].items()}
    residual_errors,population_issues = [],[]
    for key,row in inputs['population'].items():
        issues = population_input_issues(row)
        if issues:
            population_issues.append({'fips':key,'fields':issues})
            continue
        for year in range(2021,2026):
            error = float(row[f'POPESTIMATE{year}'])-float(row[f'POPESTIMATE{year-1}'])-annual_component(row,[year])-float(row[f'RESIDUAL{year}'])
            if abs(error)>.001:
                residual_errors.append({'fips':key,'year':year,'error':error})
    reconciliations,household_reconciliations = [],[]
    for key,record in output['state'].items():
        counties = [county for fips,county in output['county'].items() if fips[:2]==key]
        for field in ('p2020','p2025','p2030central'):
            def value(item):
                pop = item['population']
                return (pop['p2030']['central'] if field=='p2030central' else pop[field]) if pop else None
            county_sum,state_value = _sum_or_missing(counties,value),value(record)
            difference = county_sum-state_value if county_sum is not None and state_value is not None else None
            reconciliations.append({'fips':key,'measure':field,'county_sum_minus_state':difference})
        county_sum = _sum_or_missing(counties,lambda item:item['demand']['hhChange']['central'])
        state_value = record['demand']['hhChange']['central']
        household_reconciliations.append({
            'fips':key,'countySumCentral':county_sum,'stateCentral':state_value,
            'countySumMinusState':county_sum-state_value if county_sum is not None and state_value is not None else None,
        })
    from collections import Counter
    report = {
        'backtest':summaries,'backtestMatchingThreeYearWindow':recent_summaries,
        'independentBenchmarks':{
            'n':len(benchmark_rows),'states':sum(len(row['fips'])==2 for row in benchmark_rows),
            'interpretation':'Agreement or disagreement with independent projections; not error against future observations.',
            'invalidInputs':benchmark_issues,
        },
        'joinAudit':joins,'populationAccountingFailures':residual_errors,
        'populationInputIssues':population_issues,'populationReconciliation':reconciliations,
        'householdReconciliation':household_reconciliations,
        'householdAggregation':{
            'nationalCentral':output['national']['demand']['hhChange']['central'],
            'stateSumCentral':_sum_or_missing(list(output['state'].values()),lambda item:item['demand']['hhChange']['central']),
            'countySumCentral':_sum_or_missing(list(output['county'].values()),lambda item:item['demand']['hhChange']['central']),
            'interpretation':'Local household-size and group-quarter composition produce nonadditive conditional household proxies. Do not force reconciliation or treat them as independently verified counts.',
        },
        'missingness':{scope:{
            'population':sum(record['population'] is None for record in records.values()),
            'rentsMissingCells':sum(sum(value is None for value in record['evidence']['rents']) for record in records.values()),
            'constructionRequirementUnavailable':len(records),
            'chasUnavailable':sum('chas' not in record['evidence'] for record in records.values()),
        } for scope,records in scopes if scope!='national'},
        'flags':dict(sorted(Counter(flag for record in output['county'].values() for flag in record['flags']).items())),
        'sourceFiles':len(inputs.get('sourceManifest',[])),
        'surveyUncertainty':'ACS component-sum MOEs use root-sum-of-squares without covariance: an approximation, not a separately published margin. Derived rates do not have propagated MOEs.',
        'browserAdapterNotes':[
            'Refresh adapters derive observations from this rebuilt model and retained ACS cells.',
            'Descriptive percentiles use midranks among available comparable geographies; they are not policy rankings.',
            'Structure smallSample means fewer than 1000 ACS households; highMoe means a relevant 90% MOE is at least its estimate.',
            'CHAS small means fewer than 100 lower-income renter households; highMoe uses original T1_moe76 / T1_est76 > 30%. Missing original CHAS MOEs leave that flag and comparison percentile null.',
            'Frozen deployment may retain approved legacy context adapters for visual parity; the decision model is always rebuilt.',
        ],
        'limitations':['No ex-ante population vintage validation.','No household formation backtest.',
                       'No calibrated prediction intervals.','No construction requirement is estimated.',
                       'No verified local development feasibility.'],
    }
    for scope,records in scopes:
        if scope=='national':
            continue
        rows = []
        for fips,record in records.items():
            pop,demand,evidence = record['population'],record['demand'],record['evidence']
            rows.append(tidy({
                'fips':fips,'name':record['name'],'population2025':pop['p2025'] if pop else None,
                **{'population2030_'+key:value for key,value in (pop['p2030'].items() if pop else [])},
                'householdsACS':demand['hhACS'],'households2025Proxy':demand['hh2025Proxy'],
                **{'householdChange_'+key:value for key,value in demand['hhChange'].items()},
                'avgHH':demand.get('householdSize'),'avgHH_MOE':demand.get('householdSizeMOE'),
                'constructionRequired':None,'constructionStatus':'UNAVAILABLE',
                **{'vacancy_'+key:value for key,value in evidence['vacancy'].items()},
                'crowdedRenter':evidence['crowding']['renter'],'crowdedRenter_MOE':evidence['crowding']['renterMOE'],
                'burdenedRenter':evidence['burden']['above30'],'burdenedRenter_MOE':evidence['burden']['above30MOE'],
                'flags':' | '.join(record['flags']),
            }))
        tables[f'analytical_{scope}.csv'] = rows
    tables['backtest_predictions.csv'] = back_rows
    return tidy(output),tidy(report),tables


def flatten(value, prefix='', result=None):
    result = {} if result is None else result
    if isinstance(value,dict):
        for key,item in value.items():
            flatten(item,f'{prefix}.{key}' if prefix else str(key),result)
    elif isinstance(value,list):
        for index,item in enumerate(value):
            flatten(item,f'{prefix}.{index}',result)
    else:
        result[prefix] = value
    return result


def download_tables(model):
    """Build public CSVs from this model, never from a previously built site."""
    records = [('national','US',model['national'])]
    records += [('state',key,record) for key,record in model['state'].items()]
    records += [('county',key,record) for key,record in model['county'].items()]
    groups = {name:[] for name in (
        'acs_housing_evidence.csv','population_household_scenarios.csv',
        'chas_housing_problems.csv','independent_population_benchmarks.csv')}
    for scope,key,record in records:
        identity = {'geography':scope,'geoid':key,'name':record['name']}
        evidence = {name:value for name,value in record.get('evidence',{}).items() if name!='chas'}
        groups['acs_housing_evidence.csv'].append({**identity,'period':'ACS 2020–2024',**flatten(evidence)})
        groups['population_household_scenarios.csv'].append({
            **identity,'observed_cutoff':2025,'scenario_year':2030,
            **flatten({'population':record.get('population',{}),'demand':record.get('demand',{})})})
        if record.get('evidence',{}).get('chas'):
            groups['chas_housing_problems.csv'].append({**identity,**flatten(record['evidence']['chas'])})
        if record.get('benchmark'):
            groups['independent_population_benchmarks.csv'].append({**identity,**flatten(record['benchmark'])})
    return groups


def _read_json(value):
    if isinstance(value,dict):
        return copy.deepcopy(value)
    path = Path(value)
    if path.suffix=='.gz':
        with gzip.open(path,'rt',encoding='utf-8-sig') as stream:
            return json.load(stream)
    return json.loads(path.read_text(encoding='utf-8-sig'))


def raw_provenance(raw_dir, source_manifest):
    """Version actual evidence bytes and the shared cache's recorded UTC date.

    Only the fixed manifest filename is opened. Paths/URLs from its contents
    never select local files; version inputs are audited basenames and hashes.
    No private absolute cache paths are included in the public model metadata.
    """
    manifest_path = Path(raw_dir)/'acquisition_manifest.json'
    try:
        acquisition = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
        timestamp = datetime.fromisoformat(acquisition['updated_utc'].replace('Z','+00:00'))
    except (OSError,KeyError,TypeError,ValueError) as error:
        raise ValueError('Raw rebuild requires acquisition_manifest.json with a valid updated_utc timestamp.') from error
    if timestamp.tzinfo is None:
        raise ValueError('Acquisition updated_utc must include an explicit time zone.')
    source_hashes = []
    for item in source_manifest:
        filename,checksum = item['file'],item['sha256']
        if not filename or Path(filename).name!=filename or '/' in filename or '\\' in filename:
            raise ValueError('Evidence source manifest must contain basenames only.')
        if len(checksum)!=64 or any(character not in '0123456789abcdef' for character in checksum):
            raise ValueError('Evidence source manifest contains an invalid SHA256.')
        source_hashes.append((filename,checksum))
    if not source_hashes:
        raise ValueError('Raw evidence source inventory is empty.')
    source_hashes.sort()
    fingerprint = hashlib.sha256(json.dumps(source_hashes,separators=(',',':')).encode('utf-8')).hexdigest()
    return {
        'buildDate':timestamp.astimezone(timezone.utc).date().isoformat(),
        'evidenceVersion':'turnout.evidence.refresh.'+fingerprint[:12],
        'acquisitionManifest':'acquisition_manifest.json',
        'acquisitionUpdatedUTC':timestamp.astimezone(timezone.utc).isoformat(),
        'sourceFiles':len(source_hashes),'sourceFingerprintSHA256':fingerprint,
    }


def _validated_source_revision(revision):
    """Carry only known non-path provenance fields into a normalized rebuild."""
    if not isinstance(revision,dict):
        raise ValueError('Evidence source revision must be a mapping.')
    try:
        timestamp = datetime.fromisoformat(revision['acquisitionUpdatedUTC'].replace('Z','+00:00'))
        fingerprint = revision['sourceFingerprintSHA256']
        version = revision['evidenceVersion']
        count = revision['sourceFiles']
        build_date = revision['buildDate']
    except (KeyError,TypeError,ValueError,AttributeError) as error:
        raise ValueError('Invalid normalized evidence source revision.') from error
    if (timestamp.tzinfo is None or not isinstance(fingerprint,str) or len(fingerprint)!=64
            or any(character not in '0123456789abcdef' for character in fingerprint)
            or version!='turnout.evidence.refresh.'+fingerprint[:12]
            or not isinstance(count,int) or isinstance(count,bool) or count<=0
            or build_date!=timestamp.astimezone(timezone.utc).date().isoformat()
            or revision.get('acquisitionManifest')!='acquisition_manifest.json'):
        raise ValueError('Invalid normalized evidence source revision.')
    return {
        'buildDate':build_date,'evidenceVersion':version,
        'acquisitionManifest':'acquisition_manifest.json',
        'acquisitionUpdatedUTC':timestamp.astimezone(timezone.utc).isoformat(),
        'sourceFiles':count,'sourceFingerprintSHA256':fingerprint,
    }


def _rounded(value, decimals=2):
    return round(value,decimals) if value is not None else None


def _percentile(value, population, decimals=0, presorted=False):
    """Midrank descriptive percentile, with unavailable values excluded."""
    valid = population if presorted else sorted(item for item in population if item is not None)
    if value is None or not valid:
        return None
    return round(50*(bisect_left(valid,value)+bisect_right(valid,value))/len(valid),decimals)


def browser_adapters(model, inputs):
    """Regenerate compatible observed-context globals for a refreshed build.

    Legacy globals are display adapters, not independent data sources. The
    decision model remains authoritative and none of these percentiles weights
    a policy estimate. Unavailable original CHAS margins are never invented.
    """
    needs,types = ({'state':{},'county':{}} for _ in range(2))
    structures,chas = ({'county':{},'state':{}} for _ in range(2))
    metrics = {'state':{},'county':{}}
    age_cells = ([3,4,5,6,27,28,29,30],[7,8,9,10,31,32,33,34],
                 [11,12,35,36],[13,14,37,38],[15,16,39,40],
                 [17,18,19,41,42,43],[20,21,22,44,45,46],[23,24,47,48],[25,49])
    records = [('national','US',model['national'])]
    records += [(scope,key,record) for scope in ('state','county') for key,record in model[scope].items()]
    for scope,key,record in records:
        def value(table,index,kind='E'):
            return inputs['acs'].get(table,{}).get(key,{}).get(f'{table}_{kind}{index:03}')
        def summed(table,indices,kind='E'):
            return total([value(table,index,kind) for index in indices])
        pop,demand,evidence = record['population'],record['demand'],record['evidence']
        stock,households,crowding = evidence['stock'],evidence['householdStructure'],evidence['crowding']
        ages = [summed('B01001',indices) for indices in age_cells]
        needs_record = {
            'p20':pop['p2020'] if pop else None,'p25':pop['p2025'] if pop else None,
            'grow':_rounded(divide(pop['p2025']-pop['p2020'],pop['p2020'],100)) if pop else None,
            'pa':value('B01001',1),'medianAge':evidence['age']['median'],
            'hh':demand['hhACS'],'h1':evidence['householdSize'][0],
            'h2':evidence['householdSize'][1],'h3':evidence['householdSize'][2],
            'avgHH':value('B25010',1),'hu':stock['total'],'vacant':evidence['vacancy']['all'],
            'forRent':evidence['vacancy']['forRent'],'forSale':evidence['vacancy']['forSale'],
            'renter':evidence['renter'],'owner':evidence['owner'],
            'burdenDenom':evidence['burden']['denominator'],'burden':evidence['burden']['above30'],
            'severe':evidence['burden']['severe'],'income':evidence['income'],
            'rent':value('B25064',1),'value':value('B25077',1),'ages':ages,
        }
        type_record = {
            'owner':evidence['owner'],'renter':evidence['renter'],
            'ownerBeds':evidence['bedrooms']['owner'],'renterBeds':evidence['bedrooms']['renter'],
            'overcrowdedR':crowding['renter'],'overcrowdedO':crowding['owner'],
            'crowdedRRate':_rounded(crowding['renterRate']),
            'crowdedORate':_rounded(divide(crowding['owner'],evidence['owner'],100)),
            'rents':evidence['rents'],
        }
        relevant_margins = (
            (stock['detached'],value('B25024',2,'M')),
            (stock['twoFour'],moe([value('B25024',index,'M') for index in (4,5)])),
            (stock['fivePlus'],moe([value('B25024',index,'M') for index in (6,7,8,9)])),
            (households['oneRenterTwoFour'],value('B25124',41,'M')),
            (households['largeRenterTwoFour'],households['largeRenterTwoFourMOE']),
        )
        usable_margins = [(estimate,margin) for estimate,margin in relevant_margins
                          if estimate is not None and margin is not None]
        structure_record = {
            **{name+'Pct':_rounded(divide(stock[name],stock['total'],100))
               for name in ('detached','attached','twoFour','fivePlus')},
            **{name:stock[name] for name in ('detached','attached','twoFour','fivePlus')},
            'allUnits':stock['total'],'oneRenter':households['oneRenter'],
            'oneRenter2to4':households['oneRenterTwoFour'],
            'oneRenter2to4Pct':_rounded(divide(households['oneRenterTwoFour'],households['oneRenter'],100)),
            'largeRenter':households['largeRenter'],'largeRenter2to4':households['largeRenterTwoFour'],
            'largeRenter2to4Pct':_rounded(divide(households['largeRenterTwoFour'],households['largeRenter'],100)),
            'largeRenter5plus':households['largeRenterFivePlus'],
            'largeRenter5plusPct':_rounded(divide(households['largeRenterFivePlus'],households['largeRenter'],100)),
            'smallSample':demand['hhACS']<1000 if demand['hhACS'] is not None else None,
            'highMoe':any(margin>=estimate for estimate,margin in usable_margins) if usable_margins else None,
        }
        if scope=='national':
            needs['national'],types['national'],structures['US'] = needs_record,type_record,structure_record
        else:
            needs[scope][key],types[scope][key],structures[scope][key] = needs_record,type_record,structure_record
            metrics[scope][key] = {
                'growth':needs_record['grow'],'burden':evidence['burden']['rate'],
                'crowding':crowding['renterRate'],
                'oneperson':divide(needs_record['h1'],needs_record['hh'],100),
                'seniors':divide(total(ages[6:]),needs_record['pa'],100),
                'family':divide(needs_record['h3'],needs_record['hh'],100),
                'rentSmall':divide(total(type_record['renterBeds'][:2]),evidence['renter'],100),
            }
        if evidence.get('chas'):
            observation = evidence['chas']
            chas_record = {name:observation[name] for name in ('lowProblem','lowTotal','lowSevere','rate','allProblem','renterTotal')}
            chas_record['rate'] = _rounded(chas_record['rate'])
            if scope=='county':
                original = inputs.get('chas',{}).get('1',{}).get(key,{})
                original_moe,original_estimate = original.get('T1_moe76'),original.get('T1_est76')
                chas_record.update({
                    'highMoe':original_moe/original_estimate>.3 if original_moe is not None and original_estimate else None,
                    'small':observation['lowTotal']<100,
                    'pre1980Pct':_rounded(divide(stock['pre1980'],stock['total'],100)),
                    'percentile':None,
                })
                chas['county'][key] = chas_record
            else:
                chas_record['approx'] = True
                if scope=='national':
                    chas['US'] = chas_record
                else:
                    chas['state'][key] = chas_record
    for scope,scope_metrics in metrics.items():
        distributions = {name:sorted(values[name] for values in scope_metrics.values() if values[name] is not None)
                         for name in ('growth','burden','crowding','oneperson','seniors','family','rentSmall')}
        for key,values in scope_metrics.items():
            types[scope][key]['pctile'] = {
                name:_percentile(value,distributions[name],presorted=True)
                for name,value in values.items()}
    eligible = sorted(record['rate'] for record in chas['county'].values()
                      if record['small'] is False and record['highMoe'] is False and record['rate'] is not None)
    for record in chas['county'].values():
        if record['small'] is False and record['highMoe'] is False:
            record['percentile'] = _percentile(record['rate'],eligible,1,presorted=True)
    return {
        'housing-needs.js':('HOUSING_NEEDS',needs),
        'housing-types.js':('HOUSING_TYPES',types),
        'structure-evidence.js':('QUIESCE_STRUCTURE_EVIDENCE',structures),
        'chas-affordability.js':('QUIESCE_CHAS_AFFORDABILITY',chas),
    }


def rebuild_evidence(inputs_path, reference_path, output_dir, *, benchmarks_path=None,
                     browser_assets_dir=None, downloads_dir=None, raw_dir=None):
    """Rebuild normalized JSON, audit, CSV downloads and optional browser adapters.

    ``inputs_path`` and ``reference_path`` may be paths or loaded mappings.
    With ``raw_dir``, ACS/PEP/HUD files in a flat acquisition cache replace the
    normalized snapshot. Only source inputs are read; no old tool is required.
    """
    reference = _read_json(reference_path)
    inputs = compact_inputs(load_raw(Path(raw_dir),reference)) if raw_dir else compact_inputs(_read_json(inputs_path))
    if raw_dir:
        inputs['evidenceSourceRevision'] = raw_provenance(raw_dir,inputs.get('sourceManifest',[]))
    provenance = _validated_source_revision(inputs['evidenceSourceRevision']) if 'evidenceSourceRevision' in inputs else None
    benchmarks = []
    if benchmarks_path:
        with Path(benchmarks_path).open(encoding='utf-8-sig',newline='') as stream:
            benchmarks = list(csv.DictReader(stream))
    model,report,tables = build_evidence(inputs,reference,benchmarks)
    if provenance:
        model['meta'].update({
            'methodSnapshotDate':MODEL_META['buildDate'],
            'buildDate':provenance['buildDate'],
            'evidenceVersion':provenance['evidenceVersion'],
            'buildMode':'raw-acquisition-cache',
        })
        report['sourceRevision'] = provenance
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True,exist_ok=True)
    artifacts = {}
    for name,value,indent in (
        ('analytical_model.json',model,None),('analytical_validation.json',report,2),
        ('analytical_source_manifest.json',inputs.get('sourceManifest',[]),2),
    ):
        path = output_dir/name
        path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=indent,
                                   separators=(',',':') if indent is None else None),encoding='utf-8')
        artifacts[name] = str(path)
    if raw_dir:
        path = output_dir/'analytical_inputs.json'
        path.write_text(json.dumps(inputs,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')
        artifacts[path.name] = str(path)
    for name,rows in tables.items():
        path = output_dir/name
        csv_write(path,rows)
        if path.exists():
            artifacts[name] = str(path)
    if downloads_dir:
        for name,rows in download_tables(model).items():
            path = Path(downloads_dir)/name
            csv_write(path,rows)
            if path.exists():
                artifacts[name] = str(path)
    if browser_assets_dir:
        assets_dir = Path(browser_assets_dir)
        assets_dir.mkdir(parents=True,exist_ok=True)
        path = assets_dir/'decision-data.js'
        path.write_text('window.QUIESCE_DECISION='+json.dumps(model,separators=(',',':'),ensure_ascii=False,allow_nan=False)+';\n',encoding='utf-8')
        artifacts[path.name] = str(path)
        for name,(global_name,value) in browser_adapters(model,inputs).items():
            path = assets_dir/name
            path.write_text(f'window.{global_name}='+json.dumps(value,separators=(',',':'),ensure_ascii=False,allow_nan=False)+';\n',encoding='utf-8')
            artifacts[name] = str(path)
    return {'states':len(model['state']),'counties':len(model['county']),
            'populationAccountingFailures':len(report['populationAccountingFailures']),
            'joinMissing':{table:len(audit['missing']) for table,audit in report['joinAudit'].items()},
            'artifacts':artifacts}
