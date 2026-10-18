import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MX_TRACKSIDE_MODELS,
  mxTracksideParts,
  mxTracksidePalette,
} from '../src/rendering/offroad/mx-trackside-models.ts';

/** Export exactly the production part buffers, not a second approximation of
 * their dimensions. Native Blender construction reads this portable document. */
const directory = process.argv[2];
if (!directory)
  throw new Error(
    'Usage: node --experimental-transform-types scripts/export-mx-trackside.ts OUTPUT_DIRECTORY',
  );
const out = resolve(directory);
mkdirSync(out, { recursive: true });
const palette = mxTracksidePalette();
const materials = Object.fromEntries(
  Object.entries(palette).map(([role, m]) => [
    role,
    { roughness: m.roughness, metalness: m.metalness, doubleSided: role === 'fabric' },
  ]),
);
Object.values(palette).forEach((m) => m.dispose());
const variants = [];
for (const model of MX_TRACKSIDE_MODELS)
  for (const detail of ['near', 'course'] as const) {
    const source = mxTracksideParts(model, detail);
    const parts = source.map((part) => {
      const attributes = Object.fromEntries(
        ['position', 'normal', 'uv', 'color'].map((name) => [
          name,
          Array.from(part.geometry.getAttribute(name).array, (x) => Math.round(x * 1e6) / 1e6),
        ]),
      );
      return { name: part.name, material: part.material, attributes };
    });
    variants.push({
      model,
      detail,
      parts,
      triangles: parts.reduce((sum, p) => sum + p.attributes.position.length / 9, 0),
    });
    source.forEach((part) => part.geometry.dispose());
  }
const bytes =
  JSON.stringify({
    schema: 1,
    coordinates: 'metres, +Y up, +Z forward',
    source: 'src/rendering/offroad/mx-trackside-models.ts',
    materials,
    variants,
  }) + '\n';
writeFileSync(join(out, 'mx-trackside-source.json'), bytes);
writeFileSync(
  join(out, 'mx-trackside-source.sha256'),
  createHash('sha256').update(bytes).digest('hex') + '\n',
);
console.log(
  JSON.stringify(
    {
      out,
      variants: variants.map(({ model, detail, triangles, parts }) => ({
        model,
        detail,
        triangles,
        parts: parts.length,
      })),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    null,
    2,
  ),
);
