/**
 * Build step for `"type": "vegetation"` register entries (called by
 * scripts/assets/build-third-party.ts): materialises the cached source files
 * under their scene-relative paths, bakes the plant (bake.ts) and ships
 *
 *   assets/third-party/vegetation/<id>/<id>.veg            geometry container
 *   assets/third-party/vegetation/<id>/<id>_<map>.ktx2     atlases (Basis, mipmapped)
 *   assets/third-party/vegetation/<id>/<id>_<map>.webp     half-size fallbacks
 *
 * Maps: cards_color, cards_normal, impostor_color, impostor_normal,
 * bark_color, bark_normal (trees and shrubs); grass_color, grass_normal.
 * Colour atlases are sRGB with coverage in alpha; normal atlases are linear
 * tangent-space normals (OpenGL +Y) with sky visibility in alpha. Node only.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ShippedFile } from '../../../src/rendering/assets/third-party.ts';
import type { SourceEntry, SourceFile } from '../register.ts';
import { bakeGrass, bakeTree, type Image8 } from './bake.ts';
import { writePng } from './image.ts';
import type { VegetationRecipe } from './recipe.ts';

export interface VegetationBuildContext {
  /** Local path of a verified source file (cache). */
  fetch(file: SourceFile): string;
  toktx: { command: string; env: NodeJS.ProcessEnv } | null;
  writeShipped(
    path: string,
    bytes: Uint8Array,
    rest: Omit<ShippedFile, 'path' | 'bytes' | 'sha256'>,
  ): ShippedFile;
  log(...parts: unknown[]): void;
}

/** Scene-relative path of a landscape source URL (geometry/..., textures/...). */
export function sceneRelative(url: string) {
  const match = /\/landscape\/((?:geometry|textures)\/[^/]+)$/.exec(url);
  if (!match) throw new Error(`${url}: not a landscape scene file`);
  return match[1];
}

function encode(
  image: Image8,
  base: string,
  role: string,
  work: string,
  ctx: VegetationBuildContext,
): ShippedFile[] {
  let png = join(work, `${role}.png`);
  writePng(png, image.width, image.height, image.data);
  let { width, height } = image;
  // Normal + visibility atlases ship at half the colour resolution: shading
  // detail is in the colour; this halves their download and memory 4x.
  if (role.endsWith('normal')) {
    const half = join(work, `${role}-half.png`);
    execFileSync('convert', [png, '-filter', 'Box', '-resize', '50%', `PNG32:${half}`]);
    png = half;
    width /= 2;
    height /= 2;
  }
  const files: ShippedFile[] = [];
  // Half-size WebP fallback (alpha kept; lossless-ish quality for normals).
  const webp = join(work, `${role}.webp`);
  execFileSync('convert', [
    png,
    '-filter',
    'Box',
    '-resize',
    '50%',
    '-define',
    'webp:method=6',
    '-define',
    'webp:alpha-quality=90',
    '-quality',
    role.endsWith('normal') ? '90' : '86',
    webp,
  ]);
  files.push(
    ctx.writeShipped(`${base}_${role}.webp`, new Uint8Array(readFileSync(webp)), {
      role,
      format: 'webp',
      width: width / 2,
      height: height / 2,
      colorSpace: image.colorSpace,
    }),
  );
  if (ctx.toktx) {
    const ktx = join(work, `${role}.ktx2`);
    const normal = role.endsWith('normal');
    execFileSync(
      ctx.toktx.command,
      [
        '--t2',
        // Rows bottom-first, as WebGL uploads a flipped image: atlas UVs
        // address the same texels in the KTX2 and the WebP fallback.
        '--lower_left_maps_to_s0t0',
        '--genmipmap',
        '--filter',
        'box',
        '--assign_oetf',
        image.colorSpace === 'srgb' ? 'srgb' : 'linear',
        '--target_type',
        role.startsWith('bark') ? 'RGB' : 'RGBA',
        ...(normal
          ? ['--encode', 'uastc', '--uastc_quality', '1', '--uastc_rdo_l', '2.5', '--zcmp', '19']
          : ['--encode', 'etc1s', '--clevel', '4', '--qlevel', '220']),
        ktx,
        png,
      ],
      { env: ctx.toktx.env, stdio: 'inherit' },
    );
    files.push(
      ctx.writeShipped(`${base}_${role}.ktx2`, new Uint8Array(readFileSync(ktx)), {
        role,
        format: 'ktx2',
        width,
        height,
        colorSpace: image.colorSpace,
      }),
    );
  }
  ctx.log(
    `  ${role}: ${files.map((f) => `${f.format} ${(f.bytes / 1024).toFixed(0)} KB`).join(', ')}`,
  );
  return files;
}

export async function buildVegetation(
  source: SourceEntry,
  recipe: VegetationRecipe,
  ctx: VegetationBuildContext,
) {
  const work = join(tmpdir(), `apex-vegetation-${source.id}-${process.pid}`);
  const root = join(work, 'landscape');
  rmSync(work, { recursive: true, force: true });
  for (const file of source.files) {
    const target = join(root, sceneRelative(file.url));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(ctx.fetch(file), target);
  }
  const baked =
    recipe.form === 'grass'
      ? await bakeGrass(root, recipe, ctx.log)
      : await bakeTree(root, recipe, recipe.seed, ctx.log);
  const base = `assets/third-party/vegetation/${source.id}/${source.id}`;
  const files: ShippedFile[] = [
    ctx.writeShipped(`${base}.veg`, baked.geometry, { role: 'geometry', format: 'bin' }),
  ];
  for (const [role, image] of Object.entries(baked.images))
    files.push(...encode(image, base, role, work, ctx));
  rmSync(work, { recursive: true, force: true });
  return { files, vegetation: baked.info };
}
