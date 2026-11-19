"""Tests of the newly documented GIS exposure; never causal validation."""
import math
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from turnout import spatial as s


class SpatialInputTests(unittest.TestCase):
    def test_fixed_guideway_tokens_not_substring(self):
        self.assertTrue(s.qualifying_stop({'stop_type': '0;2;3'}))
        self.assertTrue(s.qualifying_stop({'stop_type': '12'}))
        self.assertFalse(s.qualifying_stop({'stop_type': '11'}))
        self.assertFalse(s.qualifying_stop({'stop_type': '3;11'}))
        self.assertFalse(s.qualifying_stop({'stop_type': '4'}))

    def test_housing_weights_and_missing_propagation(self):
        rows = [{'geoid': '27001000100', 'housing': 100, 'fraction': .5},
                {'geoid': '27001000200', 'housing': 300, 'fraction': .25},
                {'geoid': '27003000100', 'housing': None, 'fraction': 0}]
        counties, states = s.aggregate_exposure(rows)
        self.assertEqual(counties['27001']['total_housing_units'], 400)
        self.assertAlmostEqual(counties['27001']['tod_housing_share_new'], .3125)
        self.assertIsNone(counties['27003']['tod_housing_share_new'])
        self.assertIsNone(states['27']['tod_housing_share_new'])

    def test_zero_housing_denominator_unavailable(self):
        counties, _ = s.aggregate_exposure([{'geoid': '27001000100', 'housing': 0, 'fraction': 0}])
        self.assertIsNone(counties['27001']['tod_housing_share_new'])

    def test_negative_housing_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Invalid housing'):
            s.aggregate_exposure([{'geoid': '27001000100', 'housing': -1, 'fraction': 0}])

    def test_tract_loader_preserves_observed_zero_and_acs_sentinel(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'acs.dat'
            path.write_text('GEO_ID|B25024_E001\n1400000US27001000100|0\n1400000US27001000200|-666666666\n0400000US27|100\n')
            values = s.load_tract_housing(path, ['27'])
            self.assertEqual(values['27001000100'], 0)
            self.assertIsNone(values['27001000200'])
            self.assertEqual(len(values), 2)


class SpatialGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.gis = s._gis()
        except RuntimeError as exc:
            raise unittest.SkipTest(str(exc))

    def test_geodesic_buffer_uses_exact_half_mile_not_degree_radius(self):
        geom = s.geodesic_buffer(-93.2, 45.0, gis=self.gis)
        geod = self.gis['Geodesic'].WGS84
        self.assertEqual(len(geom.rings[0]), 97)
        for lon, lat in geom.rings[0]:
            distance = geod.Inverse(45.0, -93.2, lat, lon)['s12']
            self.assertAlmostEqual(distance, 804.672, places=5)

    def test_explicit_laea_centre_and_dateline_wrap(self):
        project = s.spherical_laea(0, 0)
        self.assertEqual(project(0, 0), (0, 0))
        east, north = project(1, 0)
        self.assertAlmostEqual(east, 2 * 6371007.180918475 * math.sin(math.radians(.5)), places=6)
        self.assertEqual(north, 0)
        wrapped = s.spherical_laea(179, 50)
        x1, y1 = wrapped(-179, 50)
        x2, y2 = wrapped(181, 50)
        self.assertAlmostEqual(x1, x2, places=6)
        self.assertAlmostEqual(y1, y2, places=6)

    def test_overlapping_stop_buffers_union_before_counting_area(self):
        box = self.gis['Polygon']([(0, 0), (10, 0), (10, 10), (0, 10)])
        left = self.gis['Polygon']([(0, 0), (7, 0), (7, 10), (0, 10)])
        right = self.gis['Polygon']([(3, 0), (10, 0), (10, 10), (3, 10)])
        self.assertEqual(s.covered_fraction(box, [left, right], self.gis), 1.0)
        self.assertEqual(s.covered_fraction(box, [left, left], self.gis), .7)
        self.assertEqual(s.covered_fraction(box, [], self.gis), 0)

    def test_degenerate_geometry_missing(self):
        empty = self.gis['Polygon']()
        self.assertIsNone(s.covered_fraction(empty, [], self.gis))
        line = self.gis['Polygon']([(0, 0), (1, 1), (2, 2)])
        self.assertIsNone(s.covered_fraction(line, [], self.gis))

    def test_tract_holes_are_not_counted_as_housing_area(self):
        outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
        hole = [(3, 3), (7, 3), (7, 7), (3, 7)]
        tract = s.Polygon(outer, holes=[hole])
        full = s.Polygon(outer)
        only_hole = s.Polygon(hole)
        left = s.Polygon([(0, 0), (5, 0), (5, 10), (0, 10)])
        self.assertEqual(s.covered_fraction(tract, [full], self.gis), 1)
        self.assertEqual(s.covered_fraction(tract, [only_hole], self.gis), 0)
        self.assertEqual(s.covered_fraction(tract, [left], self.gis), .5)

    def test_disjoint_components_and_self_crossing_even_odd_fill(self):
        tract = s.Polygon([(0, 0), (2, 0), (2, 2), (0, 2)])
        tract.rings.append([(4, 0), (6, 0), (6, 2), (4, 2)])
        clip = s.Polygon([(0, 0), (3, 0), (3, 3), (0, 3)])
        self.assertEqual(s.covered_fraction(tract, [clip], self.gis), .5)
        bow = s.Polygon([(0, 0), (10, 10), (0, 10), (10, 0)])
        self.assertEqual(s.covered_fraction(bow, [s.Polygon([(-1, -1), (11, -1), (11, 11), (-1, 11)])], self.gis), 1)

    def test_bbox_index_is_candidate_only_and_does_not_drop_overlaps(self):
        geometries = [s.Polygon([(0, 0), (.1, 0), (.1, .1), (0, .1)]),
                      s.Polygon([(2, 2), (3, 2), (3, 3), (2, 3)])]
        index = s.BoundingBoxGrid(geometries)
        query = s.Polygon([(.05, .05), (.2, .05), (.2, .2), (.05, .2)])
        self.assertEqual(index.query(query), [0])
        huge = s.Polygon([(-180, -80), (180, -80), (180, 80), (-180, 80)])
        self.assertEqual(index.query(huge), [0, 1])

    def test_display_winding_rfc7946_and_holes(self):
        clockwise = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
        counterclockwise_hole = [(3, 3), (7, 3), (7, 7), (3, 7), (3, 3)]
        geometry = s.normalize_geojson_winding({'type': 'Polygon', 'coordinates': [clockwise, counterclockwise_hole]}, self.gis)
        self.assertGreater(s.ring_signed_area(geometry['coordinates'][0], self.gis), 0)
        self.assertLess(s.ring_signed_area(geometry['coordinates'][1], self.gis), 0)

    def test_antimeridian_display_winding_uses_geodesic_area(self):
        ring = [(179, 10), (179, 11), (-179, 11), (-179, 10), (179, 10)]
        geometry = s.normalize_geojson_winding({'type': 'Polygon', 'coordinates': [ring]}, self.gis)
        polygon = self.gis['Geodesic'].WGS84.Polygon()
        for lon, lat in geometry['coordinates'][0]:
            polygon.AddPoint(lat, lon)
        self.assertGreater(polygon.Compute(reverse=False, sign=True)[2], 0)


if __name__ == '__main__':
    unittest.main()
