"""Clean official BPS annual county files and build observed-only chart assets.

The annual files preserve each year's geography. No historical county boundary
crosswalk is invented. County000 balances remain a separate report, never a
county assignment. Estimated units including imputation are kept separate from
the later reported-only blocks, which must not be added to estimated counts.
"""
from __future__ import annotations

from collections import defaultdict
import csv
import json
from pathlib import Path

from .acquisition import atomic_json, load_catalog, sha256

FIELDS = ('fips', 'state_fips', 'county_name', 'year', 'one_unit', 'two_units',
          'three_four_units', 'five_plus_units', 'total_permitted_units',
          'reported_only_units', 'source_file', 'estimated_minus_reported',
          'record_quality', 'permit_valuation_total', 'survey_date', 'duplicate_source_names')


def _integer(value):
    value = str(value).strip()
    if not value or value in ('NA', 'N', '-', '(X)'):
        return None
    try:
        result = int(value)
    except ValueError as exc:
        raise ValueError('Invalid BPS integer: ' + value) from exc
    if result < 0:
        raise ValueError('Negative BPS unit/value')
    return result


def parse_county_file(path, year, supported_states=None, outside_universe=None):
    """Return (county rows, county000 balance rows) from one annual file."""
    year = int(year)
    if not 1990 <= year <= 2025:
        raise ValueError('Unsupported annual county history year')
    path = Path(path)
    supported = set(supported_states or load_catalog()['states'])
    rows, unassigned, seen = [], [], {}
    # splitlines handles the CR-CR-LF line endings used by older annual files.
    records = csv.reader(path.read_text(encoding='utf-8-sig').splitlines())
    for fields in records:
        if not fields or not fields[0].strip().isdigit():
            continue
        if len(fields) < 30:
            raise ValueError(f'Malformed annual BPS record in {path.name}')
        state = fields[1].strip().zfill(2)
        county = fields[2].strip().zfill(3)
        if state not in supported:
            if outside_universe is not None:
                outside_universe.append({'year': year, 'source_file': path.name,
                    'raw_state_code': fields[1].strip(), 'raw_county_code': fields[2].strip(),
                    'name': fields[5].strip()})
            continue
        if not state.isdigit() or not county.isdigit() or len(county) != 3:
            raise ValueError('Invalid BPS county FIPS')
        fips = state + county
        units = [_integer(fields[i]) for i in (7, 10, 13, 16)]
        reported = [_integer(fields[i]) for i in (19, 22, 25, 28)]
        values = [_integer(fields[i]) for i in (8, 11, 14, 17)]
        total = sum(units) if all(x is not None for x in units) else None
        reported_total = sum(reported) if all(x is not None for x in reported) else None
        row = dict(zip(FIELDS, (fips, state, fields[5].strip(), year, *units,
                   total, reported_total, path.name,
                   total - reported_total if total is not None and reported_total is not None else None,
                   'parsed' if total is not None else 'source_missing',
                   sum(values) if all(x is not None for x in values) else None,
                   fields[0].strip(), '')))
        if fips in seen:
            original = seen[fips]
            numeric_fields = ('one_unit', 'two_units', 'three_four_units', 'five_plus_units',
                              'total_permitted_units', 'reported_only_units', 'permit_valuation_total')
            if any(original[k] != row[k] for k in numeric_fields):
                raise ValueError(f'Conflicting duplicate BPS county {fips} in {year}')
            # The official2014file repeats Anchorage under Borough/Municipality
            # names with identical observations. Keep one, report both names.
            original['record_quality'] = 'parsed_equal_numeric_duplicate'
            names = set(filter(None, original['duplicate_source_names'].split('; ')))
            names.update((original['county_name'], row['county_name']))
            original['duplicate_source_names'] = '; '.join(sorted(names))
            continue
        seen[fips] = row
        (unassigned if county == '000' else rows).append(row)
    if not rows:
        raise ValueError('No supported county records in ' + path.name)
    return sorted(rows, key=lambda r: r['fips']), sorted(unassigned, key=lambda r: r['fips'])


def clean_county_history(cache_dir, output_csv, years=range(1990, 2026)):
    cache_dir, output_csv = Path(cache_dir), Path(output_csv)
    years = list(years)
    all_rows, all_unassigned, sources, yearly = [], [], [], []
    outside_universe = []
    for year in years:
        path = cache_dir / f'co{year}a.txt'
        rows, unassigned = parse_county_file(path, year, outside_universe=outside_universe)
        all_rows.extend(rows)
        all_unassigned.extend(unassigned)
        sources.append({'year': year, 'file': path.name, 'sha256': sha256(path),
                        'bytes': path.stat().st_size,
                        'url': f'https://www2.census.gov/econ/bps/County/co{year}a.txt'})
        yearly.append({'year': year, 'county_rows': len(rows),
                       'county_assigned_units': sum(r['total_permitted_units'] or 0 for r in rows),
                       'county000_unassigned_units': sum(r['total_permitted_units'] or 0 for r in unassigned),
                       'missing_unit_records': sum(r['total_permitted_units'] is None for r in rows)})
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    part = output_csv.with_name(output_csv.name + '.part')
    with part.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(all_rows)
    part.replace(output_csv)
    report = {'schema_version': 'turnout.county-history.v1', 'rows': len(all_rows),
              'years': list(years), 'source_files': sources, 'yearly': yearly,
              'output_sha256': sha256(output_csv), 'unassigned_records': all_unassigned,
              'equal_numeric_duplicate_records': [{'fips': r['fips'], 'year': r['year'], 'names': r['duplicate_source_names']}
                  for r in all_rows if r['duplicate_source_names']],
              'source_records_outside_state_universe': outside_universe,
              'geography_note': 'Each annual source geography is retained. No retrospective boundary harmonization. Missing is not zero.',
              'coverage_note': 'County000 balances are recorded separately; never assigned to a named county.',
              'valuation_unit': 'County annual values are dollars; state annual value columns use thousands of dollars.'}
    atomic_json(output_csv.with_suffix('.manifest.json'), report)
    return report


def _csv_rows(path):
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        yield from csv.DictReader(stream)


def write_browser_history(history_csv, output_dir, current_fips=None):
    """Write the final chart's only needed observations; no future arrays."""
    history_csv, output_dir = Path(history_csv), Path(output_dir)
    mapping = load_catalog()['states']
    allowed = set(current_fips) if current_fips is not None else None
    counties = defaultdict(dict)
    totals = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0, 0]))
    seen = set()
    missing = []
    for row in _csv_rows(history_csv):
        fips, year = row['fips'], int(row['year'])
        if fips[-3:] == '000' or fips[:2] not in mapping or (allowed is not None and fips not in allowed):
            continue
        if (fips, year) in seen:
            raise ValueError('Duplicate county/year chart observation')
        seen.add((fips, year))
        names = ('one_unit', 'two_units', 'three_four_units', 'five_plus_units', 'total_permitted_units')
        vals = [int(row[k]) if row.get(k, '').strip() else None for k in names]
        if any(v is None for v in vals):
            missing.append({'fips': fips, 'year': year})
            continue
        if sum(vals[:4]) != vals[4]:
            raise ValueError('County chart structure total mismatch')
        abbr = mapping[fips[:2]]
        entry = counties[abbr].setdefault(fips, {'history': []})
        entry['history'].append([year, *vals])
        for scope in (abbr, 'US'):
            totals[scope][year] = [x + y for x, y in zip(totals[scope][year], vals)]
    output_dir.mkdir(parents=True, exist_ok=True)
    for abbr, rows in sorted(counties.items()):
        for county in rows.values():
            county['history'].sort()
        payload = {'state': abbr, 'counties': dict(sorted(rows.items()))}
        (output_dir / (abbr + '.js')).write_text('window.TURNOUT_HISTORY_STATE=' + json.dumps(payload, separators=(',', ':')) + ';\n', encoding='utf-8')
    aggregates = {scope: {'history': [[year, *vals] for year, vals in sorted(years.items())]}
                  for scope, years in sorted(totals.items())}
    (output_dir / 'AGGREGATES.js').write_text('window.TURNOUT_HISTORY_AGGREGATES=' + json.dumps(aggregates, separators=(',', ':')) + ';\n', encoding='utf-8')
    return {'state_files': len(counties), 'county_year_records': len(seen), 'missing_skipped': missing,
            'aggregate_keys': sorted(aggregates), 'current_fips_filter': allowed is not None,
            'only_observations': True}
