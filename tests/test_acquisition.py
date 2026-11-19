"""Acquisition integrity, source selection and official county-format tests."""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from turnout import acquisition as a
from turnout import history as h

ACS = b'GEO_ID|B25024_E001|B25024_M001\n0400000US27|100|2\n'


class Response(io.BytesIO):
    url = 'https://www2.census.gov/test.dat'
    headers = {'Content-Type': 'text/plain', 'ETag': 'test-etag'}


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = Path(self.temp.name) / 'cache'
        self.spec = {'id': 'test_acs', 'filename': 'input.dat',
                     'url': 'https://www2.census.gov/test.dat', 'format': 'acs',
                     'vintage': 'test2024', 'snapshot_sha256': hashlib.sha256(ACS).hexdigest()}

    def tearDown(self):
        self.temp.cleanup()

    def test_download_hash_manifest_and_cached_no_network(self):
        with mock.patch.object(a, '_request', return_value=Response(ACS)) as request:
            first = a.download(self.spec, self.cache)
            self.assertEqual(first['sha256'], self.spec['snapshot_sha256'])
            self.assertTrue(first['snapshot_match'])
            second = a.download(self.spec, self.cache, previous=first)
            self.assertEqual(second['acquisition'], 'cache')
            self.assertEqual(first['retrieved_utc'], second['retrieved_utc'])
            request.assert_called_once()

    def test_html_disguised_as_data_is_rejected_without_final_file(self):
        with mock.patch.object(a, '_request', return_value=Response(b'<html>error</html>')):
            with self.assertRaisesRegex(ValueError, 'header'):
                a.download(self.spec, self.cache)
        self.assertFalse((self.cache / 'input.dat').exists())
        self.assertFalse((self.cache / 'input.dat.part').exists())

    def test_seeded_original_must_match_declared_snapshot(self):
        seed = Path(self.temp.name) / 'seed'
        seed.mkdir()
        (seed / 'input.dat').write_bytes(ACS)
        with mock.patch.object(a, '_request', side_effect=AssertionError('No network expected')):
            result = a.download(self.spec, self.cache, seed_dirs=[seed])
        self.assertEqual(result['acquisition'], 'seeded_existing_official_cache')
        self.assertTrue(result['snapshot_match'])

    def test_refresh_retains_previous_bytes_and_reports_snapshot_delta(self):
        self.cache.mkdir()
        (self.cache / 'input.dat').write_bytes(ACS)
        revised = ACS.replace(b'|100|', b'|101|')
        with mock.patch.object(a, '_request', return_value=Response(revised)):
            result = a.download(self.spec, self.cache, refresh=True)
        old = self.cache / '_versions/test_acs' / hashlib.sha256(ACS).hexdigest() / 'input.dat'
        self.assertEqual(old.read_bytes(), ACS)
        self.assertEqual((self.cache / 'input.dat').read_bytes(), revised)
        self.assertFalse(result['snapshot_match'])

    def test_unexpected_cache_change_fails(self):
        self.cache.mkdir()
        (self.cache / 'input.dat').write_bytes(ACS.replace(b'|100|', b'|999|'))
        with self.assertRaisesRegex(ValueError, 'hash changed'):
            a.download(self.spec, self.cache)

    def test_filename_cannot_escape_cache(self):
        self.spec['filename'] = '../outside.dat'
        with self.assertRaisesRegex(ValueError, 'escapes'):
            a.download(self.spec, self.cache)

    def test_https_required(self):
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            a._request('http://example.org/data')

    def test_source_groups_state_screen_and_no_duplicate_2025(self):
        core = a.source_specs(('core',))
        self.assertEqual(sum(x['format'] == 'acs' for x in core), 18)
        all_specs = a.source_specs(('core', 'history', 'spatial'), ['MN'], [2024, 2025])
        self.assertEqual(sum(x['filename'] == 'co2025a.txt' for x in all_specs), 1)
        self.assertEqual(sum(x['id'].startswith('tracts_') for x in all_specs), 1)
        self.assertIn('tracts_27', [x['id'] for x in all_specs])
        display = {x['id']: x for x in all_specs if x['id'].endswith('_20m')}
        self.assertEqual(set(display), {'display_state_2024_20m', 'display_county_2024_20m'})
        for spec in display.values():
            self.assertIn('/GENZ2024/shp/', spec['url'])
            self.assertTrue(spec['filename'].endswith('_20m.zip'))
        with self.assertRaisesRegex(ValueError, 'Unsupported state'):
            a.normalize_states(['PR'])

    def test_fixed_mode_query_uses_token_boundaries(self):
        query = a.fixed_guideway_where(['1'])
        self.assertIn("stop_type = '1'", query)
        self.assertIn("stop_type LIKE '%;1;%'", query)
        self.assertNotIn("LIKE '%1%'", query)

    def test_transit_truncated_page_rejected(self):
        spec = a.load_catalog()['transit']
        meta = {'owner': 'USDOT_BTS', 'url': spec['service_url'], 'modified': 42}
        layer = {'fields': [{'name': 'OBJECTID'}, {'name': 'stop_type'}], 'maxRecordCount': 2000}
        calls = [meta, layer, {'objectIds': [1, 2]}, {'features': [{'properties': {'OBJECTID': 1}}]}]
        with mock.patch.object(a, '_json_url', side_effect=calls):
            with self.assertRaisesRegex(ValueError, 'Incomplete official transit page'):
                a.acquire_ntm_stops(self.cache)
        self.assertFalse((self.cache / 'spatial/ntm_fixed_guideway_stops.geojson').exists())


def annual_row(code='001', units=(10, 2, 4, 20), reported=(9, 2, 4, 20), survey='9099'):
    fields = [survey, '27', code, '2', '4', 'Test County']
    for value in units:
        fields.extend(['1', str(value), '100000'])
    for value in reported:
        fields.extend(['1', str(value), '90000'])
    return ','.join(fields)


class CountyHistoryTests(unittest.TestCase):
    def test_legacy_survey_token_structures_reported_and_unassigned(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'co1990a.txt'
            path.write_text('Survey,FIPS\r\r\nDate,State\r\r\n' + annual_row() + '\r\r\n' + annual_row('000') + '\r\r\n')
            rows, balances = h.parse_county_file(path, 1990)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['fips'], '27001')
            self.assertEqual(rows[0]['year'], 1990)
            self.assertEqual(rows[0]['total_permitted_units'], 36)
            self.assertEqual(rows[0]['reported_only_units'], 35)
            self.assertEqual(rows[0]['estimated_minus_reported'], 1)
            self.assertEqual(rows[0]['permit_valuation_total'], 400000)
            self.assertEqual(balances[0]['fips'], '27000')

    def test_duplicate_county_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'co2025a.txt'
            path.write_text(annual_row(survey='2025') + '\n' + annual_row(units=(99, 2, 4, 20), survey='2025'))
            with self.assertRaisesRegex(ValueError, 'Conflicting duplicate'):
                h.parse_county_file(path, 2025)

    def test_identical_official_duplicate_is_counted_once_and_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'co2014a.txt'
            path.write_text(annual_row(survey='2014') + '\n' + annual_row(survey='2014').replace('Test County', 'Renamed County'))
            rows, _ = h.parse_county_file(path, 2014)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['total_permitted_units'], 36)
            self.assertEqual(rows[0]['record_quality'], 'parsed_equal_numeric_duplicate')
            self.assertIn('Renamed County', rows[0]['duplicate_source_names'])

    def test_browser_aggregates_filter_current_fips_no_future(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            path = directory / 'co2025a.txt'
            path.write_text(annual_row(survey='2025') + '\n' + annual_row('003', survey='2025'))
            output = directory / 'clean.csv'
            report = h.clean_county_history(directory, output, [2025])
            self.assertEqual(report['rows'], 2)
            browser = directory / 'browser'
            h.write_browser_history(output, browser, current_fips={'27001'})
            state = (browser / 'MN.js').read_text()
            aggregate = (browser / 'AGGREGATES.js').read_text()
            self.assertIn('TURNOUT_HISTORY_STATE=', state)
            self.assertNotIn('27003', state)
            self.assertNotIn('2026', aggregate)
            parsed = json.loads(aggregate.split('=', 1)[1].rstrip(';\n'))
            self.assertEqual(parsed['US']['history'], [[2025, 10, 2, 4, 20, 36]])


if __name__ == '__main__':
    unittest.main()
