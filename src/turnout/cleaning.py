"""Construct neutral policy inputs from official permits, ACS and GIS outputs.

No frozen model values or expected policy results are read. The geography file
supplies identities only. State cost fallbacks use the matched county valuation
sum divided by the matched county unit sum; state BPS valuations, reported in
thousands of dollars, are not substituted for that documented county fallback.
"""
from __future__ import annotations

from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path

STATE_ABBREVIATIONS = dict(pair.split(':') for pair in (
    '01:AL 02:AK 04:AZ 05:AR 06:CA 08:CO 09:CT 10:DE 11:DC 12:FL 13:GA '
    '15:HI 16:ID 17:IL 18:IN 19:IA 20:KS 21:KY 22:LA 23:ME 24:MD 25:MA '
    '26:MI 27:MN 28:MS 29:MO 30:MT 31:NE 32:NV 33:NH 34:NJ 35:NM 36:NY '
    '37:NC 38:ND 39:OH 40:OK 41:OR 42:PA 44:RI 45:SC 46:SD 47:TN 48:TX '
    '49:UT 50:VT 51:VA 53:WA 54:WV 55:WI 56:WY').split())


def _load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.part')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def parse_bps(path, county=False):
    """Read the first four estimated structure blocks, including imputation.

    Reported-only blocks later in each row must not be counted again. County
    valuations are dollars; state valuations are thousands of dollars. All
    returned valuations are dollars, while the raw unit convention is retained.
    """
    records = {}
    unit_columns = (7, 10, 13, 16) if county else (6, 9, 12, 15)
    value_columns = (8, 11, 14, 17) if county else (7, 10, 13, 16)
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.reader(stream):
            if not row or not row[0].strip().isdigit():
                continue
            if not row[0].strip().startswith('2025'):
                raise ValueError('This release requires final annual 2025 BPS data')
            if len(row) <= max(value_columns):
                raise ValueError('Incomplete Census BPS structure blocks')
            state_fips = row[1].strip().zfill(2)
            fips = state_fips + row[2].strip().zfill(3) if county else state_fips
            if fips in records:
                raise ValueError('Duplicate BPS geography: ' + fips)
            try:
                units = [int(row[index].strip()) for index in unit_columns]
                valuations = [int(row[index].strip()) for index in value_columns]
            except ValueError as exc:
                raise ValueError('Invalid BPS unit or valuation cell: ' + fips) from exc
            if any(value < 0 for value in units + valuations):
                raise ValueError('Negative BPS count or valuation: ' + fips)
            multiplier = 1 if county else 1000
            records[fips] = {'units': sum(units), 'valuation': sum(valuations) * multiplier,
                'structure_units': units, 'name': row[5 if county else 4].strip(),
                'valuation_source_unit': 'dollars' if county else 'thousands of dollars'}
    if not records:
        raise ValueError('No annual 2025 BPS records found')
    return records


def _identities(geographies):
    """Accept the evidence geography map or an explicit identity-only listing."""
    if 'state' in geographies and 'county' in geographies:
        states = {str(key): value if isinstance(value, dict) else {} for key, value in geographies['state'].items()}
        counties = {str(key): value if isinstance(value, dict) else {} for key, value in geographies['county'].items()}
    elif 'states' in geographies and 'counties' in geographies:
        states = {row['state_fips']: row for row in geographies['states']}
        counties = {row['fips']: row for row in geographies['counties']}
    else:
        raise ValueError('Geographies require state/county maps or states/counties identity lists')
    if not states or not counties:
        raise ValueError('State and county identities must not be empty')
    if any(key not in STATE_ABBREVIATIONS for key in states):
        raise ValueError('Only the fifty states and DC are supported')
    if any(len(key) != 5 or not key.isdigit() or key[:2] not in states for key in counties):
        raise ValueError('County identities must be five-character FIPS in supported states')
    if set(states) != {key[:2] for key in counties}:
        raise ValueError('Every selected state requires county identities')
    return states, counties


def _exposure(exposure, scope, key):
    mapping = exposure.get(scope, {})
    if key not in mapping:
        raise ValueError(f'Missing GIS exposure record for {scope} {key}; reconstruct the requested geography')
    value = mapping[key]
    if value is None:
        return None  # Explicit unavailable coverage is not zero exposure.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f'GIS exposure must be null or a share in [0,1]: {scope} {key}')
    return value


def clean_policy_inputs(state_bps_path, county_bps_path, analytical_model_path,
                        geographies_path, exposure_path, output_path):
    """Write and return canonical inputs; also write <output stem>.report.json.

    ACS detached counts come solely from the generated evidence model. Missing
    county permits remain null; observed zero remains zero. Missing GIS keys
    fail explicitly, while a GIS record explicitly marked null stays unknown.
    No field from the geography file is used as a stock, permit, cost or exposure.
    """
    states_bps = parse_bps(state_bps_path)
    counties_bps = parse_bps(county_bps_path, county=True)
    model = _load(analytical_model_path)
    exposure = _load(exposure_path)
    state_ids, county_ids = _identities(_load(geographies_path))
    if not isinstance(exposure.get('reconstruction_version'), str) or not exposure['reconstruction_version']:
        raise ValueError('GIS exposure must identify its reconstruction_version')
    grouped = defaultdict(list)
    for fips in sorted(county_ids):
        grouped[fips[:2]].append(fips)
    states, counties, fallback_rows = [], [], []
    for state_fips in sorted(state_ids):
        if state_fips not in states_bps:
            raise ValueError('Missing official state permit anchor: ' + state_fips)
        abbr = STATE_ABBREVIATIONS[state_fips]
        official_state = states_bps[state_fips]
        group = grouped[state_fips]
        matched = [counties_bps[fips] for fips in group if fips in counties_bps]
        covered_units = sum(row['units'] for row in matched)
        covered_value = sum(row['valuation'] for row in matched)
        fallback = covered_value / covered_units if covered_units > 0 else None
        factor = round(official_state['units'] / covered_units, 12) if covered_units else 1 if official_state['units'] == 0 else None
        states.append({'state_fips': state_fips, 'state_abbr': abbr,
            'state_name': official_state['name'],
            'baseline_annual_units': official_state['units'],
            'baseline_5yr_units': 5 * official_state['units'],
            'tod_housing_share_new': _exposure(exposure, 'state', abbr),
            'reconciliation_factor': factor})
        fallback_rows.append({'state_fips': state_fips, 'state_abbr': abbr,
            'matched_county_units': covered_units, 'matched_county_valuation_dollars': covered_value,
            'county_weighted_cost_fallback': fallback,
            'official_state_valuation_dollars': official_state['valuation'],
            'official_state_cost_for_comparison_only': official_state['valuation'] / official_state['units'] if official_state['units'] else None,
            'unallocated_annual_units': official_state['units'] - covered_units,
            'coverage_factor': factor})
        for fips in group:
            record = model.get('county', {}).get(fips)
            if record is None:
                raise ValueError('Missing generated ACS evidence geography: ' + fips)
            detached = record.get('evidence', {}).get('stock', {}).get('detached')
            if isinstance(detached, bool) or not isinstance(detached, (int, float)) or not math.isfinite(detached) or detached < 0 or int(detached) != detached:
                raise ValueError('ACS detached housing count is unavailable or invalid: ' + fips)
            official = counties_bps.get(fips)
            units = official['units'] if official else None
            value = official['valuation'] if official else None
            average = value / units if units is not None and units > 0 else None
            name = record.get('name') or (official['name'] if official else county_ids[fips].get('county_name'))
            if not name:
                raise ValueError('Missing county identity name: ' + fips)
            counties.append({'fips': fips, 'state_abbr': abbr, 'state_fips': state_fips,
                'county_name': name, 'sf_detached_units': int(detached),
                'baseline_annual_units': units, 'baseline_5yr_units': None if units is None else units * 5,
                'permit_valuation_total': value, 'avg_permit_value_per_unit': average,
                'scenario_cost_base': average if average is not None and average > 0 else fallback,
                'tod_housing_share_new': _exposure(exposure, 'county', fips)})
    inputs = {'schema_version': '1.0', 'source': {
        'mode': 'official-source reconstruction', 'permit_source': 'Census BPS final annual 2025',
        'stock_source': 'Generated official ACS 2020–2024 B25024_002E evidence',
        'transit_reconstruction_version': exposure['reconstruction_version'],
        'notes': ['This is a newly versioned reconstruction, not recovery of the original spatial extraction.',
            'Detached housing units are a stock proxy, not observed eligible parcels or current single-family-only zoning.',
            'County cost fallbacks use matched county valuations and units; state valuations have a different rounding convention.',
            'Missing county permits and explicitly unavailable GIS exposure remain null.']},
        'states': states, 'counties': counties}
    report = {'schema_version': '1.0', 'states': len(states), 'counties': len(counties),
        'missing_county_bps': sum(row['baseline_annual_units'] is None for row in counties),
        'observed_zero_county_bps': sum(row['baseline_annual_units'] == 0 for row in counties),
        'county_cost_fallback_count': sum(row['avg_permit_value_per_unit'] is None or row['avg_permit_value_per_unit'] <= 0 for row in counties),
        'unavailable_county_exposure': sum(row['tod_housing_share_new'] is None for row in counties),
        'unavailable_state_exposure': sum(row['tod_housing_share_new'] is None for row in states),
        'state_cost_and_coverage': fallback_rows,
        'official_county_records_outside_selected_geographies': [fips for fips in sorted(counties_bps) if fips[:2] in state_ids and fips not in county_ids],
        'stored_policy_outputs_used_as_inputs': False,
        'cost_precision': 'Full floating-point ratios from integer official values. Prior serialized ratios can differ below one millionth of a dollar; compare with numerical tolerance, not copied values.',
        'inputs': {name: {'filename': Path(path).name, 'sha256': _hash(path)} for name, path in (
            ('state_bps', state_bps_path), ('county_bps', county_bps_path),
            ('analytical_model', analytical_model_path), ('geographies', geographies_path), ('exposure', exposure_path))}}
    output_path = Path(output_path)
    _write(output_path, inputs)
    _write(output_path.with_name(output_path.stem + '.report.json'), report)
    return inputs


def compare_policy_inputs(reconstructed, reference):
    """Audit an optional reference without feeding it into cleaning/calculation.

    Transit is deliberately excluded: a newly versioned GIS reconstruction is
    expected to differ from the unrecovered inherited exposure layer.
    """
    exact_fields = {'states': ('baseline_annual_units', 'baseline_5yr_units', 'reconciliation_factor'),
                    'counties': ('sf_detached_units', 'baseline_annual_units', 'baseline_5yr_units', 'permit_valuation_total')}
    ratio_fields = ('avg_permit_value_per_unit', 'scenario_cost_base')
    exact_mismatches, ratio_mismatches, largest_delta = [], [], 0.0
    compared = 0
    for scope, identity in (('states', 'state_abbr'), ('counties', 'fips')):
        old = {row[identity]: row for row in reference[scope]}
        new = {row[identity]: row for row in reconstructed[scope]}
        if set(old) != set(new):
            raise ValueError('Reference comparison requires the same geography identities')
        for key, row in new.items():
            for field in exact_fields[scope]:
                compared += 1
                if row[field] != old[key][field]:
                    exact_mismatches.append({'geography': key, 'field': field, 'rebuilt': row[field], 'reference': old[key][field]})
            if scope == 'counties':
                for field in ratio_fields:
                    actual, expected = row[field], old[key][field]
                    same = actual is None and expected is None
                    if actual is not None and expected is not None:
                        largest_delta = max(largest_delta, abs(actual - expected))
                        same = math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-6)
                    if not same:
                        ratio_mismatches.append({'geography': key, 'field': field, 'rebuilt': actual, 'reference': expected})
    return {'exact_field_cases': compared, 'exact_mismatches': exact_mismatches,
            'cost_ratio_mismatches_above_tolerance': ratio_mismatches,
            'maximum_cost_ratio_difference_dollars': largest_delta,
            'transit_comparison': 'Excluded: separately versioned spatial reconstruction.',
            'passed': not exact_mismatches and not ratio_mismatches}
