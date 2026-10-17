"""Pure-Python export regressions; Blender is not needed for these cases."""
import math
import unittest
from deterministic_normals import quantized_area_normals

class NormalExportTests(unittest.TestCase):
    def test_flat_triangle_and_winding(self):
        points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        self.assertEqual(quantized_area_normals(points, [(0, 1, 2)]), [(0.0, 0.0, 1.0)] * 3)
        self.assertEqual(quantized_area_normals(points, [(2, 1, 0)]), [(0.0, 0.0, -1.0)] * 3)

    def test_triangle_order_does_not_change_reduction(self):
        p = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), (-1, 0, 0)]
        t = [(0, 1, 2), (0, 2, 3), (0, 3, 4)]
        self.assertEqual(quantized_area_normals(p, t), quantized_area_normals(p, list(reversed(t))))

    def test_translation_and_scale_leave_normals_unchanged(self):
        p = [(0, 0, 0), (0.123456, 0.231231, 0), (0, 0.376123, 0.115323)]
        expected = quantized_area_normals(p, [(0, 1, 2)])
        self.assertEqual(expected, quantized_area_normals([tuple(v * 7 for v in q) for q in p], [(0, 1, 2)]))
        self.assertEqual(expected, quantized_area_normals([tuple(v + 2 for v in q) for q in p], [(0, 1, 2)]))

    def test_bounded_unit_length_and_no_negative_zero(self):
        p = [(0, 0, 0), (0.123456, 0.231231, 0), (0, 0.376123, 0.115323)]
        for n in quantized_area_normals(p, [(0, 1, 2)]):
            self.assertAlmostEqual(math.sqrt(sum(v*v for v in n)), 1, places=6)
            self.assertTrue(all(-1 <= v <= 1 for v in n))
        n = quantized_area_normals([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [(0, 1, 2)])[0]
        self.assertNotIn('-0.0', repr(n))

    def test_degenerate_and_unreferenced_are_finite(self):
        self.assertEqual(quantized_area_normals([(0, 0, 0)] * 4, [(0, 1, 2)]), [(0.0, 1.0, 0.0)] * 4)

    def test_rejects_non_grid_or_non_finite(self):
        for point in [(math.nan, 0, 0), (math.inf, 0, 0), (0.0000007, 0, 0), (1, 2)]:
            with self.assertRaises(ValueError): quantized_area_normals([point], [])

    def test_rejects_bad_indices(self):
        for triangle in [(0, 1, 9), (0, -1, 1), (0, 1), (0, 1, 2.0)]:
            with self.assertRaises(ValueError): quantized_area_normals([(0, 0, 0)] * 3, [triangle])

if __name__ == '__main__': unittest.main()
