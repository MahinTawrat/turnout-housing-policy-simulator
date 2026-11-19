"""Independent benchmark parsers: explicit geography and source-year semantics."""
from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from turnout import benchmarks as b

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
GEOGRAPHIES = {'counties':[
    {'fips':'06001','state_fips':'06','county_name':'Alameda'},
    {'fips':'37183','state_fips':'37','county_name':'Wake County'},
]}


def workbook(path, *, duplicate=False, missing_year=False):
    """Use moved year columns and arbitrary sheet filenames to expose shortcuts."""
    def cell(column,row,value):
        if isinstance(value,int):
            return f'<c r="{column}{row}"><v>{value}</v></c>'
        return f'<c r="{column}{row}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
    rows = [
        {'D':'FIPS','A':'Geography','F':'2025','C':'2035' if missing_year else '2030'},
        {'D':6000,'A':'CALIFORNIA','F':1000,'C':1100},
        {'D':6001,'A':'ALAMEDA','F':100,'C':120},
    ]
    if duplicate:
        rows.append(rows[-1])
    data = ''.join('<row>'+''.join(cell(column,index,value) for column,value in row.items())+'</row>'
                   for index,row in enumerate(rows,1))
    with zipfile.ZipFile(path,'w') as archive:
        archive.writestr('xl/workbook.xml',f'<workbook xmlns="{M}" xmlns:r="{R}"><sheets><sheet name="Notes" sheetId="7" r:id="notes"/><sheet name="Totals" sheetId="42" r:id="data"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Target="worksheets/notes17.xml"/><Relationship Id="data" Target="worksheets/totals42.xml"/></Relationships>')
        archive.writestr('xl/worksheets/notes17.xml',f'<worksheet xmlns="{M}"><sheetData><row><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>')
        archive.writestr('xl/sharedStrings.xml',f'<sst xmlns="{M}"><si><r><t>Baseline 2024; </t></r><r><t>Vintage 2026</t></r></si></sst>')
        archive.writestr('xl/worksheets/totals42.xml',f'<worksheet xmlns="{M}"><sheetData>{data}</sheetData></worksheet>')


def nc_html(path, *, extra='', metadata=True, missing_year=False):
    source = '<p>Vintage 2024 Population Estimates &amp; Vintage 2025B Population Projections</p>' if metadata else ''
    year = '2035' if missing_year else '2025'
    path.write_text(source+f'<table><tr><th>County</th><th>Population in 2030</th><th>Population in {year}</th></tr><tr><td>Wake</td><td>1,200</td><td>1,000</td></tr><tr><td>STATE</td><td>12,000</td><td>10,000</td></tr>{extra}</table>',encoding='utf-8')


class BenchmarkParserTests(unittest.TestCase):
    def test_ca_uses_headers_and_workbook_relationships_not_fixed_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'projection.xlsx';workbook(path)
            records,metadata = b.parse_california(path)
            self.assertEqual([(row['fips'],row['p2025'],row['p2030']) for row in records],
                             [('06',1000,1100),('06001',100,120)])
            self.assertEqual(metadata['source_stated_edition'],'Baseline 2024 / Vintage 2026')
            self.assertEqual(metadata['worksheets'],['Notes','Totals'])

    def test_ca_rejects_duplicate_total_and_missing_requested_year(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'projection.xlsx'
            workbook(path,duplicate=True)
            with self.assertRaisesRegex(ValueError,'Duplicate California'):
                b.parse_california(path)
            workbook(path,missing_year=True)
            with self.assertRaisesRegex(ValueError,'no complete 2025/2030'):
                b.parse_california(path)

    def test_nc_resolves_name_to_canonical_fips_and_preserves_source_vintage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'nc.html';nc_html(path)
            records,metadata = b.parse_north_carolina(path,GEOGRAPHIES)
            self.assertEqual([(row['fips'],row['p2025'],row['p2030']) for row in records],
                             [('37183',1000,1200),('37',10000,12000)])
            self.assertEqual(metadata['source_stated_edition'],
                             'Projections Vintage 2025B / estimates Vintage 2024')

    def test_nc_rejects_unmatched_or_duplicate_numeric_county_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'nc.html'
            nc_html(path,extra='<tr><td>Invented County</td><td>20</td><td>10</td></tr>')
            with self.assertRaisesRegex(ValueError,'Unmatched NC'):
                b.parse_north_carolina(path,GEOGRAPHIES)
            nc_html(path,extra='<tr><td>Wake</td><td>20</td><td>10</td></tr>')
            with self.assertRaisesRegex(ValueError,'Duplicate NC'):
                b.parse_north_carolina(path,GEOGRAPHIES)

    def test_missing_edition_is_hash_labeled_and_missing_year_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'nc.html';nc_html(path,metadata=False)
            records,metadata = b.parse_north_carolina(path,GEOGRAPHIES)
            self.assertIn('edition not stated; source SHA256',metadata['source_stated_edition'])
            self.assertNotIn('Vintage 2025',records[0]['vintage'])
            nc_html(path,missing_year=True)
            with self.assertRaisesRegex(ValueError,'no complete 2025/2030'):
                b.parse_north_carolina(path,GEOGRAPHIES)

    def test_rebuild_exports_exact_coverage_source_hashes_and_repeatable_refresh_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);workbook(root/'ca_projection.xlsx');nc_html(root/'nc_projection_summary.html')
            first = b.rebuild_benchmarks(root,GEOGRAPHIES,root/'one')
            second = b.rebuild_benchmarks(root,GEOGRAPHIES,root/'two')
            self.assertEqual(first['rows'],4)
            self.assertEqual(first['version'],second['version'])
            self.assertTrue(first['version'].startswith('turnout.independent-benchmarks.refresh.'))
            with Path(first['csv']).open(encoding='utf-8',newline='') as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual({row['fips'] for row in rows},{'06','06001','37','37183'})
            report = json.loads(Path(first['manifest']).read_text(encoding='utf-8'))
            self.assertIn('not future observed forecast accuracy',report['interpretation'])
            self.assertEqual(report['source_files'][0]['sha256'],hashlib.sha256((root/'ca_projection.xlsx').read_bytes()).hexdigest())
            incomplete = {'counties':GEOGRAPHIES['counties']+[{'fips':'06003','state_fips':'06','county_name':'Alpine'}]}
            with self.assertRaisesRegex(ValueError,'coverage mismatch'):
                b.rebuild_benchmarks(root,incomplete,root/'bad')


if __name__=='__main__':
    unittest.main()
