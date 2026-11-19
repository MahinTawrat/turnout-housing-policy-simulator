"""Evidence semantics, missing-data behavior and frozen-release parity."""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from turnout import evidence as e


class EvidenceArithmeticTests(unittest.TestCase):
    def test_suppressed_cells_are_missing_and_migration_remains_signed(self):
        for value in ('-666666666','NaN','inf','',None):
            self.assertIsNone(e.number(value))
        self.assertEqual(e.number('0'),0)
        self.assertEqual(e.signed('-123'),-123)
        self.assertIsNone(e.signed('NaN'))

    def test_sums_and_approximate_survey_margins_do_not_impute_zero(self):
        self.assertEqual(e.total([0,0]),0)
        self.assertIsNone(e.total([5,None]))
        self.assertEqual(e.moe([3,4]),5)
        self.assertIsNone(e.moe([3,None]))
        self.assertIsNone(e.divide(5,0))

    def test_population_envelope_uses_components_and_excludes_residual(self):
        row = {'POPESTIMATE2025':'1000'}
        for year,net in zip(range(2021,2026),(1,2,3,4,5)):
            row.update({f'BIRTHS{year}':'10',f'DEATHS{year}':'5',
                        f'DOMESTICMIG{year}':str(net-6),f'INTERNATIONALMIG{year}':'1',
                        f'RESIDUAL{year}':'999999'})
        envelope,variants = e.project_population(row)
        self.assertEqual(variants,{'central':1020,'longHistory':1015,'latestYear':1025})
        self.assertEqual(envelope,{'low':1015,'central':1020,'high':1025})
        del row['BIRTHS2023']
        with self.assertRaises(ValueError):
            e.project_population(row)

    def test_population_boundary_and_household_proxy(self):
        row = {'POPESTIMATE2025':'100'}
        for year in range(2021,2026):
            row.update({f'BIRTHS{year}':'0',f'DEATHS{year}':'1',
                        f'DOMESTICMIG{year}':'-99',f'INTERNATIONALMIG{year}':'0'})
        envelope,_ = e.project_population(row)
        self.assertEqual(envelope,{'low':0,'central':0,'high':0})
        self.assertEqual(e.household_change(1000,1100,100,2),45)
        self.assertEqual(e.household_change(1000,900,100,2),-45)
        self.assertIsNone(e.household_change(1000,1100,100,0))
        self.assertIsNone(e.household_change(1000,1100,1100,2))
        self.assertIsNone(e.household_change(1000,1100,100,float('nan')))

    def test_construction_requirement_requires_every_distinct_accounting_term(self):
        self.assertIsNone(e.construction_requirement(100))
        self.assertIsNone(e.construction_requirement(100,0,0,0,None,0,0))
        self.assertEqual(e.construction_requirement(100,10,2,3,5,20,1),89)
        self.assertEqual(e.construction_requirement(-100,0,0,0,0,0,0),0)
        with self.assertRaises(ValueError):
            e.construction_requirement(100,0,0,0,-1,0,0)


class FrozenEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        snapshot = ROOT/'data/snapshot'
        cls.inputs = e._read_json(snapshot/'analytical_inputs.json.gz')
        cls.reference = json.loads((snapshot/'analytical_geography.json').read_text(encoding='utf-8'))
        with (snapshot/'independent_benchmarks.csv').open(encoding='utf-8-sig',newline='') as stream:
            cls.benchmarks = list(csv.DictReader(stream))
        cls.model,cls.report,cls.tables = e.build_evidence(cls.inputs,cls.reference,cls.benchmarks)

    def local_inputs(self, key='27053'):
        return {
            'acs':{table:{key:copy.deepcopy(rows.get(key,{}))} for table,rows in self.inputs['acs'].items()},
            'population':{key:copy.deepcopy(self.inputs['population'][key])},
            'chas':{table:{key:copy.deepcopy(rows[key])} for table,rows in self.inputs['chas'].items()},
            'sourceManifest':[],
        }

    def test_complete_frozen_model_matches_approved_release_digest(self):
        # Contract established against the approved November 17 tool, not a
        # second implementation of these formulas or a source browser file.
        serialized = json.dumps(self.model,separators=(',',':'),ensure_ascii=False).encode('utf-8')
        self.assertEqual(hashlib.sha256(serialized).hexdigest(),
                         '5162cf406e077eb95775a79e966f90cf1fd8b76b3a49234a25110b5e70743130')
        self.assertEqual(len(self.model['state']),51)
        self.assertEqual(len(self.model['county']),3144)
        self.assertFalse(self.report['populationAccountingFailures'])
        self.assertTrue(all(not audit['missing'] for audit in self.report['joinAudit'].values()))

    def test_minnesota_observed_denominators_and_scenarios(self):
        record = self.model['state']['27']
        self.assertEqual(record['evidence']['stock']['detached'],1680195)
        self.assertEqual(record['evidence']['burden']['above30'],290600)
        self.assertEqual(record['evidence']['burden']['denominator'],604069)
        self.assertEqual(record['evidence']['burden']['rate'],48.107087)
        self.assertEqual(record['evidence']['crowding']['renter'],29913)
        self.assertEqual(record['evidence']['crowding']['renterMOE'],1378.383473)
        self.assertEqual(record['demand']['hhChange'],
                         {'low':48238.793813,'central':69404.913977,'high':69404.913977})
        self.assertIsNone(record['demand']['constructionRequired'])
        self.assertEqual(record['demand']['constructionStatus'],'UNAVAILABLE')
        self.assertIn('not a statistical confidence interval',self.model['meta']['range'])

    def test_missing_crowding_cell_does_not_erase_other_observations(self):
        inputs = self.local_inputs()
        inputs['acs']['B25014']['27053']['B25014_E012'] = None
        record = e.make_record('27053',inputs)
        self.assertIsNone(record['evidence']['crowding']['renter'])
        self.assertIsNone(record['evidence']['crowding']['renterRate'])
        self.assertEqual(record['evidence']['stock']['detached'],297075)

    def test_missing_population_component_keeps_observed_stock_but_no_projection(self):
        inputs = self.local_inputs()
        del inputs['population']['27053']['DOMESTICMIG2023']
        record = e.make_record('27053',inputs)
        self.assertIsNone(record['population'])
        self.assertTrue(all(value is None for value in record['demand']['hhChange'].values()))
        self.assertEqual(record['evidence']['stock']['detached'],297075)
        self.assertTrue(any('incomplete or invalid' in flag for flag in record['flags']))

    def test_missing_chas_cell_never_becomes_zero_problem_households(self):
        inputs = self.local_inputs()
        inputs['chas']['1']['27053']['T1_est77'] = None
        record = e.make_record('27053',inputs)
        e.add_chas(record,'27053',inputs,['27053'])
        self.assertNotIn('chas',record['evidence'])
        self.assertTrue(any('CHAS inputs incomplete' in flag for flag in record['flags']))

    def test_downloads_are_derived_from_model_with_national_state_and_county_rows(self):
        tables = e.download_tables(self.model)
        for name in ('acs_housing_evidence.csv','population_household_scenarios.csv','chas_housing_problems.csv'):
            self.assertEqual(len(tables[name]),3196)
        rows = [row for row in tables['population_household_scenarios.csv'] if row['geoid']=='27']
        self.assertEqual(rows[0]['demand.hhChange.low'],48238.793813)
        self.assertIsNone(rows[0]['demand.constructionRequired'])
        self.assertEqual(rows[0]['observed_cutoff'],2025)

    def test_refreshed_adapters_use_current_counts_and_do_not_invent_chas_margins(self):
        mini = {'national':self.model['national'],'state':{'27':self.model['state']['27']},
                'county':{'27053':self.model['county']['27053']}}
        adapters = e.browser_adapters(mini,self.inputs)
        self.assertEqual(adapters['housing-needs.js'][1]['state']['27']['burdenDenom'],604069)
        self.assertEqual(adapters['structure-evidence.js'][1]['state']['27']['detached'],1680195)
        self.assertEqual(adapters['housing-types.js'][1]['county']['27053']['overcrowdedR'],10668)
        chas = adapters['chas-affordability.js'][1]['county']['27053']
        self.assertIsNone(chas['highMoe'])
        self.assertIsNone(chas['percentile'])
        self.assertEqual(chas['lowProblem'],82685)

    def test_rebuild_has_explicit_paths_and_standalone_browser_and_download_outputs(self):
        keys = ('US','27','27053')
        inputs = {
            'acs':{table:{key:rows[key] for key in keys} for table,rows in self.inputs['acs'].items()},
            'population':{key:self.inputs['population'][key] for key in keys},
            'chas':{table:{'27053':rows['27053']} for table,rows in self.inputs['chas'].items()},
            'sourceManifest':[],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            summary = e.rebuild_evidence(inputs,{'state':{'27':None},'county':{'27053':None}},
                                         root/'model',browser_assets_dir=root/'assets',downloads_dir=root/'downloads')
            self.assertEqual(summary['states'],1)
            script = (root/'assets/decision-data.js').read_text(encoding='utf-8')
            self.assertTrue(script.startswith('window.QUIESCE_DECISION='))
            self.assertEqual(json.loads(script.split('=',1)[1].strip().rstrip(';'))['state']['27']['name'],'Minnesota')
            self.assertTrue((root/'downloads/acs_housing_evidence.csv').is_file())
            self.assertTrue((root/'assets/structure-evidence.js').is_file())
            self.assertTrue((root/'model/analytical_validation.json').is_file())
            (root/'acquisition_manifest.json').write_text(json.dumps({'updated_utc':'2026-11-18T12:00:00Z'}),encoding='utf-8')
            inputs['evidenceSourceRevision'] = e.raw_provenance(root,[{'file':'source.dat','sha256':'a'*64}])
            e.rebuild_evidence(inputs,{'state':{'27':None},'county':{'27053':None}},root/'normalized')
            normalized = json.loads((root/'normalized/analytical_model.json').read_text(encoding='utf-8'))
            self.assertEqual(normalized['meta']['buildDate'],'2026-11-18')
            self.assertEqual(normalized['meta']['evidenceVersion'],inputs['evidenceSourceRevision']['evidenceVersion'])
            self.assertEqual(normalized['meta']['methodSnapshotDate'],'2026-11-08')


class RawEvidenceTests(unittest.TestCase):
    def test_raw_metadata_uses_recorded_utc_date_actual_hashes_and_no_manifest_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root/'acquisition_manifest.json'
            manifest.write_text(json.dumps({'updated_utc':'2026-11-18T23:30:00-02:00',
                                            'private_path':'C:/private/not-an-input'}),encoding='utf-8')
            sources = [{'file':'source.dat','sha256':'a'*64},{'file':'other.csv','sha256':'b'*64}]
            version = e.raw_provenance(root,sources)
            self.assertEqual(version['buildDate'],'2026-11-19')
            self.assertEqual(version,e.raw_provenance(root,list(reversed(sources))))
            self.assertNotIn('private',json.dumps(version))
            changed = e.raw_provenance(root,[{'file':'source.dat','sha256':'c'*64},sources[1]])
            self.assertNotEqual(version['evidenceVersion'],changed['evidenceVersion'])
            with self.assertRaisesRegex(ValueError,'basenames only'):
                e.raw_provenance(root,[{'file':'../private.dat','sha256':'a'*64}])
            manifest.write_text(json.dumps({'updated_utc':'2026-11-18T12:00:00'}),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'explicit time zone'):
                e.raw_provenance(root,sources)

    def test_official_cache_parser_normalizes_survey_specials_and_retains_raw_moes(self):
        reference = {'state':{'27':None},'county':{'27053':None}}
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory)
            for table in e.TABLES:
                with (raw/f'acsdt5y2024-{table.lower()}.dat').open('w',encoding='utf-8',newline='') as stream:
                    writer = csv.writer(stream,delimiter='|')
                    writer.writerow(['GEO_ID',f'{table}_E001',f'{table}_M001'])
                    for geoid in ('0100000US','0400000US27','0500000US27053'):
                        writer.writerow([geoid,'-666666666' if table=='B25064' else '100','3'])
            population = {'SUMLEV':'040','STATE':'27','COUNTY':'000','STNAME':'Minnesota','CTYNAME':'Minnesota'}
            for year in range(2020,2026):
                population[f'POPESTIMATE{year}'] = str(1000+4*(year-2020))
            for year in range(2021,2026):
                for field,value in {'BIRTHS':10,'DEATHS':5,'DOMESTICMIG':-2,'INTERNATIONALMIG':1,'RESIDUAL':0}.items():
                    population[f'{field}{year}'] = str(value)
            population.update(GQESTIMATES2025='10',NATURALCHG2025='5')
            with (raw/'co-est2025-alldata.csv').open('w',encoding='cp1252',newline='') as stream:
                writer = csv.DictWriter(stream,fieldnames=list(population));writer.writeheader();writer.writerow(population)
                writer.writerow({**population,'SUMLEV':'050','COUNTY':'053','CTYNAME':'Hennepin County'})
            with zipfile.ZipFile(raw/'2018thru2022-050-csv.zip','w') as archive:
                for table in ('1','2'):
                    columns = [75,76,77,84,91,113,120,127] if table=='1' else [77,84,91]
                    buffer = io.StringIO();writer = csv.writer(buffer)
                    writer.writerow(['geoid']+[f'T{table}_{kind}{index}' for kind in ('est','moe') for index in columns])
                    writer.writerow(['0500000US27053']+[10]*len(columns)+[2]*len(columns))
                    archive.writestr(f'050/Table{table}.csv',buffer.getvalue())
            inputs = e.compact_inputs(e.load_raw(raw,reference))
            self.assertIsNone(inputs['acs']['B25064']['27053']['B25064_E001'])
            self.assertEqual(float(inputs['population']['27053']['DOMESTICMIG2025']),-2)
            self.assertEqual(float(inputs['population']['US']['DOMESTICMIG2025']),-2)
            self.assertEqual(inputs['chas']['1']['27053']['T1_moe76'],2)
            self.assertEqual(len(inputs['sourceManifest']),20)


if __name__=='__main__':
    unittest.main()
