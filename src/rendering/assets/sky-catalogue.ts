import type { VenueTheme } from '../../simulation/circuit-catalogue/venue-data.ts';
import type { LightingMode } from '../sky-light.ts';

/**
 * Which photographed sky (CC0 HDRIs, assets/third-party/sources.json) stands
 * over which venue, lighting and weather.
 *
 * Skies were chosen for a clean horizon: a photo is drawn at infinity, so
 * anything near the photographer (a hillside, a tree, a building) would stand
 * over the circuit as a giant. Only distant ridges, tree lines and rocks
 * (scale-free) rise above the horizon in the shipped set. Pure data and arithmetic: no
 * three.js objects, so the mapping is unit-tested in node.
 *
 * A venue's landscape picks a palette. Each lighting has a ramp of skies over
 * the simulated cloud cover; the visible dome and every PMREM bin crossfade
 * between the two neighbouring stops (a cover change is continuous and the
 * weather timeline never jumps a sky).
 */
export type SkyPalette = 'green' | 'alpine' | 'coast' | 'city' | 'flat' | 'arid' | 'desert';

export interface SkyStop {
  /** Third-party manifest id of the HDRI. */
  id: string;
  /** Cloud cover at which this sky is shown alone. */
  cover: number;
  /** Radiance gain over the physical dome it replaces (default 1): a city's
   * low cloud glows above the near-black floodlit-venue night. */
  gain?: number;
}

const ramp = (...stops: [string, number, number?][]): readonly SkyStop[] =>
  Object.freeze(
    stops.map(([id, cover, gain]) => Object.freeze(gain ? { id, cover, gain } : { id, cover })),
  );

/** Day ramps: clear (cover <= 0.2) -> fair-weather cloud (0.45) -> overcast
 * (0.72) -> rain cloud and mist (>= 0.92). The weather presets sit at 0.12
 * (clear), 0.16-0.95 (changeable) and 0.95 (heavy rain). Green, city and flat
 * country open under broken cumulus (the sun out of shot): no clear-sky photo
 * with a high sun and a clean horizon was available for them. */
const day = (clear: string, cloudy: string, overcast: string) =>
  ramp(
    ...(clear === cloudy ? [] : [[clear, 0.2] as [string, number]]),
    [cloudy, 0.45],
    [overcast, 0.72],
    ['kloppenheim-01', 0.92],
  );
/** Golden hour: a clear and a broken-cloud evening, then the day's overcast. */
const golden = (clear: string, overcast: string) =>
  ramp([clear, 0.25], ['table-mountain-1', 0.5], [overcast, 0.8], ['kloppenheim-01', 0.95]);
/** Night: moonlit when clear, a low ceiling lit by distant towns when not. */
const NIGHT_RURAL = ramp(['kloppenheim-02', 0.4, 1.5], ['kloppenheim-04', 0.7, 2]);
const NIGHT_URBAN = ramp(['kloppenheim-04', 0, 4]);

export const SKY_RAMPS: Readonly<
  Record<SkyPalette, Readonly<Record<LightingMode, readonly SkyStop[]>>>
> = Object.freeze({
  green: {
    day: day('rural-landscape', 'rural-landscape', 'waterbuck-trail'),
    sunset: golden('table-mountain-1', 'waterbuck-trail'),
    night: NIGHT_RURAL,
  },
  alpine: {
    day: day('kiara-5-noon', 'rural-landscape', 'winter-lake-01'),
    sunset: golden('table-mountain-1', 'winter-lake-01'),
    night: NIGHT_RURAL,
  },
  coast: {
    day: day('kiara-5-noon', 'rural-landscape', 'waterbuck-trail'),
    sunset: golden('table-mountain-1', 'waterbuck-trail'),
    night: NIGHT_RURAL,
  },
  city: {
    day: day('rural-landscape', 'rural-landscape', 'mud-road'),
    sunset: golden('table-mountain-1', 'mud-road'),
    night: NIGHT_URBAN,
  },
  flat: {
    day: day('rural-landscape', 'rural-landscape', 'mud-road'),
    sunset: golden('syferfontein-0d-clear', 'mud-road'),
    night: NIGHT_RURAL,
  },
  arid: {
    day: day('kiara-5-noon', 'quarry-02', 'waterbuck-trail'),
    sunset: golden('kiara-8-sunset', 'waterbuck-trail'),
    night: NIGHT_RURAL,
  },
  desert: {
    day: day('goegap', 'quarry-02', 'mud-road'),
    sunset: golden('kiara-8-sunset', 'mud-road'),
    night: NIGHT_RURAL,
  },
});

/** Landscape of every venue theme (catalogue and off-road venues). */
export const THEME_PALETTE: Readonly<Record<VenueTheme, SkyPalette>> = Object.freeze({
  parkland: 'green',
  forest: 'green',
  airfield: 'flat',
  hills: 'green',
  'harbour-street': 'coast',
  prairie: 'flat',
  'neon-city': 'city',
  alpine: 'alpine',
  oval: 'flat',
  desert: 'desert',
  'coastal-cliff': 'coast',
  dockyard: 'city',
  motocross: 'green',
  stadium: 'city',
  rallycross: 'green',
  'forest-stage': 'green',
  'tuscan-hills': 'green',
  'island-coast': 'coast',
  heath: 'green',
  sierra: 'arid',
  'urban-bowl': 'city',
  highland: 'alpine',
  'golden-hills': 'arid',
  dunes: 'desert',
  'night-desert': 'desert',
  'caspian-city': 'city',
  'bay-city': 'city',
  'salt-flat': 'flat',
});
/** The original circuits (no catalogue theme). */
const CIRCUIT_PALETTE: Readonly<Record<string, SkyPalette>> = Object.freeze({
  aurel: 'green',
  vellamar: 'coast',
});
/** The festival region (Port Ilse: a harbour town in green hills). */
export const FESTIVAL_PALETTE: SkyPalette = 'coast';

export function skyPaletteFor(circuit: {
  id: string;
  catalogue?: { theme: VenueTheme } | null;
}): SkyPalette {
  if (circuit.catalogue) return THEME_PALETTE[circuit.catalogue.theme] ?? 'green';
  return CIRCUIT_PALETTE[circuit.id] ?? 'green';
}

export interface SkyBlend {
  a: string;
  b: string;
  /** Share of `b` (0 when one sky stands alone). */
  weight: number;
}
/** The two neighbouring skies of a ramp at `cover`, linearly crossfaded. */
export function skyBlend(stops: readonly SkyStop[], cloud: number): SkyBlend {
  if (!stops.length) throw new Error('Empty sky ramp');
  const cover = Number.isFinite(cloud) ? Math.min(1, Math.max(0, cloud)) : 0;
  if (cover <= stops[0].cover) return { a: stops[0].id, b: stops[0].id, weight: 0 };
  for (let i = 1; i < stops.length; i++) {
    const lo = stops[i - 1],
      hi = stops[i];
    if (cover <= hi.cover) {
      const weight = (cover - lo.cover) / Math.max(1e-6, hi.cover - lo.cover);
      return weight <= 0 || lo.id === hi.id
        ? { a: lo.id, b: lo.id, weight: 0 }
        : weight >= 1
          ? { a: hi.id, b: hi.id, weight: 0 }
          : { a: lo.id, b: hi.id, weight };
    }
  }
  const last = stops[stops.length - 1];
  return { a: last.id, b: last.id, weight: 0 };
}

/** Rotation (radians, about +y) that puts the photo's measured sun azimuth
 * (degrees, atan2(z, x)) under the scene's key light direction. The sky
 * shader samples the photo at azimuth atan2(z, x) - rotation. */
export function skyRotation(photoSunAzimuthDeg: number, sun: { x: number; z: number }) {
  const scene = Math.atan2(sun.z, sun.x),
    photo = (photoSunAzimuthDeg * Math.PI) / 180;
  const r = scene - photo;
  return Math.atan2(Math.sin(r), Math.cos(r));
}
