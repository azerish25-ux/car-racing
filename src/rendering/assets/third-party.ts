import manifestJson from './third-party-manifest.json' with { type: 'json' };
import { LICENCE_INFO, type Licence } from './licences.ts';
import type { VegetationInfo } from '../vegetation/format.ts';

/**
 * The shipped third-party asset manifest, written by
 * `scripts/assets/build-third-party.ts` from the source register
 * (`assets/third-party/sources.json`). Every file under
 * `public/assets/third-party/` is listed here with its size and SHA-256
 * (`tests/third-party-assets.test.ts`), with the licence, author and the
 * attribution the credits view shows.
 */
export type ThirdPartyKind = 'hdri' | 'texture' | 'mesh' | 'vegetation';

/** Ultra HDR layout of a shipped `.hdr.jpg`: the primary (SDR base) JPEG is
 * bytes [0, offset), the gain map JPEG [offset, end). The gain is scalar
 * (grey), half the base resolution, log2-encoded over [0, gainMax] with
 * gamma 1 and zero offsets: hdr = srgbToLinear(base) * 2^(gain * gainMax). */
export interface GainMapLayout {
  offset: number;
  width: number;
  height: number;
  gainMax: number;
}
export interface ShippedFile {
  /** Path relative to the application root (served from public/). */
  path: string;
  bytes: number;
  sha256: string;
  /** e.g. '4k', '2k' for skies; 'color', 'normal', 'orm' for texture sets. */
  role: string;
  format: 'ultrahdr' | 'ktx2' | 'webp' | 'jpeg' | 'png' | 'glb' | 'bin' | 'text';
  width?: number;
  height?: number;
  colorSpace?: 'srgb' | 'linear';
  gainMap?: GainMapLayout;
}
type Rgb = [number, number, number];
/** Measured on the source HDRI (scripts/assets/hdri.ts). Radiances are in the
 * shipped, normalised units: the dome's cosine-weighted mean luminance is 1. */
export interface HdriInfo {
  /** Brightest region (sun, moon or glow): atan2(z, x) azimuth and elevation, degrees. */
  sunAzimuth: number;
  sunElevation: number;
  sunColor: Rgb;
  /** Direct horizontal / diffuse sky irradiance of the source (0 under overcast). */
  sunToSky: number;
  domeMean: Rgb;
  horizonSunSide: Rgb;
  horizonAntiSun: Rgb;
  horizonMean: Rgb;
  zenith: Rgb;
  groundMean: Rgb;
  /** Source-to-shipped radiance scale and the shipped clamp (largest channel). */
  normalisation: number;
  clamp: number;
  /** Elevation (degrees) under which the photo's land is replaced by haze. */
  skyline: number;
  /** Reconstruction error of the shipped 4k file against the clamped source. */
  rmsStops: number;
}
export interface TextureSetInfo {
  /** Physical size one texture repeat covers (metres). */
  metres: number;
  normalConvention: 'gl';
}
export interface ShippedAsset {
  id: string;
  kind: ThirdPartyKind;
  title: string;
  author: string;
  licence: Licence;
  attribution: string;
  sourceUrl: string;
  homepage?: string;
  files: ShippedFile[];
  hdri?: HdriInfo;
  texture?: TextureSetInfo;
  /** Baked plant (scripts/assets/vegetation): sizes, cards, impostor layout. */
  vegetation?: VegetationInfo;
}
export interface ThirdPartyManifest {
  version: 1;
  budgetBytes: number;
  totalBytes: number;
  tools: Record<string, string>;
  assets: ShippedAsset[];
  /** Credits and licence texts shipped beside the assets. */
  documents: ShippedFile[];
}

export const THIRD_PARTY_ROOT = 'assets/third-party/';
export const thirdPartyManifest = manifestJson as unknown as ThirdPartyManifest;

const byId = new Map(thirdPartyManifest.assets.map((asset) => [asset.id, asset]));
export function thirdPartyAsset(id: string) {
  return byId.get(id) ?? null;
}

/** URL of a shipped file for fetch(): relative to the page (Vite base './'). */
export function assetUrl(path: string) {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}

export interface CreditLine {
  id: string;
  kind: ThirdPartyKind;
  title: string;
  author: string;
  licence: Licence;
  licenceName: string;
  licenceUrl: string;
  attribution: string;
  sourceUrl: string;
  homepage?: string;
}
/** Every shipped third-party asset with its attribution, grouped skies first. */
export function creditLines(manifest: ThirdPartyManifest = thirdPartyManifest): CreditLine[] {
  const order: Record<ThirdPartyKind, number> = { hdri: 0, texture: 1, mesh: 2, vegetation: 3 };
  return [...manifest.assets]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title))
    .map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      title: asset.title,
      author: asset.author,
      licence: asset.licence,
      licenceName: LICENCE_INFO[asset.licence].name,
      licenceUrl: LICENCE_INFO[asset.licence].url,
      attribution: asset.attribution,
      sourceUrl: asset.sourceUrl,
      homepage: asset.homepage,
    }));
}
