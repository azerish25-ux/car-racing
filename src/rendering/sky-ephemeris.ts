import * as T from 'three';

/**
 * Live sky ephemeris: where the sun, the moon and the stars stand for a real
 * observer at a real instant.
 *
 * Low-precision almanac formulas (Meeus, "Astronomical Algorithms", ch. 25 and
 * 47 truncated; the Astronomical Almanac's sun): the sun to ~0.01 degrees, the
 * moon to ~0.3 degrees with topocentric parallax, refraction near the horizon
 * (Bennett). Pure functions of the instant and the observer; the browser
 * helpers at the end only find the observer.
 *
 * World frame: +X east, +Y up, -Z north. The circuit's own layout has no
 * surveyed north; this convention is fixed, so a given instant and place
 * always give the same sky.
 */
export interface Observer {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive. */
  longitude: number;
  /** Where the position came from (device fix, stored fix or time zone). */
  source: 'device' | 'stored' | 'timezone';
}

const RAD = Math.PI / 180;
const wrap = (deg: number) => ((deg % 360) + 360) % 360;

/** Days since J2000.0 (2000-01-01 12:00 TT, UT here: 70 s is 0.01 degrees). */
export function daysSinceJ2000(date: Date) {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new Error('Invalid ephemeris instant');
  return ms / 86400000 + 2440587.5 - 2451545;
}

/** Local sidereal angle, degrees (Greenwich mean sidereal + east longitude). */
export function localSiderealDegrees(d: number, longitude: number) {
  return wrap(280.46061837 + 360.98564736629 * d + longitude);
}

/** Obliquity of the ecliptic, degrees. */
const obliquity = (d: number) => 23.439 - 0.00000036 * d;

/** Ecliptic longitude/latitude (degrees) to an equatorial unit vector
 * (x toward the vernal equinox, z toward the north celestial pole). */
function eclipticToEquatorial(lon: number, lat: number, d: number) {
  const e = obliquity(d) * RAD,
    l = lon * RAD,
    b = lat * RAD;
  return new T.Vector3(
    Math.cos(b) * Math.cos(l),
    Math.cos(e) * Math.cos(b) * Math.sin(l) - Math.sin(e) * Math.sin(b),
    Math.sin(e) * Math.cos(b) * Math.sin(l) + Math.cos(e) * Math.sin(b),
  );
}

/** Geocentric sun, equatorial unit vector. */
export function sunEquatorial(d: number) {
  const g = wrap(357.529 + 0.98560028 * d) * RAD,
    q = wrap(280.459 + 0.98564736 * d);
  return eclipticToEquatorial(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g), 0, d);
}

/** Geocentric moon: equatorial unit vector and distance, km. */
export function moonEquatorial(d: number) {
  const L = wrap(218.316 + 13.176396 * d),
    Mm = wrap(134.963 + 13.064993 * d) * RAD,
    Ms = wrap(357.529 + 0.98560028 * d) * RAD,
    D = wrap(297.85 + 12.190749 * d) * RAD,
    F = wrap(93.272 + 13.22935 * d) * RAD;
  const lon =
    L +
    6.289 * Math.sin(Mm) +
    1.274 * Math.sin(2 * D - Mm) +
    0.658 * Math.sin(2 * D) +
    0.214 * Math.sin(2 * Mm) -
    0.186 * Math.sin(Ms) -
    0.114 * Math.sin(2 * F);
  const lat =
    5.128 * Math.sin(F) +
    0.28 * Math.sin(Mm + F) +
    0.277 * Math.sin(Mm - F) +
    0.173 * Math.sin(2 * D - F);
  return {
    direction: eclipticToEquatorial(lon, lat, d),
    distance: 385001 - 20905 * Math.cos(Mm),
  };
}

/** Rotation from the equatorial frame to the world (east, up, south) frame of
 * an observer at `latitude` under local sidereal angle `lst` (degrees). */
export function equatorialToWorld(latitude: number, lst: number, out = new T.Matrix3()) {
  const p = latitude * RAD,
    sp = Math.sin(p),
    cp = Math.cos(p),
    s = Math.sin(lst * RAD),
    c = Math.cos(lst * RAD);
  // Rows: east, up, -north (hour angle H = lst - right ascension).
  return out.set(-s, c, 0, cp * c, cp * s, sp, sp * c, sp * s, -cp);
}

/** Bennett's atmospheric refraction lifts a body near the horizon (apparent
 * minus true altitude), applied to a world unit vector in place. */
function refract(v: T.Vector3) {
  const h = Math.asin(Math.min(1, Math.max(-1, v.y))) / RAD;
  if (h < -1.5) return v;
  const lift = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60;
  const a = (h + Math.max(0, lift)) * RAD,
    horizontal = Math.hypot(v.x, v.z) || 1;
  return v.set((v.x / horizontal) * Math.cos(a), Math.sin(a), (v.z / horizontal) * Math.cos(a));
}

export interface SkyEphemeris {
  /** Apparent sun, world unit vector (may be below the horizon). */
  sun: T.Vector3;
  /** Apparent topocentric moon, world unit vector. */
  moon: T.Vector3;
  /** Illuminated fraction of the moon's disc, 0 new .. 1 full. */
  moonIllumination: number;
  /** World to equatorial rotation (the star field's orientation). */
  worldToCelestial: T.Matrix3;
  /** Sun altitude, degrees. */
  sunAltitude: number;
}

const EARTH_RADIUS_KM = 6371;
/** The sky over `observer` at `date`. */
export function skyEphemeris(date: Date, observer: Pick<Observer, 'latitude' | 'longitude'>) {
  const { latitude, longitude } = observer;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new Error('Invalid observer position');
  const d = daysSinceJ2000(date),
    toWorld = equatorialToWorld(latitude, localSiderealDegrees(d, longitude));
  const sunGeo = sunEquatorial(d).applyMatrix3(toWorld),
    lunar = moonEquatorial(d),
    moonGeo = lunar.direction.clone().applyMatrix3(toWorld);
  // Topocentric moon: the observer stands one earth radius above the centre.
  const moon = moonGeo.clone().multiplyScalar(lunar.distance);
  moon.y -= EARTH_RADIUS_KM;
  moon.normalize();
  const elongation = Math.acos(Math.min(1, Math.max(-1, sunGeo.dot(moonGeo))));
  const sun = refract(sunGeo.clone());
  refract(moon);
  return {
    sun,
    moon,
    moonIllumination: (1 - Math.cos(elongation)) / 2,
    worldToCelestial: toWorld.clone().transpose(),
    sunAltitude: Math.asin(Math.min(1, Math.max(-1, sun.y))) / RAD,
  } satisfies SkyEphemeris;
}

/**
 * The circuit lighting that a real sun altitude calls for: daylight above
 * 15 degrees, the golden hour down to sunset (the upper limb on the horizon,
 * -0.83 degrees), floodlit night below. The golden-hour key never sinks
 * below `minimumKeyAltitude`, so shadows and the disc stay above the ground
 * through the last minutes before sunset.
 */
export const LIVE_SKY = Object.freeze({
  dayAltitude: 15,
  sunsetAltitude: -0.83,
  minimumKeyAltitude: 1.5,
  /** The scene sun only re-aims (atmosphere, cloud and shadow re-bake) when
   * the real sun has moved this far: about every 8 minutes. */
  stepDegrees: 2,
});
export function liveLightingMode(sunAltitude: number): 'day' | 'sunset' | 'night' {
  if (!Number.isFinite(sunAltitude)) throw new Error('Invalid sun altitude');
  return sunAltitude >= LIVE_SKY.dayAltitude
    ? 'day'
    : sunAltitude >= LIVE_SKY.sunsetAltitude
      ? 'sunset'
      : 'night';
}
/** The scene key's direction for a real sun (world unit vector) at the
 * length of the authored offsets, lifted to the minimum key altitude. */
export function liveKeyDirection(sun: T.Vector3, length: number, out = new T.Vector3()) {
  const min = Math.sin(LIVE_SKY.minimumKeyAltitude * RAD);
  out.copy(sun).normalize();
  if (out.y < min) {
    const horizontal = Math.hypot(out.x, out.z) || 1,
      c = Math.sqrt(1 - min * min);
    out.set((out.x / horizontal) * c, min, (out.z / horizontal) * c);
  }
  return out.multiplyScalar(length);
}

/** A fixed, representative sky for the preset lightings: the moon where the
 * preset's key stands, two days past first quarter, and the stars of a late
 * summer evening at 45 degrees north. Deterministic, as presets must be. */
export function presetCelestial(moon: T.Vector3) {
  const m = moon.clone().normalize();
  // Sun 120 degrees from the moon, behind and below it: a waxing gibbous.
  const side = new T.Vector3(0, 1, 0).cross(m).normalize();
  const sun = m
    .clone()
    .multiplyScalar(Math.cos(120 * RAD))
    .addScaledVector(side, Math.sin(120 * RAD))
    .normalize();
  return {
    moon: m,
    sun,
    worldToCelestial: equatorialToWorld(45, 300).transpose(),
  };
}

const STORAGE_KEY = 'apex.observer.v1';
/** A rough observer from the time zone alone: longitude from the UTC offset,
 * latitude from the hemisphere the zone name implies. */
export function timezoneObserver(
  offsetMinutes = new Date().getTimezoneOffset(),
  zone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      return '';
    }
  })(),
): Observer {
  const southern =
    /^(Australia|Antarctica|Pacific\/(Auckland|Fiji|Chatham|Tongatapu|Apia))|America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima)|Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone)|Indian\/(Mauritius|Reunion|Antananarivo)/.test(
      zone,
    );
  const longitude = Math.max(-180, Math.min(180, (-offsetMinutes / 60) * 15));
  return { latitude: southern ? -33 : 40, longitude, source: 'timezone' };
}
function validObserver(value: unknown): value is { latitude: number; longitude: number } {
  const v = value as { latitude?: unknown; longitude?: unknown } | null;
  return (
    !!v &&
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number' &&
    Math.abs(v.latitude) <= 90 &&
    Math.abs(v.longitude) <= 180
  );
}
/** The last device fix this browser stored, else the time-zone estimate. */
export function storedObserver(): Observer {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
    if (validObserver(value))
      return { latitude: value.latitude, longitude: value.longitude, source: 'stored' };
  } catch {
    // Storage blocked or corrupt: fall through to the time zone.
  }
  return timezoneObserver();
}
/** Ask the device for its position (the browser may prompt). Coarse accuracy
 * is plenty for a sky; resolves with the stored or time-zone observer when
 * the fix is refused, unavailable or slow. */
export function requestObserver(timeout = 10000): Promise<Observer> {
  const fallback = storedObserver();
  const geolocation = globalThis.navigator?.geolocation;
  if (!geolocation) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      ({ coords }) => {
        const observer: Observer = {
          latitude: Math.round(coords.latitude * 100) / 100,
          longitude: Math.round(coords.longitude * 100) / 100,
          source: 'device',
        };
        try {
          globalThis.localStorage?.setItem(
            STORAGE_KEY,
            JSON.stringify({ latitude: observer.latitude, longitude: observer.longitude }),
          );
        } catch {
          // A fix that cannot be stored still serves this session.
        }
        resolve(observer);
      },
      () => resolve(fallback),
      { enableHighAccuracy: false, maximumAge: 3600000, timeout },
    );
  });
}

/**
 * The naked-eye anchors of the star field: the brightest stars and the
 * asterisms people recognise (Orion, the Plough, Cassiopeia, the Southern
 * Cross), J2000 right ascension (hours), declination (degrees), visual
 * magnitude and B-V colour index (Yale Bright Star Catalogue, rounded).
 * Fainter stars are generated in the shader at the same sky density.
 */
export const BRIGHT_STARS: readonly (readonly [number, number, number, number])[] = [
  [6.752, -16.72, -1.46, 0.0], // Sirius
  [6.399, -52.7, -0.74, 0.15], // Canopus
  [14.66, -60.83, -0.27, 0.71], // Rigil Kentaurus
  [14.261, 19.18, -0.05, 1.23], // Arcturus
  [18.616, 38.78, 0.03, 0.0], // Vega
  [5.278, 46.0, 0.08, 0.8], // Capella
  [5.242, -8.2, 0.13, -0.03], // Rigel
  [7.655, 5.22, 0.34, 0.42], // Procyon
  [1.629, -57.24, 0.46, -0.16], // Achernar
  [5.919, 7.41, 0.5, 1.85], // Betelgeuse
  [14.064, -60.37, 0.61, -0.23], // Hadar
  [19.846, 8.87, 0.76, 0.22], // Altair
  [12.443, -63.1, 0.77, -0.24], // Acrux
  [4.599, 16.51, 0.86, 1.54], // Aldebaran
  [16.49, -26.43, 0.96, 1.83], // Antares
  [13.42, -11.16, 0.97, -0.23], // Spica
  [7.755, 28.03, 1.14, 1.0], // Pollux
  [22.961, -29.62, 1.16, 0.09], // Fomalhaut
  [20.69, 45.28, 1.25, 0.09], // Deneb
  [12.795, -59.69, 1.25, -0.23], // Mimosa
  [10.139, 11.97, 1.35, -0.11], // Regulus
  [6.977, -28.97, 1.5, -0.21], // Adhara
  [7.577, 31.89, 1.58, 0.03], // Castor
  [12.519, -57.11, 1.63, 1.59], // Gacrux
  [17.56, -37.1, 1.63, -0.22], // Shaula
  [5.419, 6.35, 1.64, -0.22], // Bellatrix
  [5.438, 28.61, 1.65, -0.13], // Elnath
  [9.22, -69.72, 1.68, 0.07], // Miaplacidus
  [5.604, -1.2, 1.69, -0.18], // Alnilam (Orion's belt)
  [5.679, -1.94, 1.77, -0.21], // Alnitak (Orion's belt)
  [5.533, -0.3, 2.23, -0.22], // Mintaka (Orion's belt)
  [5.796, -9.67, 2.09, -0.18], // Saiph
  [12.9, 55.96, 1.77, -0.02], // Alioth (Plough)
  [11.062, 61.75, 1.79, 1.07], // Dubhe (Plough)
  [13.792, 49.31, 1.86, -0.19], // Alkaid (Plough)
  [13.399, 54.93, 2.27, 0.02], // Mizar (Plough)
  [11.031, 56.38, 2.37, -0.02], // Merak (Plough)
  [11.897, 53.69, 2.44, 0.0], // Phecda (Plough)
  [12.257, 57.03, 3.31, 0.08], // Megrez (Plough)
  [2.53, 89.26, 1.98, 0.6], // Polaris
  [0.675, 56.54, 2.24, 1.17], // Schedar (Cassiopeia)
  [0.153, 59.15, 2.28, 0.34], // Caph (Cassiopeia)
  [0.945, 60.72, 2.47, -0.15], // Gamma Cassiopeiae
  [1.43, 60.24, 2.68, 0.13], // Ruchbah (Cassiopeia)
  [1.907, 63.67, 3.38, -0.1], // Segin (Cassiopeia)
  [12.252, -58.75, 2.79, -0.19], // Delta Crucis
  [3.405, 49.86, 1.79, 0.48], // Mirfak
  [8.159, -47.34, 1.83, -0.22], // Regor
  [6.378, -17.96, 1.98, -0.23], // Mirzam
  [2.12, 23.46, 2.0, 1.15], // Hamal
  [17.582, 12.56, 2.08, 0.15], // Rasalhague
  [0.14, 29.09, 2.06, -0.11], // Alpheratz
];

/** Equatorial unit vector of a catalogue star. */
export function starVector(raHours: number, decDegrees: number, out = new T.Vector3()) {
  const a = raHours * 15 * RAD,
    d = decDegrees * RAD;
  return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}

/** The live sky the dome draws (null: the preset's fixed sky). Set by the
 * LIVE lighting controller; read by the sky binding every frame. */
let current: SkyEphemeris | null = null;
export function setLiveCelestial(value: SkyEphemeris | null) {
  current = value;
}
export function liveCelestial() {
  return current;
}
