import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./tonemap.mjs', import.meta.url), 'utf8').split('for (const L of')[0];
const { aces, agx, srgb } = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport { aces, agx, neutral, srgb };'));
const lin = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
// invert ACES approx by search for the before zenith
const target = [93, 131, 176];
let best = null;
for (let r = 0.01; r < 0.6; r += 0.005) for (let g = 0.01; g < 0.8; g += 0.005) for (let b = 0.05; b < 1.6; b += 0.01) {
  const o = aces([r, g, b], 1).map(srgb);
  const e = Math.abs(o[0] - target[0]) + Math.abs(o[1] - target[1]) + Math.abs(o[2] - target[2]);
  if (!best || e < best[0]) best = [e, [r, g, b]];
}
console.log('scene zenith (ACES inverse)', best[1].map((v) => v.toFixed(3)), 'agx', agx(best[1], 1).map(srgb));
