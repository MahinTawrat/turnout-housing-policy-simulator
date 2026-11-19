"""Acquire declared public inputs into a verified, excluded local cache.

No API key or non-standard dependency is required. Frozen hashes are checked by
default. --refresh explicitly permits upstream revisions and retains the prior
bytes under _versions; the manifest records the new hashes and retrieval dates.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / 'config/sources.json'
USER_AGENT = 'TheTurnoutHousingSimulator/1.0 (public research; reproducible acquisition)'
FIXED_GUIDEWAY_MODES = ('0', '1', '2', '5', '6', '7', '12')


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + '.part')
    part.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    part.replace(path)


def load_catalog(path=CATALOG_PATH):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def normalize_states(states=None, catalog=None):
    catalog = catalog or load_catalog()
    mapping = catalog['states']
    if not states:
        return sorted(mapping)
    reverse = {abbr: fips for fips, abbr in mapping.items()}
    result = []
    for value in states:
        value = str(value).upper()
        fips = value.zfill(2) if value.isdigit() else reverse.get(value)
        if fips not in mapping:
            raise ValueError('Unsupported state: ' + value)
        if fips not in result:
            result.append(fips)
    return sorted(result)


def source_specs(groups=('core',), states=None, years=range(1990, 2026), catalog=None):
    catalog = catalog or load_catalog()
    groups = set(groups)
    if 'all' in groups:
        groups = {'core', 'history', 'spatial'}
    unknown = groups - {'core', 'history', 'spatial'}
    if unknown:
        raise ValueError('Unknown source group: ' + ', '.join(sorted(unknown)))
    specs = {x['id']: dict(x) for x in catalog['sources'] if groups.intersection(x['groups'])}
    if 'history' in groups:
        for year in years:
            if not 1990 <= int(year) <= 2025:
                raise ValueError('County history supports 1990–2025 only')
            specs.setdefault(f'bps_county_{year}', {
                'id': f'bps_county_{year}', 'filename': f'co{year}a.txt',
                'url': f'https://www2.census.gov/econ/bps/County/co{year}a.txt',
                'format': 'bps', 'vintage': f'Final annual {year}; current revised file',
                'source_page': 'https://www.census.gov/construction/bps/annual.html',
                'license': 'Public U.S. Census Bureau statistics; attribution retained',
                'groups': ['history'],
            })
    if 'spatial' in groups:
        for fips in normalize_states(states, catalog):
            specs['tracts_' + fips] = {
                'id': 'tracts_' + fips, 'filename': f'spatial/tracts/tl_2024_{fips}_tract.zip',
                'url': f'https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_{fips}_tract.zip',
                'format': 'shapefile_zip', 'vintage': 'Census TIGER/Line 2024',
                'source_page': 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
                'license': 'Public U.S. Census Bureau geography; attribution retained',
                'groups': ['spatial'],
            }
    # co2025a belongs to core and history; retain one deterministic specification.
    by_file = {}
    for spec in sorted(specs.values(), key=lambda x: x['id']):
        by_file.setdefault(spec['filename'], spec)
    return list(by_file.values())


def validate_file(path, format_name):
    path = Path(path)
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError('Empty source file: ' + str(path))
    with path.open('rb') as stream:
        prefix = stream.read(8192)
    if format_name in ('xlsx', 'chas_zip', 'shapefile_zip'):
        if not prefix.startswith(b'PK') or not zipfile.is_zipfile(path):
            raise ValueError('Expected a ZIP-based source: ' + path.name)
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if format_name == 'xlsx' and 'xl/workbook.xml' not in names:
                raise ValueError('XLSX workbook part missing')
            if format_name == 'chas_zip' and not {'050/Table1.csv', '050/Table2.csv'}.issubset(names):
                raise ValueError('HUD county Tables 1 and 2 missing')
            if format_name == 'shapefile_zip' and not all(any(n.lower().endswith(ext) for n in names) for ext in ('.shp', '.dbf', '.prj')):
                raise ValueError('Shapefile geometry, attributes or CRS missing')
    elif format_name == 'acs':
        if b'GEO_ID|' not in prefix or b'_E001' not in prefix:
            raise ValueError('ACS table header missing')
    elif format_name == 'population':
        if b'SUMLEV' not in prefix or b'POPESTIMATE2025' not in prefix:
            raise ValueError('Population component header missing')
    elif format_name == 'bps':
        if b'FIPS' not in prefix or b'Units' not in prefix or b'Survey' not in prefix:
            raise ValueError('BPS annual-file header missing')
    elif format_name == 'html':
        if b'<html' not in prefix.lower() and b'<!doctype' not in prefix.lower():
            raise ValueError('Expected official HTML table page')
    elif format_name == 'json':
        value = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(value, dict) and 'error' in value:
            raise ValueError('Source API returned an error')
    else:
        raise ValueError('Unknown source format: ' + format_name)


def _request(url, *, timeout=180, allow_http=False):
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme != 'https' and not (allow_http and scheme == 'http'):
        raise ValueError('Source downloads require HTTPS')
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    return urllib.request.urlopen(request, timeout=timeout)


def download(spec, cache_dir, *, refresh=False, seed_dirs=(), previous=None, allow_http=False):
    cache_dir = Path(cache_dir).resolve()
    dest = (cache_dir / spec['filename']).resolve()
    if not dest.is_relative_to(cache_dir):
        raise ValueError('Source filename escapes the cache directory')
    dest.parent.mkdir(parents=True, exist_ok=True)
    previous = previous or {}
    retained = dest.exists() and not refresh
    method = 'cache' if retained else 'downloaded'
    response_metadata = {}
    candidate = dest
    part = dest.with_name(dest.name + '.part')
    if not retained:
        candidate = part
        try:
            seed = None if refresh else next((Path(directory) / Path(spec['filename']).name for directory in seed_dirs
                    if (Path(directory) / Path(spec['filename']).name).is_file()), None)
            if seed:
                shutil.copyfile(seed, part)
                method = 'seeded_existing_official_cache'
            else:
                for attempt in range(3):
                    try:
                        with _request(spec['url'], allow_http=allow_http) as response, part.open('wb') as stream:
                            response_metadata = {'final_url': response.url,
                                'last_modified': response.headers.get('Last-Modified'),
                                'etag': response.headers.get('ETag'),
                                'content_type': response.headers.get('Content-Type')}
                            shutil.copyfileobj(response, stream, 1024 * 1024)
                            content_length = response.headers.get('Content-Length')
                            if content_length and stream.tell() != int(content_length):
                                raise ValueError('Incomplete official source response: ' + spec['id'])
                        break
                    except (urllib.error.URLError, TimeoutError, OSError):
                        if attempt == 2:
                            raise
                        time.sleep(0.5 * (attempt + 1))
            validate_file(candidate, spec['format'])
            actual = sha256(candidate)
            expected = spec.get('snapshot_sha256')
            if expected and actual != expected and not refresh:
                raise ValueError(f"Snapshot hash changed for {spec['id']}; inspect the source and use --refresh to record a new version")
            if dest.exists():
                old_hash = sha256(dest)
                if old_hash != actual:
                    version = cache_dir / '_versions' / spec['id'] / old_hash / dest.name
                    version.parent.mkdir(parents=True, exist_ok=True)
                    if not version.exists():
                        shutil.copyfile(dest, version)
            part.replace(dest)
        except Exception:
            if part.exists():
                part.unlink()
            raise
    validate_file(dest, spec['format'])
    actual = sha256(dest)
    if retained:
        expected = previous.get('sha256') or spec.get('snapshot_sha256')
        if expected and actual != expected:
            raise ValueError(f"Cached source hash changed: {spec['id']}; the cache was modified or corrupted")
    return {'id': spec['id'], 'url': spec['url'], 'path': spec['filename'],
            'bytes': dest.stat().st_size, 'sha256': actual,
            'retrieved_utc': previous.get('retrieved_utc', utc_now()) if retained else utc_now(),
            'checked_utc': utc_now(), 'acquisition': method,
            'vintage': spec['vintage'], 'source_page': spec.get('source_page'),
            'license': spec.get('license'), 'snapshot_match': actual == spec.get('snapshot_sha256') if spec.get('snapshot_sha256') else None,
            **({k: previous[k] for k in ('final_url', 'last_modified', 'etag', 'content_type') if k in previous} if retained else response_metadata)}


def _json_url(url):
    with _request(url, timeout=120) as response:
        value = json.load(response)
    if isinstance(value, dict) and 'error' in value:
        raise ValueError('Official ArcGIS API error: ' + json.dumps(value['error']))
    return value


def fixed_guideway_where(modes=FIXED_GUIDEWAY_MODES):
    clauses = []
    for mode in modes:
        if not str(mode).isdigit():
            raise ValueError('GTFS mode must be numeric')
        clauses.extend([f"stop_type = '{mode}'", f"stop_type LIKE '{mode};%'",
                        f"stop_type LIKE '%;{mode};%'", f"stop_type LIKE '%;{mode}'"])
    return '(' + ' OR '.join(clauses) + ')'


def acquire_ntm_stops(cache_dir, *, refresh=False, previous=None, catalog=None):
    """Retrieve every selected official stop by object ID, never a truncated page."""
    catalog = catalog or load_catalog()
    spec = catalog['transit']
    cache_dir = Path(cache_dir)
    dest = cache_dir / 'spatial/ntm_fixed_guideway_stops.geojson'
    meta_dest = cache_dir / 'spatial/ntm_metadata.json'
    if dest.exists() and meta_dest.exists() and not refresh:
        validate_file(dest, 'json')
        actual = sha256(dest)
        if previous and actual != previous.get('sha256'):
            raise ValueError('Cached transit stop snapshot hash changed')
        meta = json.loads(meta_dest.read_text(encoding='utf-8'))
        if actual != meta['acquisition']['sha256']:
            raise ValueError('Cached transit data differs from its retained source metadata hash')
        return {**meta['acquisition'], 'sha256': actual, 'bytes': dest.stat().st_size,
                'acquisition': 'cache', 'checked_utc': utc_now()}
    item_url = f"https://www.arcgis.com/sharing/rest/content/items/{spec['item_id']}?f=json"
    before = _json_url(item_url)
    if before.get('owner') != 'USDOT_BTS' or before.get('url') != spec['service_url']:
        raise ValueError('BTS item owner/service differs from the reviewed official source')
    layer = _json_url(spec['service_url'] + '/0?f=json')
    if not {'OBJECTID', 'stop_type'}.issubset({f['name'] for f in layer['fields']}):
        raise ValueError('BTS stop schema changed')
    where = fixed_guideway_where(spec['mode_codes'])
    base = spec['service_url'] + '/0/query?'
    ids_url = base + urllib.parse.urlencode({'where': where, 'returnIdsOnly': 'true', 'f': 'json'})
    ids = sorted(_json_url(ids_url)['objectIds'] or [])
    if not ids:
        raise ValueError('Official fixed-guideway stop query unexpectedly returned no records')
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate official transit object IDs')
    features = []
    page_urls = []
    # Keep object-ID query URLs below common proxy length limits as well as the
    # service's record limit. Every returned batch is checked for exact coverage.
    page_size = min(int(layer.get('maxRecordCount', 100)), 100)

    def fetch_page(batch):
        params = {'objectIds': ','.join(map(str, batch)), 'outFields': '*',
                  'returnGeometry': 'true', 'outSR': '4326', 'f': 'geojson'}
        url = base + urllib.parse.urlencode(params)
        page = _json_url(url)
        seen = {int(f['properties']['OBJECTID']) for f in page['features']}
        if seen != set(batch) or len(page['features']) != len(batch):
            raise ValueError('Incomplete official transit page; refusing a partial exposure input')
        return page['features'], {'first_id': batch[0], 'last_id': batch[-1], 'count': len(batch)}

    batches = [ids[start:start + page_size] for start in range(0, len(ids), page_size)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        for page_features, page_record in executor.map(fetch_page, batches):
            features.extend(page_features)
            # Compact reproducibility record; complete IDs are retained below.
            page_urls.append(page_record)
    after = _json_url(item_url)
    if before['modified'] != after['modified']:
        raise ValueError('BTS dataset changed during download; retry to obtain one consistent snapshot')
    features.sort(key=lambda f: int(f['properties']['OBJECTID']))
    collection = {'type': 'FeatureCollection', 'features': features,
                  'turnout_source': {'item_id': spec['item_id'], 'item_modified': before['modified'],
                    'mode_codes': spec['mode_codes'], 'where': where, 'object_ids': ids}}
    if dest.exists():
        old_hash = sha256(dest)
        old = cache_dir / '_versions/bts_ntm' / old_hash / dest.name
        old.parent.mkdir(parents=True, exist_ok=True)
        if not old.exists():
            shutil.copyfile(dest, old)
    atomic_json(dest, collection)
    record = {'id': 'bts_ntm_fixed_guideway_stops', 'url': spec['service_url'],
              'source_page': spec['source_page'], 'path': dest.relative_to(cache_dir).as_posix(),
              'sha256': sha256(dest), 'bytes': dest.stat().st_size, 'retrieved_utc': utc_now(),
              'checked_utc': utc_now(), 'acquisition': 'downloaded', 'feature_count': len(features),
              'vintage': before.get('description', ''), 'license': before.get('licenseInfo'),
              'mode_codes': spec['mode_codes'], 'query': where, 'snapshot_match': None}
    atomic_json(meta_dest, {'item': before, 'layer': layer, 'pages': page_urls, 'acquisition': record})
    return record


def acquire(cache_dir, refresh=False, groups=('core',), states=None, seed_dirs=(),
            years=range(1990, 2026), max_workers=4):
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / 'acquisition_manifest.json'
    prior = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    records = {r['id']: r for r in prior.get('sources', [])}
    specs = source_specs(groups, states, years)
    failures = []

    def save():
        value = {'schema_version': 'turnout.acquisition.v1', 'updated_utc': utc_now(),
                 'source_catalog_version': load_catalog()['version'], 'refresh_requested': refresh,
                 'sources': sorted(records.values(), key=lambda x: x['id']), 'failures': failures}
        atomic_json(path, value)
        return value

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(download, s, cache_dir, refresh=refresh, seed_dirs=seed_dirs,
                                   previous=records.get(s['id'])): s for s in specs}
        for future in as_completed(futures):
            spec = futures[future]
            try:
                record = future.result()
                records[record['id']] = record
            except Exception as exc:
                failures.append({'id': spec['id'], 'error': str(exc)})
            save()
    if set(groups).intersection({'all', 'spatial'}) and not failures:
        try:
            record = acquire_ntm_stops(cache_dir, refresh=refresh, previous=records.get('bts_ntm_fixed_guideway_stops'))
            records[record['id']] = record
        except Exception as exc:
            failures.append({'id': 'bts_ntm_fixed_guideway_stops', 'error': str(exc)})
    result = save()
    if failures:
        raise RuntimeError('Source acquisition failed; successful inputs and errors were recorded: ' + json.dumps(failures))
    return result
