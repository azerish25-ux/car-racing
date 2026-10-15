// Compare three's ACES, AgX and Neutral on grey inputs.
const mul = (m, v) => [0, 1, 2].map((r) => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]);
const aces = (c, e) => {
  const inM = [[0.59719, 0.076, 0.0284], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
  const outM = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
  let v = c.map((x) => (x * e) / 0.6);
  v = mul(inM, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  v = mul(outM, v);
  return v.map((x) => Math.min(1, Math.max(0, x)));
};
const agx = (c, e) => {
  const toRec = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]];
  const fromRec = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
  const inset = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
  const outset = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
  let v = c.map((x) => x * e);
  v = mul(toRec, v);
  v = mul(inset, v);
  v = v.map((x) => Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10)) + 12.47393) / (4.026069 + 12.47393))));
  v = v.map((x) => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; });
  v = mul(outset, v);
  v = v.map((x) => Math.max(0, x) ** 2.2);
  v = mul(fromRec, v);
  return v.map((x) => Math.min(1, Math.max(0, x)));
};
const neutral = (c, e) => {
  let v = c.map((x) => x * e);
  const x = Math.min(...v);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  v = v.map((y) => y - offset);
  const peak = Math.max(...v);
  const sc = 0.76;
  if (peak < sc) return v;
  const d = 1 - sc;
  const np = 1 - (d * d) / (peak + d - sc);
  v = v.map((y) => (y * np) / peak);
  const g = 1 - 1 / (0.15 * (peak - np) + 1);
  return v.map((y) => y + (np - y) * g);
};
const srgb = (x) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
for (const L of [0.02, 0.05, 0.1, 0.18, 0.3, 0.5, 1, 2, 4, 8]) {
  const c = [L, L, L];
  console.log(L.toString().padStart(5), 'aces', srgb(aces(c, 1)[0]), 'agx', srgb(agx(c, 1)[0]), 'agx*1.6', srgb(agx(c, 1.6)[0]), 'agx*1.4', srgb(agx(c, 1.4)[0]), 'neutral', srgb(neutral(c, 1)[0]), 'neutral*1.25', srgb(neutral(c, 1.25)[0]));
}
// saturated colour: kerb red, grass
for (const c of [[0.39, 0.024, 0.019], [0.075, 0.115, 0.045], [0.2, 0.35, 0.8]]) {
  console.log(JSON.stringify(c), 'aces', aces(c, 1.5).map(srgb), 'agx1.6', agx(c, 1.5 * 1.6).map(srgb), 'neutral1.25', neutral(c, 1.5 * 1.25).map(srgb));
}
