/** Shape-preserving cubic interpolation. Unlike an unconstrained Catmull-Rom
 * spline it does not swell past a supplied width/height between stations. */
export function sampleProfile(xs: readonly number[], ys: readonly number[], x: number): number {
  if (xs.length !== ys.length || xs.length < 2)
    throw new RangeError('A profile needs matching stations');
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 0;
  while (i < xs.length - 2 && xs[i + 1] < x) i++;
  const slope = (j: number) => (ys[j + 1] - ys[j]) / (xs[j + 1] - xs[j]);
  const tangent = (j: number) => {
    if (j === 0) return slope(0);
    if (j === xs.length - 1) return slope(j - 1);
    const a = slope(j - 1),
      b = slope(j);
    if (a * b <= 0) return 0;
    const h0 = xs[j] - xs[j - 1],
      h1 = xs[j + 1] - xs[j];
    const w0 = 2 * h1 + h0,
      w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / a + w1 / b);
  };
  const h = xs[i + 1] - xs[i],
    t = (x - xs[i]) / h,
    t2 = t * t,
    t3 = t2 * t;
  const v =
    (2 * t3 - 3 * t2 + 1) * ys[i] +
    (t3 - 2 * t2 + t) * h * tangent(i) +
    (-2 * t3 + 3 * t2) * ys[i + 1] +
    (t3 - t2) * h * tangent(i + 1);
  // Endpoint tangents use secants: clamp round-off or a very uneven station gap.
  return Math.min(Math.max(ys[i], ys[i + 1]), Math.max(Math.min(ys[i], ys[i + 1]), v));
}
