import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./tonemap.mjs', import.meta.url), 'utf8').split('for (const L of')[0];
const { aces, agx, neutral, srgb } = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport { aces, agx, neutral, srgb };'));
for (const [name, c] of [['kerb red', [0.43, 0.027, 0.021]], ['kerb white', [0.68, 0.66, 0.6]], ['grass', [0.083, 0.128, 0.05]], ['asphalt', [0.116, 0.117, 0.115]], ['sky', [0.35, 0.55, 1.0]], ['sky horizon', [0.7, 0.85, 1.05]], ['orange shirt', [0.55, 0.18, 0.05]]]) {
  for (const e of [1.0, 1.3]) console.log(name.padEnd(12), e, 'aces', aces(c, e).map(srgb).join(','), ' agx', agx(c, e).map(srgb).join(','), ' neutral*1.3', neutral(c, e * 1.3).map(srgb).join(','));
}
