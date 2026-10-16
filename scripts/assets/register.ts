/**
 * Third-party source register (assets/third-party/sources.json) and the
 * shipped-tree audit shared by the asset build, `validate:content` and the
 * unit tests. Node only (file system).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  isAllowedLicence,
  LICENCE_INFO,
  type Licence,
} from '../../src/rendering/assets/licences.ts';
import type { ThirdPartyKind, ThirdPartyManifest } from '../../src/rendering/assets/third-party.ts';
import { brandWordIn } from './brands.ts';
import { PROTECTED_NAMES } from '../../src/simulation/content-validation.ts';
import { validateVegetationRecipe, type VegetationRecipe } from './vegetation/recipe.ts';

export interface SourceFile {
  url: string;
  sha256: string;
  bytes: number;
  /** Member to extract from a .tar.gz archive. */
  member?: string;
  /** Texture role (color, normal, roughness, ao, metalness). */
  role?: string;
}
export interface HdriRecipe {
  type: 'hdri';
  /** Largest channel kept, in dome-normalised units (sun cores are clipped). */
  clamp: number;
  /** Shipped widths (2:1 equirectangular). */
  variants: number[];
  /** JPEG quality of the base and gain images. */
  quality: number;
  /** Elevation (degrees) below which the photo shows land near the
   * photographer; the sky shader draws haze there instead (0 keeps the whole
   * upper hemisphere, e.g. distant mountain ranges). */
  skyline: number;
}
export interface PbrRecipe {
  type: 'pbr';
  /** Shipped square size (px). */
  size: number;
  /** Normal map convention of the source: 'dx' is converted to OpenGL. */
  normal: 'gl' | 'dx';
  /** Metres one repeat covers. */
  metres: number;
  /** Subtract the mean slope of the normal map (a tileable height field has
   * none; old exports carry a tilt that would lean the whole surface). */
  recentreNormal?: boolean;
  /** Re-synthesise a seamless tile from source regions (texture-ops.ts
   * `synthesizeTile`): drops features that must not repeat (cracks) and makes
   * a non-tileable crop tile. Every map of the set gets the same patches. */
  synth?: {
    /** Output tile size before the final resize (px). */
    size: number;
    /** Patch window (px); patches overlap by half. */
    patch: number;
    /** Source rectangles [x, y, width, height] (px) patches are drawn from. */
    regions: [number, number, number, number][];
    seed: number;
  };
  /** No normal map in the source: derive one from the colour's luminance
   * (treated as relief) with this slope gain. */
  normalFromColor?: number;
  /** No roughness map in the source: roughness = base - gain * (luminance - mean). */
  roughnessFromColor?: [number, number];
}
export interface SourceEntry {
  id: string;
  kind: ThirdPartyKind;
  /** Department namespace: ships under public/assets/third-party/<area>/<id>/
   * instead of <kind>/<id>/ (e.g. 'ground' for the track and terrain sets). */
  area?: string;
  title: string;
  author: string;
  licence: Licence;
  attribution: string;
  homepage?: string;
  licenceEvidence: string;
  notes?: string;
  files: SourceFile[];
  recipe: HdriRecipe | PbrRecipe | VegetationRecipe;
}
export interface SourceRegister {
  version: 1;
  budgetBytes: number;
  note?: string;
  sources: SourceEntry[];
}

export const REGISTER_PATH = 'assets/third-party/sources.json';
/** Department fragments of the register (`{ "sources": [...] }` per file),
 * appended in file-name order after REGISTER_PATH's own sources. */
export const REGISTER_FRAGMENTS = 'assets/third-party/sources';
export const SHIPPED_ROOT = 'public/assets/third-party';
export const MANIFEST_PATH = 'src/rendering/assets/third-party-manifest.json';
/** Hosts a source may be fetched from; each URL must pin a commit or an
 * immutable object (the SHA-256 pins the bytes either way). */
export const SOURCE_HOSTS = Object.freeze([
  'raw.githubusercontent.com',
  'media.githubusercontent.com',
  'github.com',
  'storage.googleapis.com',
  'registry.npmjs.org',
  's3.amazonaws.com',
]);
const PINNED_COMMIT = /\/[0-9a-f]{40}\//;

const protectedPattern = new RegExp(
  `(^|[^a-z0-9])(${PROTECTED_NAMES.map((n) => n.replace(/[-.]/g, '\\$&')).join('|')})([^a-z0-9]|$)`,
);
/** Brand or protected real-world names in a text, for asset metadata. */
export function forbiddenNameIn(text: string) {
  const brand = brandWordIn(text);
  if (brand) return brand;
  const match = protectedPattern.exec(text.toLowerCase());
  return match ? match[2] : null;
}

export function readRegister(root: string): SourceRegister {
  const register = JSON.parse(readFileSync(join(root, REGISTER_PATH), 'utf8')) as SourceRegister;
  const fragments = join(root, REGISTER_FRAGMENTS);
  if (existsSync(fragments))
    for (const name of readdirSync(fragments)
      .filter((n) => n.endsWith('.json'))
      .sort()) {
      const fragment = JSON.parse(readFileSync(join(fragments, name), 'utf8')) as {
        sources: SourceEntry[];
      };
      register.sources.push(...fragment.sources);
    }
  return register;
}
/** Shipped directory of a source, relative to the third-party root. */
export function sourceDirectory(source: Pick<SourceEntry, 'id' | 'kind' | 'area'>) {
  return `${source.area ?? source.kind}/${source.id}`;
}

/** Register rules: licences, attribution, pinned sources, unique ids, no brands. */
export function validateRegister(register: SourceRegister): string[] {
  const errors: string[] = [];
  if (register.version !== 1) errors.push('register: unknown version');
  if (!(register.budgetBytes > 0)) errors.push('register: budgetBytes must be positive');
  const ids = new Set<string>();
  for (const s of register.sources) {
    const at = `source ${s.id}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) errors.push(`${at}: id must be kebab-case`);
    if (ids.has(s.id)) errors.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!['hdri', 'texture', 'mesh', 'vegetation'].includes(s.kind)) errors.push(`${at}: unknown kind ${s.kind}`);
    if (
      s.area !== undefined &&
      (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.area) || ['hdri', 'texture', 'mesh', 'vegetation'].includes(s.area))
    )
      errors.push(`${at}: area must be a kebab-case name other than a kind`);
    if (!isAllowedLicence(s.licence)) errors.push(`${at}: licence ${s.licence} is not allowed`);
    else if (LICENCE_INFO[s.licence].attribution && !s.attribution.includes(s.author))
      errors.push(`${at}: ${s.licence} attribution must name the author`);
    if (!s.title || !s.author || !s.attribution)
      errors.push(`${at}: title, author and attribution are required`);
    if (!s.licenceEvidence) errors.push(`${at}: licence evidence is required`);
    for (const text of [s.id, s.title, s.author, s.attribution, s.notes ?? ''])
      if (forbiddenNameIn(text))
        errors.push(`${at}: "${text}" contains "${forbiddenNameIn(text)}"`);
    if (!s.files.length) errors.push(`${at}: no source files`);
    for (const f of s.files) {
      let url: URL | null = null;
      try {
        url = new URL(f.url);
      } catch {
        errors.push(`${at}: invalid URL ${f.url}`);
      }
      if (url && url.protocol !== 'https:') errors.push(`${at}: ${f.url} is not https`);
      if (url && !SOURCE_HOSTS.includes(url.hostname))
        errors.push(`${at}: ${url.hostname} is not an approved source host`);
      if (url && /githubusercontent\.com$/.test(url.hostname) && !PINNED_COMMIT.test(url.pathname))
        errors.push(`${at}: ${f.url} must pin a commit`);
      if (!/^[0-9a-f]{64}$/.test(f.sha256)) errors.push(`${at}: ${f.url} needs a SHA-256`);
      if (!(f.bytes > 0)) errors.push(`${at}: ${f.url} needs its size`);
      if (forbiddenNameIn(f.url))
        errors.push(`${at}: ${f.url} contains "${forbiddenNameIn(f.url)}"`);
    }
    if (s.recipe.type === 'hdri' && s.kind !== 'hdri')
      errors.push(`${at}: hdri recipe on a ${s.kind}`);
    if (s.recipe.type === 'hdri' && !(s.recipe.skyline >= 0 && s.recipe.skyline <= 15))
      errors.push(`${at}: skyline must be 0-15 degrees`);
    if (s.recipe.type === 'pbr' && s.kind !== 'texture')
      errors.push(`${at}: pbr recipe on a ${s.kind}`);
    if (s.recipe.type === 'pbr' && s.recipe.synth) {
      const synth = s.recipe.synth;
      if (!(synth.patch >= 16 && synth.size % (synth.patch / 2) === 0))
        errors.push(`${at}: synth size must be a multiple of half the patch`);
      for (const [, , w, h] of synth.regions)
        if (w < synth.patch || h < synth.patch)
          errors.push(`${at}: synth region smaller than the patch`);
    }
    if (s.recipe.type === 'vegetation') {
      if (s.kind !== 'vegetation') errors.push(`${at}: vegetation recipe on a ${s.kind}`);
      for (const e of validateVegetationRecipe(s.recipe)) errors.push(`${at}: ${e}`);
    }
  }
  return errors;
}

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * Audit the shipped tree against the manifest: every file under
 * public/assets/third-party is listed with matching size and SHA-256 and
 * every listed file exists; licences, attribution and names follow the
 * policy; the total stays within the budget. Returns errors and the total.
 */
export function auditShipment(root: string, manifest: ThirdPartyManifest, hash = true) {
  const errors: string[] = [];
  const listed = new Map<string, { bytes: number; sha256: string }>();
  for (const asset of manifest.assets) {
    const at = `asset ${asset.id}`;
    if (!isAllowedLicence(asset.licence))
      errors.push(`${at}: licence ${asset.licence} is not allowed`);
    else if (LICENCE_INFO[asset.licence].attribution && !asset.attribution.trim())
      errors.push(`${at}: ${asset.licence} requires attribution`);
    if (!asset.attribution.includes(asset.author))
      errors.push(`${at}: attribution must name ${asset.author}`);
    if (!asset.sourceUrl.startsWith('https://')) errors.push(`${at}: source URL missing`);
    for (const text of [asset.id, asset.title, asset.author, asset.attribution, asset.sourceUrl])
      if (forbiddenNameIn(text))
        errors.push(`${at}: "${text}" contains "${forbiddenNameIn(text)}"`);
    if (!asset.files.length) errors.push(`${at}: ships no files`);
    for (const file of asset.files) listed.set(file.path, file);
  }
  for (const file of manifest.documents) listed.set(file.path, file);
  let total = 0;
  for (const [path, file] of listed) {
    if (!path.startsWith('assets/third-party/'))
      errors.push(`${path}: outside assets/third-party/`);
    if (forbiddenNameIn(path)) errors.push(`${path}: contains "${forbiddenNameIn(path)}"`);
    const full = join(root, 'public', path);
    if (!existsSync(full)) {
      errors.push(`${path}: listed but missing`);
      continue;
    }
    const size = statSync(full).size;
    total += size;
    if (size !== file.bytes) errors.push(`${path}: ${size} bytes, manifest says ${file.bytes}`);
    if (hash && sha256(readFileSync(full)) !== file.sha256)
      errors.push(`${path}: SHA-256 mismatch`);
  }
  for (const full of listFiles(join(root, SHIPPED_ROOT))) {
    const path = relative(join(root, 'public'), full).replaceAll('\\', '/');
    if (!listed.has(path)) errors.push(`${path}: shipped but not in the manifest`);
  }
  if (total !== manifest.totalBytes)
    errors.push(`manifest totalBytes ${manifest.totalBytes} differs from the files (${total})`);
  if (total > manifest.budgetBytes)
    errors.push(`third-party assets ${total} bytes exceed the ${manifest.budgetBytes} byte budget`);
  return { errors, totalBytes: total };
}
