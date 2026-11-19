"""Versioned official-source transit reconstruction and display boundaries.

This is a NEW, documented reconstruction. The original spatial archive/vintage
was not recovered. It writes a separate version and delta report, and never
silently replaces the approved frozen policy inputs.

Housing is assumed uniformly distributed across each TIGER tract polygon. The
union of geodesic half-mile stop buffers determines the covered polygon share;
the share weights ACS2020–2024 B25024_001E housing units. This is an area proxy,
including the tract's water geometry, not verified eligible sites or walking
access. The fixed-guideway screen excludes ferries and bus-frequency screens.
"""
from __future__ import annotations

from collections import defaultdict
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import time
from types import SimpleNamespace
import zipfile

from .acquisition import (ROOT, FIXED_GUIDEWAY_MODES, atomic_json, load_catalog,
                          normalize_states, sha256)

METHOD = {
    'method_version': 'turnout.fixed-guideway-area.v3',
    'buffer_metres': 804.672, 'buffer_vertices': 96,
    'stop_mode_codes': list(FIXED_GUIDEWAY_MODES),
    'stop_screen': 'Any semicolon-delimited GTFS stop_type token in0,1,2,5,6,7,12. Ferries,buses,trolleybuses excluded. All stops serving a selected mode retained; overlapping buffers unioned.',
    'housing_weight': 'ACS2020–2024 B25024_001E tract housing units',
    'geometry': 'Census TIGER/Line 2024 tracts. PRJ must declare unprojected NAD83 or WGS84 degrees. NAD83 geographic coordinates are treated as WGS84; metre-level datum offsets are not corrected.',
    'area_crs': 'Explicit spherical Lambert azimuthal equal-area, centred on each state; WGS84 authalic sphere radius 6371007.180918475 m. GeographicLib WGS84 geodesic 804.672 m buffers projected before intersection. Spherical areas approximate ellipsoidal areas.',
    'fraction': 'Area(tract polygon intersect union(stop buffers))/Area(tract polygon), clipped to[0,1]',
    'polygon_engine': 'PyClipper 1.4.0 / Clipper 6.4.2. Projected metre coordinates quantized to 1 mm integer precision. Even-odd tract fill preserves holes; consistently oriented circular buffers use nonzero fill, so overlap is union rather than XOR. Source self-crossings use the same explicit even-odd rule.',
    'candidate_index': 'Pure Python geographic bounding-box grid; exact projected polygon clipping determines the covered share.',
    'projection_centre_rule': 'Circular mean longitude and arithmetic mean latitude of the first valid ring point in each state tract. This selects a local numerical coordinate frame; it does not replace any tract geometry.',
    'projection_reference': 'https://pubs.usgs.gov/pp/1395/report.pdf (spherical Lambert azimuthal equal-area equations)',
    'distribution_assumption': 'Housing uniformly distributed across the full tract polygon, including water geometry. Land-only residential locations unavailable.',
    'aggregation': 'Sum(fraction*tracthousing)/sum(tracthousing) separately at county and state. Missing ACS tract values make that county/state share unavailable.',
    'interpretation': 'Proximity exposure proxy only; no current service frequency, walking access, eligible parcel, zoning or causal response is inferred.',
    'frozen_policy_outputs': 'Never overwritten; compare reconstruction to frozen inputs and release a new version explicitly.',
}

DISPLAY_METHOD = {
    'method_version': 'turnout.display-cartographic20m.v1',
    'source_vintage': 'Census 2024 cartographic boundaries, 1:20,000,000',
    'algorithm': 'Official Census generalized display polygons; no additional polygon simplification',
    'tolerance_degrees': None,
    'topology': 'All supported source features and polygon rings retained.',
    'orientation': 'RFC7946 CCW exterior / CW holes; GeographicLib geodesic sign at the antimeridian',
    'scope': 'Display only. Analytical TIGER/Line tract polygons, stop buffers and exposure calculations are unchanged.',
}


def _gis():
    # A local optional installation can be used without changing system Python.
    tooling = ROOT / 'data/tooling/python'
    if tooling.is_dir() and str(tooling) not in sys.path:
        sys.path.insert(0, str(tooling))
    try:
        import shapefile
        import geographiclib
        from geographiclib.geodesic import Geodesic
        import pyclipper
    except ImportError as exc:
        raise RuntimeError('Spatial rebuilding needs the optional pinned packages: python -m pip install -r requirements-spatial.txt') from exc
    return {'shapefile': shapefile, 'geographiclib': geographiclib,
            'Geodesic': Geodesic, 'pyclipper': pyclipper, 'Polygon': Polygon}


class Polygon:
    """Small ring container; clipping/fill semantics are explicit below."""
    def __init__(self, exterior=(), holes=()):
        self.rings = [list(exterior)] + [list(hole) for hole in holes] if exterior else []
        self._source_shape = None
        self._bounds = None

    @classmethod
    def from_shape(cls, shape):
        value = cls()
        parts = list(shape.parts) + [len(shape.points)]
        value.rings = [shape.points[parts[i]:parts[i + 1]] for i in range(len(parts) - 1)]
        value._source_shape = shape
        value._bounds = tuple(shape.bbox)
        return value

    @property
    def is_empty(self):
        return not any(len(ring) >= 3 for ring in self.rings)

    @property
    def bounds(self):
        if self._bounds is None:
            points = [point for ring in self.rings for point in ring]
            self._bounds = ((min(p[0] for p in points), min(p[1] for p in points),
                             max(p[0] for p in points), max(p[1] for p in points))
                            if points else (0, 0, 0, 0))
        return self._bounds

    def representative_point(self):
        # Only the projection centre is chosen here; source polygons and areas
        # are never replaced by this point. Circular state averaging follows.
        point = next((ring[0] for ring in self.rings if ring), (0, 0))
        return SimpleNamespace(x=point[0], y=point[1])

    def projected(self, project):
        value = Polygon()
        for ring in self.rings:
            if ring:
                xs, ys = project([p[0] for p in ring], [p[1] for p in ring])
                value.rings.append(list(zip(xs, ys)))
        return value

    def geojson(self):
        if self._source_shape is not None:
            return self._source_shape.__geo_interface__
        return {'type': 'Polygon', 'coordinates': self.rings}


class BoundingBoxGrid:
    """Candidate-only index. Bounding boxes can overselect but never clip data."""
    def __init__(self, geometries, cell_degrees=.25):
        self.boxes = [g.bounds for g in geometries]
        self.cell = cell_degrees
        self.cells = defaultdict(set)
        for index, bounds in enumerate(self.boxes):
            for key in self._keys(bounds):
                self.cells[key].add(index)

    def _keys(self, bounds):
        west, south, east, north = (math.floor(v / self.cell) for v in bounds)
        for x in range(west, east + 1):
            for y in range(south, north + 1):
                yield x, y

    def query(self, geometry):
        bounds = geometry.bounds
        west, south, east, north = (math.floor(v / self.cell) for v in bounds)
        if (east - west + 1) * (north - south + 1) > 4096:
            candidates = range(len(self.boxes))
        else:
            candidates = set()
            for key in self._keys(bounds):
                candidates.update(self.cells.get(key, ()))
        x1, y1, x2, y2 = bounds
        return sorted(i for i in candidates if not (self.boxes[i][2] < x1 or self.boxes[i][0] > x2 or
                                                   self.boxes[i][3] < y1 or self.boxes[i][1] > y2))


def _integer_paths(geometry, scale=1000):
    paths = []
    for ring in geometry.rings:
        path = []
        for x, y, *_ in ring:
            point = (round(x * scale), round(y * scale))
            if not path or point != path[-1]:
                path.append(point)
        if len(path) > 1 and path[0] == path[-1]:
            path.pop()
        if (len(set(path)) >= 3 and any((x - path[0][0]) * (path[1][1] - path[0][1]) !=
                (y - path[0][1]) * (path[1][0] - path[0][0]) for x, y in path[2:])):
            paths.append(path)
    return paths


def _tree_area(tree, clipper):
    area = (-1 if tree.IsHole else 1) * abs(clipper.Area(tree.Contour)) if tree.Contour else 0
    return area + sum(_tree_area(child, clipper) for child in tree.Childs)


def _filled_area(paths, clipper):
    if not paths:
        return 0.0
    engine = clipper.Pyclipper()
    if not engine.AddPaths(paths, clipper.PT_SUBJECT, True):
        return 0.0
    tree = engine.Execute2(clipper.CT_UNION, clipper.PFT_EVENODD, clipper.PFT_EVENODD)
    return _tree_area(tree, clipper)


def qualifying_stop(properties, modes=FIXED_GUIDEWAY_MODES):
    return bool(set(str(properties.get('stop_type', '')).split(';')).intersection(map(str, modes)))


def geodesic_buffer(longitude, latitude, radius=804.672, vertices=96, gis=None):
    gis = gis or _gis()
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError('Invalid stop coordinates')
    if radius <= 0 or vertices < 16:
        raise ValueError('Invalid geodesic buffer settings')
    geod = gis['Geodesic'].WGS84
    ring = []
    for i in range(vertices):
        point = geod.Direct(latitude, longitude, i * 360 / vertices, radius,
                            outmask=gis['Geodesic'].LATITUDE | gis['Geodesic'].LONGITUDE)
        ring.append((point['lon2'], point['lat2']))
    ring.append(ring[0])
    return Polygon(ring)


def covered_fraction(tract, buffers, gis=None):
    """Union before intersecting, so adjacent stops never count the same area twice."""
    gis = gis or _gis()
    if tract.is_empty:
        return None
    clipper = gis['pyclipper']
    subject = _integer_paths(tract)
    denominator = _filled_area(subject, clipper)
    if denominator <= 0:
        return None
    if not buffers:
        return 0.0
    clips = []
    for buffer in buffers:
        for path in _integer_paths(buffer):
            # Every circular buffer has the same winding. Nonzero clip fill
            # unions overlapping stops; even-odd clip fill would XOR overlaps.
            if not clipper.Orientation(path):
                path.reverse()
            clips.append(path)
    if not clips:
        return 0.0
    engine = clipper.Pyclipper()
    engine.AddPaths(subject, clipper.PT_SUBJECT, True)
    engine.AddPaths(clips, clipper.PT_CLIP, True)
    result = engine.Execute2(clipper.CT_INTERSECTION, clipper.PFT_EVENODD, clipper.PFT_NONZERO)
    return max(0.0, min(1.0, _tree_area(result, clipper) / denominator))


def _zip_shapes(path, gis):
    """Yield attributes and geographic-degree rings without archive extraction."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        shp = next(n for n in names if n.lower().endswith('.shp'))
        stem = shp[:-4]
        dbf = next(n for n in names if n.lower() == (stem + '.dbf').lower())
        prj = next(n for n in names if n.lower() == (stem + '.prj').lower())
        shx = next((n for n in names if n.lower() == (stem + '.shx').lower()), None)
        kwargs = {'shp': io.BytesIO(archive.read(shp)), 'dbf': io.BytesIO(archive.read(dbf)), 'encoding': 'utf-8'}
        if shx:
            kwargs['shx'] = io.BytesIO(archive.read(shx))
        reader = gis['shapefile'].Reader(**kwargs)
        wkt = archive.read(prj).decode('utf-8').upper()
        if ('PROJCS[' in wkt or 'PROJCRS[' in wkt or
                not any(name in wkt for name in ('NORTH_AMERICAN_1983', 'NAD83', 'WGS_1984', 'WGS 84')) or
                'DEGREE' not in wkt):
            raise ValueError('Only official NAD83/WGS84 geographic-degree shapefiles are supported; CRS changed')
        try:
            for record in reader.iterShapeRecords():
                props = record.record.as_dict()
                geometry = Polygon.from_shape(record.shape)
                yield props, geometry
        finally:
            reader.close()


def spherical_laea(longitude0, latitude0, radius=6371007.180918475):
    """Snyder's spherical LAEA equations, with an explicit authalic radius.

    Preserves area on the sphere, rather than claiming ellipsoidal exactness.
    Supports scalar and iterable coordinates without a projection dependency.
    """
    lon0, lat0 = math.radians(longitude0), math.radians(latitude0)
    s0, c0 = math.sin(lat0), math.cos(lat0)

    def scalar(longitude, latitude):
        delta = (math.radians(longitude) - lon0 + math.pi) % (2 * math.pi) - math.pi
        lat = math.radians(latitude)
        s, c = math.sin(lat), math.cos(lat)
        denominator = 1 + s0 * s + c0 * c * math.cos(delta)
        if denominator <= 1e-12:
            raise ValueError('LAEA projection undefined at the opposite hemisphere')
        k = math.sqrt(2 / denominator)
        return radius * k * c * math.sin(delta), radius * k * (c0 * s - s0 * c * math.cos(delta))

    def project(x, y, z=None):
        if hasattr(x, '__iter__'):
            coordinates = [scalar(lon, lat) for lon, lat in zip(x, y)]
            xs, ys = zip(*coordinates) if coordinates else ((), ())
            return (xs, ys) if z is None else (xs, ys, z)
        px, py = scalar(x, y)
        return (px, py) if z is None else (px, py, z)

    return project


def load_tract_housing(path, states=None):
    """Read tract total housing; retain zero and treat ACS negative sentinels as missing."""
    states = set(states) if states else None
    output = {}
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, delimiter='|')
        if not {'GEO_ID', 'B25024_E001'}.issubset(reader.fieldnames or []):
            raise ValueError('ACS tract housing table header missing')
        for row in reader:
            if not row['GEO_ID'].startswith('1400000US'):
                continue
            geoid = row['GEO_ID'].split('US', 1)[1]
            if len(geoid) != 11 or (states is not None and geoid[:2] not in states):
                continue
            if geoid in output:
                raise ValueError('Duplicate ACS tract geography: ' + geoid)
            value = row['B25024_E001'].strip()
            try:
                number = int(value)
            except ValueError:
                number = None
            output[geoid] = number if number is not None and number >= 0 else None
    if not output:
        raise ValueError('No ACS tract housing records for the requested states')
    return output


def load_area_housing(path):
    output = {'county': {}, 'state': {}}
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream, delimiter='|'):
            geoid = row['GEO_ID']
            scope = 'county' if geoid.startswith('0500000US') else 'state' if geoid.startswith('0400000US') else None
            if scope:
                value = int(row['B25024_E001'])
                output[scope][geoid.split('US', 1)[1]] = value if value >= 0 else None
    return output


def missing_exposure_provenance(cache_dir, counties, states):
    """Explain actual suppressed estimates without zero fill or older-vintage substitution."""
    from .baseline import xlsx_sheets
    source = Path(cache_dir) / 'spatial/Errata148_Suppressed_Geographies_for_Wyandanch.xlsx'
    if not source.is_file():
        raise ValueError('Official ACS Errata148 reference is missing; run acquisition for the spatial group')
    affected = set()
    for name, rows in xlsx_sheets(source):
        if '2020-2024' not in name:
            continue
        for row in rows:
            for value in row.values():
                text = str(value)
                if text.startswith('1400000US') and len(text) == 20:
                    affected.add(text.split('US', 1)[1])
    if not affected:
        raise ValueError('Official ACS suppression workbook schema changed')
    areas = load_area_housing(Path(cache_dir) / 'acsdt5y2024-b25024.dat')
    missing = []
    for scope, records in (('county', counties), ('state', states)):
        for fips, row in sorted(records.items()):
            if not row['missing_tracts']:
                continue
            official_total = areas[scope].get(fips)
            missing.append({'geography': scope, 'fips': fips,
                'missing_tract_ids': sorted(row['missing_tracts']),
                'all_listed_in_errata148': set(row['missing_tracts']).issubset(affected),
                'official_acs_area_housing_total': official_total,
                'sum_available_tract_housing_estimates': row['total_housing_units'],
                'area_total_minus_available_tract_sum': official_total - row['total_housing_units'] if official_total is not None else None,
                'point_exposure': None,
                'treatment': 'Unavailable point. Suppressed estimates are not zero and are not replaced with a different vintage.'})
    return {'source_url': 'https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html',
            'workbook_url': 'https://www.census.gov/content/dam/Census/programs-surveys/acs/tech-doc/errata/Errata148_Suppressed_Geographies_for_Wyandanch.xlsx',
            'workbook_sha256': sha256(source), 'affected_2020_2024_tract_ids': sorted(affected),
            'reason': 'Census identified a 2020 collection error and suppressed 2019–2023 and 2020–2024 ACS estimates for Wyandanch/Brentwood and nested geographies.',
            'missing_exposure_records': missing,
            'gap_interpretation': 'An arithmetic difference between a published area estimate and available tract estimates; not a separately observed missing-tract count or uncertainty interval.'}


def aggregate_exposure(tract_rows):
    """Aggregate a tract table, propagating unknown housing or invalid geometry."""
    counties = {}
    states = {}
    for row in tract_rows:
        fips = row['geoid'][:5]
        for scope, key in ((counties, fips), (states, fips[:2])):
            item = scope.setdefault(key, {'total_housing_units': 0, 'exposed_housing_units': 0.0,
                                         'tract_count': 0, 'missing_tracts': []})
            item['tract_count'] += 1
            housing, fraction = row['housing'], row['fraction']
            if housing is None or fraction is None:
                item['missing_tracts'].append(row['geoid'])
                continue
            if housing < 0 or not 0 <= fraction <= 1:
                raise ValueError('Invalid housing/fraction in exposure aggregation')
            item['total_housing_units'] += housing
            item['exposed_housing_units'] += housing * fraction
    for records in (counties, states):
        for item in records.values():
            item['tod_housing_share_new'] = (item['exposed_housing_units'] / item['total_housing_units']
                    if not item['missing_tracts'] and item['total_housing_units'] > 0 else None)
    return counties, states


def _round_coordinates(value):
    if isinstance(value, (list, tuple)):
        return [_round_coordinates(x) for x in value]
    return round(float(value), 6)


def _write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + '.part')
    part.write_text(text, encoding='utf-8')
    part.replace(path)


def ring_signed_area(ring, gis=None):
    """Orientation sign; GeographicLib handles rings crossing the antimeridian."""
    if len(ring) < 3:
        return 0.0
    closed = list(ring) if ring[0] == ring[-1] else list(ring) + [ring[0]]
    if any(abs(a[0] - b[0]) > 180 for a, b in zip(closed, closed[1:])):
        gis = gis or _gis()
        polygon = gis['Geodesic'].WGS84.Polygon()
        for lon, lat, *_ in closed:
            polygon.AddPoint(lat, lon)
        return polygon.Compute(reverse=False, sign=True)[2]
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(closed, closed[1:])) / 2


def normalize_geojson_winding(geometry, gis=None):
    """RFC7946 exterior CCW / holes CW; the browser performs its D3 reversal."""
    gis = gis or _gis()

    def polygon(rings):
        result = []
        for index, ring in enumerate(rings):
            closed = list(ring)
            if closed and closed[0] != closed[-1]:
                closed.append(closed[0])
            area = ring_signed_area(closed, gis)
            if (index == 0 and area < 0) or (index > 0 and area > 0):
                closed.reverse()
            result.append(closed)
        return result

    if geometry['type'] == 'Polygon':
        coordinates = polygon(geometry['coordinates'])
    elif geometry['type'] == 'MultiPolygon':
        coordinates = [polygon(p) for p in geometry['coordinates']]
    else:
        raise ValueError('Display boundary must be Polygon or MultiPolygon')
    return {'type': geometry['type'], 'coordinates': coordinates}


def export_display_boundaries(cache_dir, output_dir, gis=None):
    """Write compact display GeoJSON from official 2024 cartographic 1:20m ZIPs."""
    gis = gis or _gis()
    cache_dir, output_dir = Path(cache_dir), Path(output_dir)
    mapping = load_catalog()['states']
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = {}
    for kind in ('state', 'county'):
        source = cache_dir / f'spatial/boundaries/cb_2024_us_{kind}_20m.zip'
        features = []
        for props, geom in _zip_shapes(source, gis):
            fips = str(props['STATEFP']).zfill(2)
            if fips not in mapping:
                continue
            geoid = fips if kind == 'state' else fips + str(props['COUNTYFP']).zfill(3)
            geometry = normalize_geojson_winding(geom.geojson(), gis)
            properties = {key: props[key] for key in ('STATEFP', 'COUNTYFP', 'GEOID', 'STUSPS', 'NAME') if key in props}
            properties.update({'fips': geoid, 'name': props['NAME'], 'state_abbr': mapping[fips]})
            features.append({'type': 'Feature', 'id': geoid, 'properties': properties,
                             'geometry': {'type': geometry['type'], 'coordinates': _round_coordinates(geometry['coordinates'])}})
        features.sort(key=lambda f: f['id'])
        target = output_dir / ('states.geojson' if kind == 'state' else 'counties.geojson')
        collection = {'type': 'FeatureCollection', 'features': features}
        _write_text(target, json.dumps(collection, ensure_ascii=False, separators=(',', ':')) + '\n')
        adapter_paths = []
        if kind == 'state':
            adapter = output_dir / 'assets/state-geo.js'
            _write_text(adapter, 'window.STATE_GEO=' + json.dumps(collection, ensure_ascii=False, separators=(',', ':')) + ';\n')
            adapter_paths.append(adapter.relative_to(output_dir).as_posix())
        else:
            for fips, abbr in sorted(mapping.items()):
                local = {'type': 'FeatureCollection', 'features': [f for f in features if f['properties']['STATEFP'] == fips]}
                adapter = output_dir / 'assets/counties/geo' / (abbr + '.js')
                _write_text(adapter, 'window.COUNTY_GEO=window.COUNTY_GEO||{};window.COUNTY_GEO[' + json.dumps(abbr) + ']=' + json.dumps(local, ensure_ascii=False, separators=(',', ':')) + ';\n')
                adapter_paths.append(adapter.relative_to(output_dir).as_posix())
        outputs[kind] = {'features': len(features), 'file': target.name, 'sha256': sha256(target),
                         'source_file': source.name, 'source_sha256': sha256(source),
                         'bytes': target.stat().st_size,
                         'crs': 'NAD83 geographic source coordinates treated as WGS84 for browser display; datum offsets not corrected', 'precision_decimal_places': 6,
                         'winding': 'RFC7946 counterclockwise exterior / clockwise holes; antimeridian rings checked by GeographicLib signed geodesic area',
                         'browser_adapters': adapter_paths}
    display_material = json.dumps({'method': DISPLAY_METHOD,
                                  'sources': {k: v['source_sha256'] for k, v in outputs.items()}}, sort_keys=True).encode()
    display_version = DISPLAY_METHOD['method_version'] + '.' + hashlib.sha256(display_material).hexdigest()[:16]
    atomic_json(output_dir / 'display_boundaries_manifest.json', {'schema_version': 'turnout.display-boundaries.v2',
               'display_reconstruction_version': display_version, 'method': DISPLAY_METHOD, 'outputs': outputs,
               'analytical_transit_geometry_modified': False,
               'note': 'Officially generalized display boundaries. No additional simplification; analytical tract polygons and buffer calculations are unchanged.'})
    return outputs


def reconstruct_exposure(cache_dir, output_dir, states=None, comparison_inputs=None):
    started = time.perf_counter()
    gis = _gis()
    cache_dir, output_dir = Path(cache_dir), Path(output_dir)
    selected = normalize_states(states)
    output_dir.mkdir(parents=True, exist_ok=True)
    existing_manifest = output_dir / 'spatial_manifest.json'
    if existing_manifest.exists():
        previous_method = json.loads(existing_manifest.read_text(encoding='utf-8'))['method']['method_version']
        if previous_method != METHOD['method_version']:
            raise ValueError('Spatial output belongs to a different reconstruction method; choose a new directory')
    catalog = load_catalog()
    mapping = catalog['states']
    source_stops = cache_dir / 'spatial/ntm_fixed_guideway_stops.geojson'
    collection = json.loads(source_stops.read_text(encoding='utf-8'))
    stops = []
    seen = set()
    for feature in collection['features']:
        if not qualifying_stop(feature['properties']):
            continue
        geom = feature.get('geometry') or {}
        if geom.get('type') != 'Point':
            raise ValueError('Selected BTS stop is not a point')
        lon, lat = geom['coordinates'][:2]
        key = (round(lon, 8), round(lat, 8))
        if key not in seen:
            seen.add(key)
            stops.append((lon, lat))
    housing = load_tract_housing(cache_dir / 'acsdt5y2024-b25024.dat', selected)
    geographic_buffer_cache = {}
    tract_rows = []
    inputs = [{'file': source_stops.relative_to(cache_dir).as_posix(), 'sha256': sha256(source_stops)},
              {'file': 'acsdt5y2024-b25024.dat', 'sha256': sha256(cache_dir / 'acsdt5y2024-b25024.dat')}]
    diagnostics = []
    for state in selected:
        source = cache_dir / f'spatial/tracts/tl_2024_{state}_tract.zip'
        inputs.append({'file': source.relative_to(cache_dir).as_posix(), 'sha256': sha256(source)})
        tracts = [(props, geometry) for props, geometry in _zip_shapes(source, gis)]
        if not tracts:
            raise ValueError('No TIGER tracts for ' + state)
        # Circular mean avoids putting an Alaska/dateline projection at Greenwich.
        centres = [g.representative_point() for _, g in tracts]
        lon0 = math.degrees(math.atan2(sum(math.sin(math.radians(p.x)) for p in centres),
                                      sum(math.cos(math.radians(p.x)) for p in centres)))
        lat0 = sum(p.y for p in centres) / len(centres)
        project = spherical_laea(lon0, lat0)
        bounds = [g.bounds for _, g in tracts]
        west, south = min(b[0] for b in bounds) - .1, min(b[1] for b in bounds) - .1
        east, north = max(b[2] for b in bounds) + .1, max(b[3] for b in bounds) + .1
        nearby = [(lon, lat) for lon, lat in stops if west <= lon <= east and south <= lat <= north]
        for stop in nearby:
            if stop not in geographic_buffer_cache:
                geographic_buffer_cache[stop] = geodesic_buffer(*stop, gis=gis)
        geographic_buffers = [geographic_buffer_cache[stop] for stop in nearby]
        geographic_tree = BoundingBoxGrid(geographic_buffers) if geographic_buffers else None
        projected_buffers = {}
        missing = []
        seen_tracts = set()
        for props, geometry in tracts:
            geoid = str(props['GEOID']).zfill(11)
            if geoid[:2] != state:
                raise ValueError('TIGER archive state mismatch')
            if geoid in seen_tracts:
                raise ValueError('Duplicate TIGER tract geography: ' + geoid)
            seen_tracts.add(geoid)
            indices = [int(i) for i in geographic_tree.query(geometry)] if geographic_tree is not None else []
            if not indices:
                # No geographic bounding-box candidate means no intersection;
                # skip expensive projection of remote rural tract vertices.
                fraction = 0.0 if not geometry.is_empty else None
            else:
                projected = geometry.projected(project)
                for index in indices:
                    if index not in projected_buffers:
                        projected_buffers[index] = geographic_buffers[index].projected(project)
                fraction = covered_fraction(projected, [projected_buffers[i] for i in indices], gis)
            value = housing.get(geoid)
            if value is None:
                missing.append(geoid)
            # Zero-housing degenerate water tracts add no exposure and can safely
            # have a zero fraction; positive/unknown housing remains unavailable.
            if value == 0 and fraction is None:
                fraction = 0.0
            tract_rows.append({'geoid': geoid, 'housing': value, 'fraction': fraction})
        diagnostics.append({'state_fips': state, 'state_abbr': mapping[state], 'tracts': len(tracts),
                            'nearby_unique_stops': len(nearby), 'acs_missing_tracts': missing,
                            'projection': {'name': 'spherical_LAEA', 'longitude0': lon0, 'latitude0': lat0,
                                           'radius_metres': 6371007.180918475}})
        atomic_json(output_dir / 'spatial_progress.json', {'method': METHOD['method_version'],
                    'completed_states': [r['state_abbr'] for r in diagnostics], 'target_states': [mapping[s] for s in selected]})
    counties, state_records = aggregate_exposure(tract_rows)
    missing_provenance = missing_exposure_provenance(cache_dir, counties, state_records)
    version_material = json.dumps({'method': METHOD, 'inputs': inputs}, sort_keys=True).encode()
    version = METHOD['method_version'] + '.' + hashlib.sha256(version_material).hexdigest()[:16]
    output_dir.mkdir(parents=True, exist_ok=True)
    # Refuse to mix two provenance versions in one output directory.
    manifest_path = output_dir / 'spatial_manifest.json'
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text(encoding='utf-8'))
        if old['reconstruction_version'] != version:
            raise ValueError('Spatial output directory belongs to another version; choose a new directory')
    columns = ('geography', 'fips', 'state_abbr', 'total_housing_units', 'exposed_housing_units',
               'tract_count', 'missing_tract_count', 'tod_housing_share_new')
    with (output_dir / 'transit_exposure.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for scope, records in (('county', counties), ('state', state_records)):
            for fips, row in sorted(records.items()):
                writer.writerow({'geography': scope, 'fips': fips, 'state_abbr': mapping[fips[:2]],
                                 **{k: row[k] for k in ('total_housing_units', 'exposed_housing_units', 'tract_count', 'tod_housing_share_new')},
                                 'missing_tract_count': len(row['missing_tracts'])})
    shares = {'reconstruction_version': version,
              'county': {f: r['tod_housing_share_new'] for f, r in sorted(counties.items())},
              'state': {mapping[f]: r['tod_housing_share_new'] for f, r in sorted(state_records.items())},
              'state_fips': {f: r['tod_housing_share_new'] for f, r in sorted(state_records.items())}}
    atomic_json(output_dir / 'transit_exposure.json', shares)
    deltas = []
    if comparison_inputs:
        frozen = json.loads(Path(comparison_inputs).read_text(encoding='utf-8'))
        for scope, expected_rows, actual in (('county', frozen['counties'], counties), ('state', frozen['states'], state_records)):
            for row in expected_rows:
                fips = row['fips'] if scope == 'county' else row['state_fips']
                if fips not in actual:
                    continue
                old = row.get('tod_housing_share_new')
                new = actual[fips]['tod_housing_share_new']
                deltas.append({'geography': scope, 'fips': fips, 'frozen_share': old,
                               'reconstructed_share': new,
                               'difference_percentage_points': 100 * (new - old) if new is not None and old is not None else None})
        with (output_dir / 'transit_exposure_delta.csv').open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=('geography', 'fips', 'frozen_share', 'reconstructed_share', 'difference_percentage_points'))
            writer.writeheader()
            writer.writerows(deltas)
    display = export_display_boundaries(cache_dir, output_dir / 'display', gis)
    report = {'schema_version': 'turnout.spatial-reconstruction.v1', 'reconstruction_version': version,
              'method': METHOD, 'inputs': inputs, 'diagnostics': diagnostics, 'county_rows': len(counties),
              'state_rows': len(state_records), 'selected_unique_stops_all_us': len(stops),
              'missing_county_shares': [f for f, r in counties.items() if r['tod_housing_share_new'] is None],
              'missing_data_provenance': missing_provenance,
              'comparison_rows': len(deltas), 'approved_policy_inputs_modified': False,
              'elapsed_seconds': round(time.perf_counter() - started, 3),
              'display_boundaries': display,
              'dependency_versions': {k: gis[k].__version__ for k in ('pyclipper', 'geographiclib', 'shapefile')},
              'attribution': 'U.S.DOT/BTS National Transit Map; U.S.Census Bureau TIGER/Line2024 and ACS2020–2024. BTS item terms retained in raw/spatial/ntm_metadata.json.'}
    atomic_json(manifest_path, report)
    return report
