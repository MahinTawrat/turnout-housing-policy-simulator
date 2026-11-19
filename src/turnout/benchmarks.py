"""Parse official independent population projections from the acquisition cache.

These benchmarks compare different published modeling assumptions. They are not
observed forecast outcomes, calibration targets or evidence of forecast accuracy.
The acquisition catalog supplies the two mutable official sources; this module
records their bytes and source-stated editions instead of claiming frozen parity.
"""
from __future__ import annotations

import csv
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

CA_URL = 'https://dof.ca.gov/media/docs/forecasting/Demographics/projections/P2A_County_Total.xlsx'
NC_URL = 'https://www.osbm.nc.gov/facts-figures/population-demographics/state-demographer/countystate-population-projections/population-summary'
X = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def _clean(value):
    return ' '.join(str(value).split())


def _population(value):
    try:
        number = float(_clean(value).replace(',',''))
    except (TypeError,ValueError) as error:
        raise ValueError(f'Invalid benchmark population: {value!r}') from error
    if not math.isfinite(number) or number<0 or not number.is_integer():
        raise ValueError(f'Benchmark population must be a nonnegative integer: {value!r}')
    return int(number)


def xlsx_tables(path):
    """Read named worksheet rows with shared/inline strings, standard library only."""
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si',X):
                strings.append(''.join(text.text or '' for text in item.findall('.//m:t',X)))
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relations = {node.attrib['Id']:node.attrib['Target'] for node in
                     ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in workbook.findall('m:sheets/m:sheet',X):
            target = relations[sheet.attrib[f'{{{R}}}id']]
            part = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
            if not part.startswith('xl/') or '..' in part.split('/'):
                raise ValueError('Unexpected worksheet part path.')
            rows = []
            for row in ET.fromstring(archive.read(part)).findall('.//m:sheetData/m:row',X):
                values = {}
                for cell in row.findall('m:c',X):
                    column = re.sub('[0-9]','',cell.attrib['r'])
                    node = cell.find('m:v',X)
                    value = node.text or '' if node is not None else ''
                    if cell.attrib.get('t')=='s':
                        value = strings[int(value)]
                    elif cell.attrib.get('t')=='inlineStr':
                        value = ''.join(text.text or '' for text in cell.findall('.//m:t',X))
                    values[column] = _clean(value)
                rows.append(values)
            yield sheet.attrib['name'],rows


def parse_california(path):
    """Find requested years by header, not fixed Excel column letters/sheet IDs."""
    tables = list(xlsx_tables(path))
    context = ' '.join(value for _,rows in tables for row in rows[:30] for value in row.values())
    baseline = re.search(r'Baseline\s+(20\d{2})',context,re.I)
    if baseline is None:
        baseline = re.search(r'(20\d{2})\s+Baseline',context,re.I)
    vintage = re.search(r'Vintage\s+(20\d{2}[A-Za-z]?)',context,re.I)
    source_hash = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    edition = (f'Baseline {baseline.group(1)} / ' if baseline else '')
    edition += f'Vintage {vintage.group(1)}' if vintage else f'edition not stated; source SHA256 {source_hash[:12]}'
    records,seen = [],set()
    for sheet_name,rows in tables:
        header = None
        for row in rows:
            labels = {value.casefold():column for column,value in row.items()}
            if all(label in labels for label in ('fips','geography','2025','2030')):
                header = labels
                continue
            if header is None:
                continue
            raw_fips = row.get(header['fips'],'')
            if not re.fullmatch(r'\d+(?:\.0+)?',raw_fips):
                continue
            fips = str(int(float(raw_fips))).zfill(5)
            if not fips.startswith('06'):
                continue
            # P-2A total rows must not be confused with any future detailed table.
            if any(label in header and row.get(header[label],'').upper() not in allowed
                   for label,allowed in (
                       ('age',{'ALL AGES','TOTAL','ALL'}),
                       ('sex',{'ALL SEXES','TOTAL','ALL'}),
                       ('race-ethnicity recode',{'ALL RACES','TOTAL','ALL'}))):
                continue
            fips = '06' if fips=='06000' else fips
            if fips in seen:
                raise ValueError(f'Duplicate California benchmark FIPS: {fips}')
            seen.add(fips)
            records.append({
                'fips':fips,'name':row.get(header['geography'],''),
                'p2025':_population(row.get(header['2025'])),
                'p2030':_population(row.get(header['2030'])),
                'source':'California DOF P-2A','vintage':edition,'url':CA_URL,
            })
    if not records or '06' not in seen:
        raise ValueError('California workbook has no complete 2025/2030 state and county table.')
    return records,{'source_stated_edition':edition,'worksheets':[name for name,_ in tables]}


class HTMLTables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows,self.text = [],[]
        self.row,self.cell = None,None

    def handle_starttag(self,tag,attrs):
        if tag=='tr':
            self.row = []
        if tag in ('td','th'):
            self.cell = []

    def handle_data(self,value):
        self.text.append(value)
        if self.cell is not None:
            self.cell.append(value)

    def handle_endtag(self,tag):
        if tag in ('td','th') and self.row is not None and self.cell is not None:
            self.row.append(_clean(''.join(self.cell)))
            self.cell = None
        if tag=='tr' and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None


def _county_name(value):
    return re.sub(r'\s+county$','',_clean(value).casefold())


def parse_north_carolina(path, geographies):
    """Resolve names against explicit canonical FIPS, never sorted row numbers."""
    parser = HTMLTables()
    parser.feed(Path(path).read_text(encoding='utf-8-sig'))
    context = _clean(' '.join(parser.text))
    projections = re.search(r'Vintage\s+(20\d{2}[A-Za-z]?)\s+Population\s+Projections',context,re.I)
    estimates = re.search(r'Vintage\s+(20\d{2}[A-Za-z]?)\s+Population\s+Estimates',context,re.I)
    source_hash = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    edition = f'Projections Vintage {projections.group(1)}' if projections else f'edition not stated; source SHA256 {source_hash[:12]}'
    if estimates:
        edition += f' / estimates Vintage {estimates.group(1)}'
    names = {}
    for row in geographies['counties']:
        if row['state_fips']!='37':
            continue
        name,fips = _county_name(row['county_name']),row['fips']
        if name in names and names[name]!=fips:
            raise ValueError(f'Ambiguous canonical NC county name: {name}')
        names[name] = fips
    records,seen,columns = [],set(),None
    for row in parser.rows:
        if row and row[0].casefold()=='county':
            found = {year:[index for index,label in enumerate(row) if re.search(rf'\b{year}\b',label)]
                     for year in (2025,2030)}
            if all(len(indices)==1 for indices in found.values()):
                columns = {year:indices[0] for year,indices in found.items()}
            continue
        if columns is None or len(row)<=max(columns.values()):
            continue
        name = _clean(row[0])
        if name.casefold() in ('state','north carolina','state total'):
            fips = '37'
        else:
            fips = names.get(_county_name(name))
        try:
            p25,p30 = _population(row[columns[2025]]),_population(row[columns[2030]])
        except ValueError:
            if fips is not None:
                raise
            continue
        if fips is None:
            raise ValueError(f'Unmatched NC benchmark county: {name}')
        if fips in seen:
            raise ValueError(f'Duplicate NC benchmark FIPS: {fips}')
        seen.add(fips)
        records.append({'fips':fips,'name':name,'p2025':p25,'p2030':p30,
                        'source':'NC OSBM','vintage':edition,'url':NC_URL})
    if not records or '37' not in seen:
        raise ValueError('NC source has no complete 2025/2030 state and county table.')
    return records,{'source_stated_edition':edition}


def rebuild_benchmarks(raw_dir, geographies_path, output_dir):
    """Consume both core-catalog downloads and export independently versioned data.

    Acquisition is shared with ``turnout.acquisition``: its core source group
    includes ca_projection.xlsx and nc_projection_summary.html. This function
    never silently downloads or falls back to a frozen browser/benchmark file.
    """
    geographies = geographies_path if isinstance(geographies_path,dict) else json.loads(Path(geographies_path).read_text(encoding='utf-8-sig'))
    raw_dir,output_dir = Path(raw_dir),Path(output_dir)
    ca_path,nc_path = raw_dir/'ca_projection.xlsx',raw_dir/'nc_projection_summary.html'
    ca,ca_metadata = parse_california(ca_path)
    nc,nc_metadata = parse_north_carolina(nc_path,geographies)
    records = ca+nc
    expected = {row['fips'] for row in geographies['counties'] if row['state_fips'] in ('06','37')}|{'06','37'}
    actual = {row['fips'] for row in records}
    if expected!=actual:
        raise ValueError(f'Independent benchmark geography coverage mismatch: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}')
    manifest = []
    for path,url,metadata,count in (
        (ca_path,CA_URL,ca_metadata,len(ca)),(nc_path,NC_URL,nc_metadata,len(nc))):
        blob = path.read_bytes()
        manifest.append({'file':path.name,'url':url,'bytes':len(blob),
                         'sha256':hashlib.sha256(blob).hexdigest(),'rows':count,**metadata})
    version_hash = hashlib.sha256(''.join(item['sha256'] for item in manifest).encode('ascii')).hexdigest()[:12]
    report = {
        'version':'turnout.independent-benchmarks.refresh.'+version_hash,
        'source_files':manifest,'rows':len(records),'state_rows':2,
        'expected_geographies':len(expected),'missing_geographies':[],
        'interpretation':'Independent projection comparison only, not future observed forecast accuracy or a calibration target.',
        'refresh_contract':'New source hashes and source-stated editions are recorded. Frozen numerical equivalence is not asserted.',
    }
    output_dir.mkdir(parents=True,exist_ok=True)
    csv_path = output_dir/'independent_benchmarks.csv'
    with csv_path.open('w',encoding='utf-8',newline='') as stream:
        writer = csv.DictWriter(stream,fieldnames=('fips','name','p2025','p2030','source','vintage','url'))
        writer.writeheader();writer.writerows(records)
    manifest_path = output_dir/'benchmark_sources.json'
    manifest_path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    return {'rows':len(records),'version':report['version'],'csv':str(csv_path),
            'manifest':str(manifest_path),'artifacts':{'independent_benchmarks.csv':str(csv_path),'benchmark_sources.json':str(manifest_path)}}
