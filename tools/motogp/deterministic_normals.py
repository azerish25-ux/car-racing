"""Deterministic smooth normals from the *exported* micrometre vertex grid.

Blender's SIMD corner-normal reduction can differ in its last bits between
processors. Integer cross products and a Decimal square root make this final
runtime quantisation independent of that reduction, with no position, UV,
triangle or material mutation. The native Blender mesh remains editable.
"""
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
from math import isfinite
from typing import Sequence

NORMAL_ALGORITHM = 'integer-area-decimal-normal-v1'
POSITION_SCALE = 1_000_000


def quantized_area_normals(positions: Sequence[Sequence[float]],
                           triangles: Sequence[Sequence[int]]) -> list[tuple[float, float, float]]:
    """Return area-weighted vertex normals rounded to six decimal places.

    Positions must already be on the six-decimal export grid. Degenerate
    triangles contribute nothing; unreferenced vertices get a finite +Y normal
    and are subsequently omitted by the exporter's triangle-loop traversal.
    """
    points: list[tuple[int, int, int]] = []
    for point in positions:
        if len(point) != 3 or not all(isfinite(value) for value in point):
            raise ValueError('A position must contain three finite coordinates')
        quantized = tuple(int(round(value * POSITION_SCALE)) for value in point)
        if any(abs(quantized[i] / POSITION_SCALE - point[i]) > 1e-10 for i in range(3)):
            raise ValueError('Positions must be on the micrometre export grid')
        points.append(quantized)
    sums = [[0, 0, 0] for _ in points]
    for triangle in triangles:
        if len(triangle) != 3 or any(not isinstance(i, int) or i < 0 or i >= len(points) for i in triangle):
            raise ValueError('Invalid triangle index')
        a, b, c = (points[i] for i in triangle)
        ab = tuple(b[k] - a[k] for k in range(3))
        ac = tuple(c[k] - a[k] for k in range(3))
        cross = (ab[1] * ac[2] - ab[2] * ac[1],
                 ab[2] * ac[0] - ab[0] * ac[2],
                 ab[0] * ac[1] - ab[1] * ac[0])
        for i in triangle:
            for k in range(3):
                sums[i][k] += cross[k]
    normals = []
    with localcontext() as context:
        context.prec = 50
        context.rounding = ROUND_HALF_EVEN
        quantum = Decimal('0.000001')
        for vector in sums:
            length_squared = sum(v * v for v in vector)
            if not length_squared:
                normals.append((0.0, 1.0, 0.0))
                continue
            length = Decimal(length_squared).sqrt()
            values = tuple(float((Decimal(v) / length).quantize(quantum)) for v in vector)
            # Avoid platform-/sign-dependent negative zero in JSON bytes.
            normals.append(tuple(0.0 if value == 0 else value for value in values))
    return normals
