import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./tonemap.mjs', import.meta.url), 'utf8').split('for (const L of')[0];
const { aces, agx, srgb } = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport { aces, agx, neutral, srgb };'));
const enc = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const curve = (v, c) => { const x = Math.min(1, Math.max(0, v)); const s = x * x * (3 - 2 * x); return x + (s - x) * c; };
for (const L of [0.01, 0.02, 0.05, 0.1, 0.18, 0.3, 0.5, 1, 2, 4]) {
  const a = curve(enc(aces([L, L, L], 1)[0]), 0.16), g8 = curve(enc(agx([L, L, L], 1)[0]), 0.08), g10 = curve(enc(agx([L, L, L], 1)[0]), 0.1), g12 = curve(enc(agx([L, L, L], 1)[0]), 0.12);
  console.log(String(L).padStart(5), 'aces+.16', Math.round(a * 255), ' agx+.08', Math.round(g8 * 255), ' agx+.10', Math.round(g10 * 255), ' agx+.12', Math.round(g12 * 255));
}
