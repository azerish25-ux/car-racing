/**
 * Reproducible build of the shipped third-party assets.
 *
 *   node --experimental-transform-types scripts/assets/build-third-party.ts \
 *     --tools DIR [--cache DIR] [--reuse DIR] [--toktx PATH] [--only id,id] [--check]
 *
 * Reads the source register (assets/third-party/sources.json), fetches every
 * source file into a gitignored cache (.cache/third-party by default; a file
 * from `--reuse DIR/manifest.tsv` — a previous download run's URL -> path
 * table — is copied when its SHA-256 matches), verifies size and SHA-256,
 * converts it by its recipe and writes:
 *
 *   public/assets/third-party/<kind>/<id>/...   shipped files
 *   public/assets/third-party/CREDITS.txt       attribution text
 *   public/assets/basis/                        KTX2 transcoder (from three)
 *   src/rendering/assets/third-party-manifest.json
 *
 * Recipes
 *   hdri  Radiance .hdr (optionally inside a .tar.gz) -> analysis (sun,
 *         dome, horizon; scripts/assets/hdri.ts) -> normalised to a unit dome
 *         and clamped -> Ultra HDR JPEG per variant width: sRGB base at full
 *         size plus a half-size scalar gain map (reconstruction verified).
 *   pbr   colour / normal / roughness / ao PNGs -> KTX2 (colour ETC1S sRGB,
 *         normal and ORM UASTC + zstd, mipmapped) with toktx when available,
 *         and WebP fallbacks (ImageMagick `convert`); DirectX normals are
 *         flipped to OpenGL; ORM packs AO (R), roughness (G), metalness (B).
 *
 * Tools are not dependencies of the application. `--tools DIR` names a
 * node_modules directory holding `hdrify` (MIT, Ultra HDR container) and
 * `jpeg-js` (BSD-3-Clause, JPEG coding); install them anywhere with
 * `npm install --prefix <dir> hdrify-cli@1.3.0`. `--toktx` points at KTX-Software
 * 4.4.x's toktx (else $PATH; without it, textures ship WebP only).
 * `--check` re-audits the shipped tree against the manifest and exits.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyseHdri,
  bakeBelowSkyline,
  compareHdr,
  gainMapLevels,
  halveImage,
  jpegImageSpans,
  normaliseHdri,
  reconstruct,
  sdrBase,
  type FloatImage,
} from './hdri.ts';
import {
  auditShipment,
  MANIFEST_PATH,
  readRegister,
  sha256,
  SHIPPED_ROOT,
  sourceDirectory,
  validateRegister,
  type HdriRecipe,
  type PbrRecipe,
  type SourceEntry,
  type SourceFile,
} from './register.ts';
import type {
  ShippedAsset,
  ShippedFile,
  ThirdPartyManifest,
} from '../../src/rendering/assets/third-party.ts';
import { LICENCE_INFO } from '../../src/rendering/assets/licences.ts';
import {
  meanChannel,
  meanLinear,
  normalFromColor,
  readRgb,
  recentreNormal,
  roughnessFromColor,
  synthesizeTile,
  writeRgb,
} from './texture-ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const log = (...parts: unknown[]) => console.log('[third-party]', ...parts);

// ------------------------------------------------------------------ tools
interface RawImage {
  width: number;
  height: number;
  data: Uint8Array;
}
interface Tools {
  readHdr(bytes: Uint8Array): { width: number; height: number; data: Float32Array };
  encodeJpeg(image: RawImage, quality: number): { data: Uint8Array };
  decodeJpeg(bytes: Uint8Array, options: { useTArray: boolean; formatAsRGBA: boolean }): RawImage;
  assemble(metadata: Record<string, unknown>, options: { format: 'ultrahdr' }): Uint8Array;
  versions: Record<string, string>;
}
async function loadTools(directory: string | undefined): Promise<Tools> {
  if (!directory)
    throw new Error('--tools DIR (a node_modules directory with hdrify and jpeg-js) is required');
  const dir = resolve(directory);
  const load = async (path: string) => import(pathToFileURL(join(dir, path)).href);
  const version = (name: string) =>
    (JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8')) as { version: string })
      .version;
  const hdrify = (await load('hdrify/dist/index.js')) as {
    readHdr: Tools['readHdr'];
  };
  const metadata = (await load('hdrify/dist/gainmap/libultrahdr/encode-jpeg-metadata.js')) as {
    encodeJPEGMetadata: (m: Record<string, unknown>, o: { format: 'ultrahdr' }) => Uint8Array;
  };
  const jpeg = (await load('jpeg-js/index.js')) as {
    default?: { encode: Tools['encodeJpeg']; decode: Tools['decodeJpeg'] };
    encode: Tools['encodeJpeg'];
    decode: Tools['decodeJpeg'];
  };
  const codec = jpeg.default ?? jpeg;
  return {
    readHdr: hdrify.readHdr,
    encodeJpeg: (image, quality) => codec.encode(image, quality),
    decodeJpeg: (bytes, options) => codec.decode(bytes, options),
    assemble: (m, o) => metadata.encodeJPEGMetadata(m, o),
    versions: { hdrify: version('hdrify'), 'jpeg-js': version('jpeg-js') },
  };
}
function findToktx() {
  const explicit = option('toktx');
  const candidates = explicit ? [explicit] : ['toktx'];
  for (const command of candidates) {
    try {
      const env = {
        ...process.env,
        LD_LIBRARY_PATH: [join(dirname(command), '../lib'), process.env.LD_LIBRARY_PATH ?? ''].join(
          ':',
        ),
      };
      const run = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
      const version = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
      if (run.status === 0 && version) return { command, env, version };
    } catch {
      /* not available */
    }
  }
  return null;
}
/** Baseline JPEG through ImageMagick (libjpeg: optimised Huffman tables,
 * 4:2:0 chroma, single-channel grey) when available, else jpeg-js. */
function encodeJpeg(tools: Tools, image: RawImage, quality: number, grey: boolean) {
  if (!imageMagick()) return tools.encodeJpeg(image, quality).data;
  const work = join(tmpdir(), `apex-jpeg-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const channels = grey ? 1 : 3,
    pixels = Buffer.alloc(image.width * image.height * channels);
  for (let p = 0; p < image.width * image.height; p++)
    for (let c = 0; c < channels; c++) pixels[p * channels + c] = image.data[p * 4 + c];
  const input = join(work, grey ? 'in.pgm' : 'in.ppm'),
    output = join(work, 'out.jpg');
  writeFileSync(
    input,
    Buffer.concat([
      Buffer.from(`${grey ? 'P5' : 'P6'}\n${image.width} ${image.height}\n255\n`),
      pixels,
    ]),
  );
  execFileSync('convert', [
    input,
    '-strip',
    '-quality',
    `${quality}`,
    ...(grey ? ['-type', 'Grayscale'] : ['-sampling-factor', '4:2:0']),
    '-define',
    'jpeg:optimize-coding=true',
    `JPEG:${output}`,
  ]);
  const bytes = new Uint8Array(readFileSync(output));
  rmSync(work, { recursive: true, force: true });
  return bytes;
}
function imageMagick() {
  try {
    return execFileSync('convert', ['-version'], { encoding: 'utf8' }).split('\n')[0];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ fetch
const CACHE = resolve(option('cache') ?? join(ROOT, '.cache/third-party'));
function reuseTable() {
  const dir = option('reuse');
  const table = new Map<string, string>();
  if (!dir || !existsSync(join(dir, 'manifest.tsv'))) return table;
  for (const line of readFileSync(join(dir, 'manifest.tsv'), 'utf8').split('\n')) {
    const cols = line.split('\t');
    if (cols.length >= 5 && cols[3].startsWith('https://')) table.set(cols[3], cols[4]);
  }
  return table;
}
const reuse = reuseTable();
function cached(file: SourceFile) {
  const path = join(CACHE, 'sources', file.sha256);
  const valid = (p: string) =>
    existsSync(p) && statSync(p).size === file.bytes && sha256(readFileSync(p)) === file.sha256;
  if (valid(path)) return path;
  mkdirSync(dirname(path), { recursive: true });
  const local = [reuse.get(file.url), ...extraReuse(file.url)].filter((p): p is string => !!p);
  for (const candidate of local)
    if (valid(candidate)) {
      copyFileSync(candidate, path);
      log('reused', file.url);
      return path;
    }
  log('fetching', file.url);
  // curl honours the environment's proxy settings and CA bundle.
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', path, file.url], { stdio: 'inherit' });
  if (!valid(path)) {
    rmSync(path, { force: true });
    throw new Error(`${file.url}: size or SHA-256 differs from the register`);
  }
  return path;
}
/** Other local copies: files named like the URL's basename in --reuse-dir trees. */
function extraReuse(url: string) {
  const dirs = (option('reuse-dirs') ?? '').split(',').filter(Boolean);
  const name = url.split('/').pop()!;
  return dirs.map((d) => join(d, name));
}
function extractMember(archive: string, member: string) {
  return new Uint8Array(
    execFileSync('tar', ['-xzOf', archive, member], { maxBuffer: 512 * 1024 * 1024 }),
  );
}

// ------------------------------------------------------------------ output
const PUBLIC = join(ROOT, 'public');
function writeShipped(
  path: string,
  bytes: Uint8Array,
  rest: Omit<ShippedFile, 'path' | 'bytes' | 'sha256'>,
): ShippedFile {
  const full = join(PUBLIC, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), ...rest };
}

// ------------------------------------------------------------------ hdri
async function buildHdri(source: SourceEntry, recipe: HdriRecipe, tools: Tools) {
  const file = source.files[0];
  const raw = cached(file);
  const bytes = file.member ? extractMember(raw, file.member) : new Uint8Array(readFileSync(raw));
  const hdr = tools.readHdr(bytes);
  const image: FloatImage = {
    width: hdr.width,
    height: hdr.height,
    data: hdr.data,
    channels: (hdr.data.length / (hdr.width * hdr.height)) as 3 | 4,
  };
  const analysis = analyseHdri(image, recipe.skyline);
  const normalised = normaliseHdri(image, analysis, recipe.clamp);
  // The ground and nearby land are never drawn (sky shader haze): not shipped.
  bakeBelowSkyline(normalised.image, recipe.skyline);
  const gainMax = Math.log2(1 + recipe.clamp);
  const files: ShippedFile[] = [];
  let level = normalised.image,
    rms = 0;
  for (const width of [...recipe.variants].sort((a, b) => b - a)) {
    while (level.width > width) level = halveImage(level);
    if (level.width !== width)
      throw new Error(`${source.id}: cannot make a ${width} px variant from ${image.width} px`);
    const gain = gainMapLevels(level, gainMax);
    const grey = new Uint8Array(gain.width * gain.height * 4);
    for (let p = 0; p < gain.width * gain.height; p++) {
      grey[p * 4] = grey[p * 4 + 1] = grey[p * 4 + 2] = gain.levels[p];
      grey[p * 4 + 3] = 255;
    }
    const gainJpeg = encodeJpeg(
      tools,
      { width: gain.width, height: gain.height, data: grey },
      Math.max(recipe.quality, 95),
      true,
    );
    // The base is computed against the gain the decoder will read back.
    const decoded = tools.decodeJpeg(gainJpeg, { useTArray: true, formatAsRGBA: true });
    const levels = new Uint8Array(gain.width * gain.height);
    for (let p = 0; p < levels.length; p++) levels[p] = decoded.data[p * 4 + 1];
    const base = sdrBase(level, levels, gain.width, gain.height, gainMax);
    const baseJpeg = encodeJpeg(
      tools,
      { width: level.width, height: level.height, data: base.data },
      recipe.quality,
      false,
    );
    const container = tools.assemble(
      {
        sdr: { data: baseJpeg, mimeType: 'image/jpeg', width: level.width, height: level.height },
        gainMap: { data: gainJpeg, mimeType: 'image/jpeg', width: gain.width, height: gain.height },
        gamma: [1, 1, 1],
        offsetSdr: [0, 0, 0],
        offsetHdr: [0, 0, 0],
        gainMapMin: [0, 0, 0],
        gainMapMax: [gainMax, gainMax, gainMax],
        hdrCapacityMin: 0,
        hdrCapacityMax: gainMax,
      },
      { format: 'ultrahdr' },
    );
    const spans = jpegImageSpans(container);
    if (spans.length !== 2)
      throw new Error(`${source.id}: expected base + gain map JPEGs, found ${spans.length}`);
    // Verify what the runtime will reconstruct (the base decoded again).
    const baseDecoded = tools.decodeJpeg(container.subarray(spans[0].start, spans[0].end), {
      useTArray: true,
      formatAsRGBA: true,
    });
    const check = compareHdr(
      level,
      reconstruct(
        baseDecoded.data,
        level.width,
        level.height,
        levels,
        gain.width,
        gain.height,
        gainMax,
      ),
    );
    if (width === Math.max(...recipe.variants)) rms = check.rmsStops;
    log(
      `${source.id} ${width}: ${(container.length / 1048576).toFixed(2)} MB, base clipped ${base.clipped}, rms ${check.rmsStops.toFixed(3)} stops, worst ${check.worstStops.toFixed(2)}`,
    );
    if (check.rmsStops > 0.15)
      throw new Error(`${source.id}: reconstruction error ${check.rmsStops} stops`);
    const label = width >= 4096 ? '4k' : width >= 2048 ? '2k' : `${width}`;
    files.push(
      writeShipped(
        `assets/third-party/hdri/${source.id}/${source.id}_${label}.hdr.jpg`,
        container,
        {
          role: label,
          format: 'ultrahdr',
          width: level.width,
          height: level.height,
          colorSpace: 'linear',
          gainMap: { offset: spans[1].start, width: gain.width, height: gain.height, gainMax },
        },
      ),
    );
  }
  const round = (v: number, digits = 4) => Number(v.toFixed(digits));
  const rgb = (c: readonly number[], k = normalised.scale) =>
    c.map((v) => round(v * k)) as [number, number, number];
  return {
    files,
    hdri: {
      sunAzimuth: round(analysis.sunAzimuth, 2),
      sunElevation: round(analysis.sunElevation, 2),
      sunColor: rgb(analysis.sunColor, 1),
      sunToSky: round(analysis.sunToSky, 3),
      domeMean: rgb(analysis.domeMean),
      horizonSunSide: rgb(analysis.horizonSunSide),
      horizonAntiSun: rgb(analysis.horizonAntiSun),
      horizonMean: rgb(analysis.horizonMean),
      zenith: rgb(analysis.zenith),
      groundMean: rgb(analysis.groundMean),
      normalisation: Number(normalised.scale.toPrecision(6)),
      clamp: recipe.clamp,
      skyline: recipe.skyline,
      rmsStops: round(rms, 4),
    },
  };
}

// ------------------------------------------------------------------ pbr
function buildPbr(source: SourceEntry, recipe: PbrRecipe, toktx: ReturnType<typeof findToktx>) {
  if (!imageMagick()) throw new Error('ImageMagick `convert` is required for texture sets');
  const work = join(tmpdir(), `apex-third-party-${source.id}-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const role = (name: string) => {
    const file = source.files.find((f) => f.role === name);
    if (!file) return null;
    const path = cached(file);
    if (!file.member) return path;
    // A map inside an archive (an npm tarball): extracted beside the work.
    const out = join(work, `member-${name}${file.member.slice(file.member.lastIndexOf('.'))}`);
    writeFileSync(out, extractMember(path, file.member));
    return out;
  };
  const size = `${recipe.size}x${recipe.size}!`;
  let color = role('color'),
    normal = role('normal'),
    roughness = role('roughness');
  const ao = role('ao'),
    metal = role('metalness');
  if (!color) throw new Error(`${source.id}: a texture set needs a color map`);
  if (recipe.synth) {
    // Re-synthesise one seamless tile from the clean source regions; every
    // map gets the same patches (DirectX normals are flipped first).
    const inputs = [color, roughness, normal].filter((p): p is string => !!p);
    const images = inputs.map((p) => readRgb(p));
    if (normal && recipe.normal === 'dx') {
      const n = images[inputs.indexOf(normal)];
      for (let i = 1; i < n.data.length; i += 3) n.data[i] = 1 - n.data[i];
    }
    const out = synthesizeTile(images, recipe.synth, normal ? [inputs.indexOf(normal)] : []);
    const written = inputs.map((p, i) => {
      const path = join(work, `synth-${i}.png`);
      writeRgb(out[i], path);
      return path;
    });
    color = written[0];
    if (roughness) roughness = written[inputs.indexOf(roughness)];
    if (normal) normal = written[inputs.indexOf(normal)];
    log(`${source.id}: synthesised a ${recipe.synth.size} px seamless tile`);
  }
  const normalIsDx = recipe.normal === 'dx' && !recipe.synth;
  const maps: { name: string; png: string; srgb: boolean; uastc: boolean }[] = [];
  const convert = (args: string[]) => execFileSync('convert', args, { stdio: 'inherit' });
  // Colour: sRGB, resized with a linear-light filter.
  const colorPng = join(work, 'color.png');
  convert([
    color,
    '-colorspace',
    'RGB',
    '-filter',
    'Lanczos',
    '-resize',
    size,
    '-colorspace',
    'sRGB',
    '-alpha',
    'off',
    `PNG24:${colorPng}`,
  ]);
  maps.push({ name: 'color', png: colorPng, srgb: true, uastc: false });
  if (normal) {
    const normalPng = join(work, 'normal.png');
    const flip = normalIsDx ? ['-channel', 'G', '-negate', '+channel'] : [];
    convert([
      normal,
      '-strip',
      '-set',
      'colorspace',
      'sRGB',
      '-alpha',
      'off',
      ...flip,
      '-filter',
      'Triangle',
      '-resize',
      size,
      `PNG24:${normalPng}`,
    ]);
    maps.push({ name: 'normal', png: normalPng, srgb: false, uastc: true });
  } else if (recipe.normalFromColor) {
    // No scanned normal: the colour's relief, derived at the shipped size.
    const normalPng = join(work, 'normal.png');
    writeRgb(normalFromColor(readRgb(colorPng), recipe.normalFromColor), normalPng);
    maps.push({ name: 'normal', png: normalPng, srgb: false, uastc: true });
  }
  if (recipe.recentreNormal) {
    const normalMap = maps.find((m) => m.name === 'normal');
    if (normalMap) {
      const image = readRgb(normalMap.png);
      const { slope } = recentreNormal(image);
      writeRgb(image, normalMap.png);
      log(`${source.id}: normal recentred by slope ${slope.map((v) => v.toFixed(3)).join(', ')}`);
    }
  }
  if (!roughness && recipe.roughnessFromColor) {
    roughness = join(work, 'roughness-derived.png');
    writeRgb(roughnessFromColor(readRgb(colorPng), ...recipe.roughnessFromColor), roughness);
  }
  if (roughness || ao || metal) {
    // ORM: R = ambient occlusion, G = roughness, B = metalness (glTF layout,
    // read by three's aoMap / roughnessMap / metalnessMap).
    const channel = (path: string | null, fill: string, out: string) => {
      // Data maps: every step tagged sRGB so ImageMagick never re-encodes values.
      if (path)
        convert([
          path,
          '-strip',
          '-set',
          'colorspace',
          'sRGB',
          '-channel',
          'R',
          '-separate',
          '+channel',
          '-filter',
          'Triangle',
          '-resize',
          size,
          out,
        ]);
      else
        convert([
          '-size',
          `${recipe.size}x${recipe.size}`,
          `xc:${fill}`,
          '-set',
          'colorspace',
          'sRGB',
          out,
        ]);
      return out;
    };
    const r = channel(ao, 'white', join(work, 'r.png')),
      g = channel(roughness, 'gray50', join(work, 'g.png')),
      b = channel(metal, 'black', join(work, 'b.png'));
    const ormPng = join(work, 'orm.png');
    convert([r, g, b, '-set', 'colorspace', 'sRGB', '-combine', '-strip', `PNG24:${ormPng}`]);
    maps.push({ name: 'orm', png: ormPng, srgb: false, uastc: false });
  }
  const files: ShippedFile[] = [];
  for (const map of maps) {
    const base = `assets/third-party/${sourceDirectory(source)}/${source.id}_${map.name}`;
    const webp = join(work, `${map.name}.webp`);
    convert([
      map.png,
      '-define',
      'webp:method=6',
      '-quality',
      map.name === 'normal' ? '92' : '88',
      webp,
    ]);
    files.push(
      writeShipped(`${base}.webp`, new Uint8Array(readFileSync(webp)), {
        role: map.name,
        format: 'webp',
        width: recipe.size,
        height: recipe.size,
        colorSpace: map.srgb ? 'srgb' : 'linear',
      }),
    );
    if (toktx) {
      const ktx = join(work, `${map.name}.ktx2`);
      const encode = map.uastc
        ? ['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.25', '--zcmp', '18']
        : ['--encode', 'etc1s', '--clevel', '4', '--qlevel', '200'];
      execFileSync(
        toktx.command,
        [
          '--t2',
          '--genmipmap',
          '--assign_oetf',
          map.srgb ? 'srgb' : 'linear',
          '--target_type',
          'RGB',
          ...encode,
          ktx,
          map.png,
        ],
        { env: toktx.env, stdio: 'inherit' },
      );
      files.push(
        writeShipped(`${base}.ktx2`, new Uint8Array(readFileSync(ktx)), {
          role: map.name,
          format: 'ktx2',
          width: recipe.size,
          height: recipe.size,
          colorSpace: map.srgb ? 'srgb' : 'linear',
        }),
      );
    }
    log(
      `${source.id} ${map.name}: ${files
        .filter((f) => f.role === map.name)
        .map((f) => `${f.format} ${(f.bytes / 1024).toFixed(0)} KB`)
        .join(', ')}`,
    );
  }
  // Linear means a shader normalises by (TextureSetInfo.meanColor).
  const meanColor = meanLinear(readRgb(colorPng));
  const ormMap = maps.find((m) => m.name === 'orm');
  const meanRoughness = ormMap ? meanChannel(readRgb(ormMap.png), 1) : undefined;
  rmSync(work, { recursive: true, force: true });
  return {
    files,
    texture: {
      metres: recipe.metres,
      normalConvention: 'gl' as const,
      meanColor,
      ...(meanRoughness !== undefined ? { meanRoughness } : {}),
    },
  };
}

// ------------------------------------------------------------------ credits
function creditsText(assets: ShippedAsset[]) {
  const lines = [
    'APEX — third-party assets shipped with this application',
    '',
    'Generated by scripts/assets/build-third-party.ts from assets/third-party/sources.json.',
    'Everything else in the application is original work of this repository.',
    '',
  ];
  for (const asset of assets) {
    const licence = LICENCE_INFO[asset.licence];
    lines.push(`${asset.title} (${asset.kind})`);
    lines.push(`  ${asset.attribution}`);
    lines.push(`  Licence: ${licence.name} — ${licence.url}`);
    lines.push(`  Source: ${asset.sourceUrl}`);
    if (asset.homepage) lines.push(`  Original: ${asset.homepage}`);
    lines.push(`  Files: ${asset.files.map((f) => f.path.split('/').pop()).join(', ')}`);
    lines.push('');
  }
  return new TextEncoder().encode(lines.join('\n'));
}

// ------------------------------------------------------------------ main
function copyTranscoder() {
  const source = join(ROOT, 'node_modules/three/examples/jsm/libs/basis');
  const target = join(PUBLIC, 'assets/basis');
  mkdirSync(target, { recursive: true });
  for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm'])
    copyFileSync(join(source, name), join(target, name));
}

async function main() {
  const register = readRegister(ROOT);
  const problems = validateRegister(register);
  if (problems.length) throw new Error(`Invalid register:\n${problems.join('\n')}`);
  if (argv.includes('--check')) {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, MANIFEST_PATH), 'utf8'),
    ) as ThirdPartyManifest;
    const audit = auditShipment(ROOT, manifest);
    for (const e of audit.errors) console.error('INVALID', e);
    log(
      `${manifest.assets.length} assets, ${(audit.totalBytes / 1048576).toFixed(2)} MB of ${(manifest.budgetBytes / 1048576).toFixed(0)} MB budget`,
    );
    if (audit.errors.length) process.exitCode = 1;
    return;
  }
  const tools = await loadTools(option('tools'));
  const toktx = findToktx();
  log(toktx ? `toktx ${toktx.version}` : 'toktx not found: textures ship WebP only');
  const only = (option('only') ?? '').split(',').filter(Boolean);
  const previous = existsSync(join(ROOT, MANIFEST_PATH))
    ? (JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8')) as ThirdPartyManifest)
    : null;
  const assets: ShippedAsset[] = [];
  for (const source of register.sources) {
    const kept = previous?.assets.find((a) => a.id === source.id);
    if (only.length && !only.includes(source.id)) {
      if (kept) assets.push(kept);
      else log(`${source.id} skipped (--only) and not built before: left out of this manifest`);
      continue;
    }
    // A rebuilt asset replaces its whole directory.
    rmSync(join(PUBLIC, 'assets/third-party', sourceDirectory(source)), {
      recursive: true,
      force: true,
    });
    const common = {
      id: source.id,
      kind: source.kind,
      ...(source.area ? { area: source.area } : {}),
      title: source.title,
      author: source.author,
      licence: source.licence,
      attribution: source.attribution,
      sourceUrl: source.files[0].url,
      ...(source.homepage ? { homepage: source.homepage } : {}),
    };
    if (source.recipe.type === 'hdri')
      assets.push({ ...common, ...(await buildHdri(source, source.recipe, tools)) });
    else assets.push({ ...common, ...buildPbr(source, source.recipe, toktx) });
  }
  // Directories of assets no longer in the register are removed.
  const shipped = new Set(assets.map((a) => sourceDirectory(a)));
  const groups = new Set(['hdri', 'texture', 'mesh', ...assets.map((a) => a.area ?? a.kind)]);
  for (const group of groups) {
    const dir = join(PUBLIC, 'assets/third-party', group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir))
      if (!shipped.has(`${group}/${name}`))
        rmSync(join(dir, name), { recursive: true, force: true });
  }
  const credits = writeShipped('assets/third-party/CREDITS.txt', creditsText(assets), {
    role: 'credits',
    format: 'text',
  });
  copyTranscoder();
  const total = [...assets.flatMap((a) => a.files), credits].reduce((s, f) => s + f.bytes, 0);
  const manifest: ThirdPartyManifest = {
    version: 1,
    budgetBytes: register.budgetBytes,
    totalBytes: total,
    tools: {
      ...tools.versions,
      ...(toktx ? { toktx: toktx.version } : {}),
      ...(imageMagick() ? { imagemagick: imageMagick()!.replace(/^Version: /, '') } : {}),
    },
    assets,
    documents: [credits],
  };
  writeFileSync(join(ROOT, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n');
  const audit = auditShipment(ROOT, manifest);
  for (const e of audit.errors) console.error('INVALID', e);
  if (audit.errors.length) process.exitCode = 1;
  log(
    `${assets.length} assets, ${(total / 1048576).toFixed(2)} MB of ${(register.budgetBytes / 1048576).toFixed(0)} MB budget -> ${relative(ROOT, join(ROOT, SHIPPED_ROOT))}`,
  );
}

await main();
