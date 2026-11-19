"""Official-input cleaning: independent small examples and cached-source audit."""
from __future__ import annotations

from copy import deepcopy
import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from turnout.cleaning import clean_policy_inputs, compare_policy_inputs, parse_bps
from turnout.policies import build_scenarios
from turnout.baseline import build_baseline, read_history


def write_bps(path, entries, county=False):
    with Path(path).open('w', encoding='utf-8', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerows([['Survey', 'FIPS'], ['Date', 'State'], []])
        for fips, units, value in entries:
            row = ['0'] * (30 if county else 29)
            row[0], row[1] = ('2025' if county else '202599'), fips[:2]
            if county:
                row[2], row[5], row[7], row[8] = fips[2:], 'Example County', units, value
                row[19] = 999_999  # Reported-only units must never be added again.
            else:
                row[4], row[6], row[7] = 'Example State', units, value
                row[18] = 999_999
            writer.writerow(row)


class CleaningTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='turnout_cleaning_test_')
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.state_bps, self.county_bps = self.folder / 'state.txt', self.folder / 'county.txt'
        write_bps(self.state_bps, [('01', 10, 999)])
        write_bps(self.county_bps, [('01001', 2, 600_000), ('01003', 0, 0)], county=True)
        self.model = {'county': {fips: {'name': f'Example {fips}', 'evidence': {'stock': {'detached': stock}}}
            for fips, stock in (('01001', 100), ('01003', 200), ('01005', 300))}}
        # Poison numerical fields in the identity file: none may affect results.
        self.geographies = {'state': {'01': {'baseline_annual_units': 999999}},
            'county': {fips: {'sf_detached_units': 999999, 'scenario_cost_base': 1}
                       for fips in ('01001', '01003', '01005')}}
        self.exposure = {'reconstruction_version': 'unit-test-gis.v1',
            'state': {'AL': .2}, 'county': {'01001': .1, '01003': 0, '01005': None}}
        self.model_path, self.geography_path, self.exposure_path = [self.folder / name for name in ('model.json', 'geographies.json', 'exposure.json')]
        self._save()

    def _save(self):
        for path, value in ((self.model_path, self.model), (self.geography_path, self.geographies), (self.exposure_path, self.exposure)):
            path.write_text(json.dumps(value), encoding='utf-8')

    def _clean(self):
        return clean_policy_inputs(self.state_bps, self.county_bps, self.model_path,
            self.geography_path, self.exposure_path, self.folder / 'policy_inputs.json')

    def test_bps_units_and_valuation_conventions_exclude_reported_only_blocks(self):
        state, county = parse_bps(self.state_bps)['01'], parse_bps(self.county_bps, county=True)['01001']
        self.assertEqual(state['units'], 10)
        self.assertEqual(state['valuation'], 999_000)
        self.assertEqual(county['units'], 2)
        self.assertEqual(county['valuation'], 600_000)

    def test_county_weighted_fallback_is_not_the_state_valuation_ratio(self):
        result = self._clean()
        state = result['states'][0]
        by_county = {row['fips']: row for row in result['counties']}
        self.assertEqual(state['baseline_annual_units'], 10)
        self.assertEqual(state['baseline_5yr_units'], 50)
        self.assertEqual(state['reconciliation_factor'], 5)
        self.assertEqual(by_county['01001']['avg_permit_value_per_unit'], 300_000)
        self.assertEqual(by_county['01003']['scenario_cost_base'], 300_000)
        self.assertEqual(by_county['01005']['scenario_cost_base'], 300_000)
        self.assertNotEqual(by_county['01003']['scenario_cost_base'], 999_000 / 10)
        self.assertEqual([row['sf_detached_units'] for row in result['counties']], [100, 200, 300])
        report = json.loads((self.folder / 'policy_inputs.report.json').read_text(encoding='utf-8'))
        self.assertEqual(report['state_cost_and_coverage'][0]['unallocated_annual_units'], 8)
        self.assertFalse(report['stored_policy_outputs_used_as_inputs'])

    def test_missing_and_zero_are_preserved_separately(self):
        rows = {row['fips']: row for row in self._clean()['counties']}
        self.assertEqual(rows['01003']['baseline_annual_units'], 0)
        self.assertEqual(rows['01003']['baseline_5yr_units'], 0)
        self.assertIsNone(rows['01005']['baseline_annual_units'])
        self.assertIsNone(rows['01005']['baseline_5yr_units'])
        self.assertIsNone(rows['01005']['permit_valuation_total'])
        self.assertEqual(rows['01003']['tod_housing_share_new'], 0)
        self.assertIsNone(rows['01005']['tod_housing_share_new'])

    def test_unknown_gis_records_and_unavailable_acs_do_not_fall_back_to_old_values(self):
        del self.exposure['county']['01005']
        self._save()
        with self.assertRaisesRegex(ValueError, 'Missing GIS exposure'):
            self._clean()
        self.exposure['county']['01005'] = None
        self.model['county']['01005']['evidence']['stock']['detached'] = None
        self._save()
        with self.assertRaisesRegex(ValueError, 'ACS detached housing count'):
            self._clean()

    def test_explicit_unknown_state_transit_remains_unknown_at_national_level(self):
        self.exposure['state']['AL'] = None
        self._save()
        inputs = self._clean()
        assumptions = json.loads((ROOT / 'config/assumptions.json').read_text(encoding='utf-8'))
        result, _, _ = build_scenarios(inputs, {'states': {'AL': {'low': 25, 'fiveYear': 50, 'high': 100}},
            'countyMethod': 'unit test'}, assumptions)
        self.assertIsNone(result['states']['AL']['scenarios']['central']['tod']['default'])
        self.assertIsNone(result['national']['scenarios']['central']['tod']['default'])
        self.assertIsNotNone(result['states']['AL']['scenarios']['central']['adu']['default'])

    def test_reference_comparison_cannot_hide_changes_to_primary_inputs(self):
        actual = self._clean()
        reference = deepcopy(actual)
        reference['counties'][0]['scenario_cost_base'] += 1e-9
        self.assertTrue(compare_policy_inputs(actual, reference)['passed'])
        reference['counties'][0]['sf_detached_units'] += 1
        comparison = compare_policy_inputs(actual, reference)
        self.assertFalse(comparison['passed'])
        self.assertEqual(comparison['exact_mismatches'][0]['field'], 'sf_detached_units')

    @unittest.skipUnless(all(path.exists() for path in (
        ROOT / 'data/raw/st2025a.txt', ROOT / 'data/raw/co2025a.txt',
        ROOT / 'data/generated/evidence/analytical_model.json')),
        'Optional official-source integration audit: run acquisition and evidence rebuild first')
    def test_cached_official_sources_reconstruct_all_nonspatial_inputs(self):
        frozen = json.loads((ROOT / 'data/snapshot/policy_inputs.json').read_text(encoding='utf-8'))
        # This test holds the inherited exposure constant solely to isolate
        # stock/cost/permit reconstruction. It is never a refreshed GIS result.
        exposure = {'reconstruction_version': 'comparison-only-inherited-exposure',
            'county': {row['fips']: row['tod_housing_share_new'] for row in frozen['counties']},
            'state': {row['state_abbr']: row['tod_housing_share_new'] for row in frozen['states']}}
        exposure_path = self.folder / 'comparison-only-exposure.json'
        exposure_path.write_text(json.dumps(exposure), encoding='utf-8')
        rebuilt = clean_policy_inputs(ROOT / 'data/raw/st2025a.txt', ROOT / 'data/raw/co2025a.txt',
            ROOT / 'data/generated/evidence/analytical_model.json', ROOT / 'data/snapshot/analytical_geography.json',
            exposure_path, self.folder / 'all_policy_inputs.json')
        comparison = compare_policy_inputs(rebuilt, frozen)
        self.assertTrue(comparison['passed'], comparison)
        self.assertEqual(comparison['exact_field_cases'], 12_729)
        production = build_baseline(read_history(ROOT / 'data/snapshot/production_history.csv', rebuilt['states']), rebuilt['states'])[0]
        assumptions = json.loads((ROOT / 'config/assumptions.json').read_text(encoding='utf-8'))
        result, _, _ = build_scenarios(rebuilt, production, assumptions)
        expected = json.loads((ROOT / 'data/snapshot/expected_results.json').read_text(encoding='utf-8'))['policy']
        self.assertEqual({key: result[key] for key in ('states', 'counties', 'national')}, expected)


if __name__ == '__main__':
    unittest.main()
