import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  analyseHdri,
  bakeBelowSkyline,
  compareHdr,
  direction,
  gainMapLevels,
  jpegImageSpans,
  normaliseHdri,
  reconstruct,
  sdrBase,
  type FloatImage,
} from '../scripts/assets/hdri.ts';
import { PhotoSky, PHOTO_SKY_VARIANT } from '../src/rendering/assets/photo-sky.ts';
import { createPhotoSkyUniforms } from '../src/rendering/assets/photo-sky-shader.ts';
import {
  FESTIVAL_PALETTE,
  SKY_RAMPS,
  THEME_PALETTE,
  skyBlend,
  skyPaletteFor,
  skyRotation,
} from '../src/rendering/assets/sky-catalogue.ts';
import { thirdPartyAsset } from '../src/rendering/assets/third-party.ts';
import { configureSky } from '../src/rendering/daylight.ts';
import { SUNSET_OFFSET, SUN_OFFSET } from '../src/rendering/sky-light.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Sky } from 'three/addons/objects/Sky.js';

const DEG = 180 / Math.PI;
const elevation = (v: T.Vector3) => Math.asin(v.clone().normalize().y) * DEG;

describe('sky catalogue', () => {
  it('every ramp names shipped HDRIs with increasing cover stops', () => {
    for (const [palette, modes] of Object.entries(SKY_RAMPS))
      for (const [mode, stops] of Object.entries(modes)) {
        expect(stops.length, `${palette}/${mode}`).toBeGreaterThan(0);
        for (let i = 1; i < stops.length; i++)
          expect(stops[i].cover).toBeGreaterThan(stops[i - 1].cover);
        for (const stop of stops) expect(thirdPartyAsset(stop.id)?.kind, stop.id).toBe('hdri');
      }
  });

  it('maps every circuit, catalogue venue, off-road venue and the festival to a palette', () => {
    for (const circuit of Object.values(CIRCUITS)) {
      const palette = skyPaletteFor(circuit);
      expect(SKY_RAMPS[palette], circuit.id).toBeDefined();
      if (circuit.catalogue) expect(palette).toBe(THEME_PALETTE[circuit.catalogue.theme]);
    }
    expect(SKY_RAMPS[FESTIVAL_PALETTE]).toBeDefined();
    expect(Object.keys(THEME_PALETTE).length).toBeGreaterThanOrEqual(28);
  });

  it('crossfades continuously between neighbouring skies of the cloud cover', () => {
    const stops = SKY_RAMPS.green.day;
    expect(skyBlend(stops, 0)).toEqual({ a: stops[0].id, b: stops[0].id, weight: 0 });
    expect(skyBlend(stops, 1)).toEqual({ a: stops.at(-1)!.id, b: stops.at(-1)!.id, weight: 0 });
    const mid = skyBlend(stops, (stops[0].cover + stops[1].cover) / 2);
    expect([mid.a, mid.b]).toEqual([stops[0].id, stops[1].id]);
    expect(mid.weight).toBeCloseTo(0.5, 9);
    // Share of each sky is continuous in cover (no jump at any stop).
    const share = (cover: number, id: string) => {
      const b = skyBlend(stops, cover);
      return (b.a === id ? 1 - b.weight : 0) + (b.b === id && b.a !== b.b ? b.weight : 0);
    };
    for (const stop of stops)
      for (let c = 0; c < 1; c += 0.01)
        expect(Math.abs(share(c + 0.001, stop.id) - share(c, stop.id))).toBeLessThan(0.02);
    expect(skyBlend(stops, Number.NaN).weight).toBe(0);
  });

  it('weather presets land on their intended skies', () => {
    expect(skyBlend(SKY_RAMPS.green.day, 0.12).a).toBe('rural-landscape'); // clear
    expect(skyBlend(SKY_RAMPS.green.day, 0.95).a).toBe('kloppenheim-01'); // heavy rain
    expect(skyBlend(SKY_RAMPS.desert.day, 0.12).a).toBe('goegap');
    expect(skyBlend(SKY_RAMPS.city.night, 0.12).a).toBe('kloppenheim-04');
    expect(skyBlend(SKY_RAMPS.green.night, 0.12).a).toBe('kloppenheim-02');
  });

  it('sunlit skies were chosen near the scene sun elevation of their lighting', () => {
    const scene = { day: elevation(SUN_OFFSET), sunset: elevation(SUNSET_OFFSET) };
    for (const modes of Object.values(SKY_RAMPS))
      for (const mode of ['day', 'sunset'] as const)
        for (const stop of modes[mode]) {
          const info = thirdPartyAsset(stop.id)!.hdri!;
          // A visible sun disc (direct light well above the sky) must sit
          // within 8 degrees of the key light the shadows come from.
          if (info.sunToSky > 1)
            expect(Math.abs(info.sunElevation - scene[mode]), stop.id).toBeLessThan(8);
        }
  });

  it('rotates the photo so its sun lies under the scene key light', () => {
    for (const sun of [
      SUN_OFFSET,
      SUNSET_OFFSET,
      new T.Vector3(1, 1, 0),
      new T.Vector3(-0.3, 0.5, 0.9),
    ])
      for (const photoAz of [-170, -42, 0, 36, 179]) {
        const r = skyRotation(photoAz, sun);
        // The shader samples the photo at azimuth atan2(z, x) - r.
        const sampled = Math.atan2(sun.z, sun.x) - r;
        const delta = Math.atan2(
          Math.sin(sampled - photoAz / DEG),
          Math.cos(sampled - photoAz / DEG),
        );
        expect(Math.abs(delta)).toBeLessThan(1e-9);
      }
  });
});

describe('PhotoSky without a browser decoder', () => {
  it('keeps the procedural sky in node and on Low', () => {
    const sky = new Sky();
    configureSky(sky);
    const photo = new PhotoSky('green');
    photo.setQuality('ultra');
    expect(PHOTO_SKY_VARIANT.low).toBeNull();
    expect(photo.enabled).toBe(false);
    expect(photo.key).toBe('');
    expect(photo.bind(sky.material, 0.1, 'day', false)).toBe(false);
    expect(sky.material.uniforms.photoAmount.value).toBe(0);
    expect(photo.fogPalette(0.1, 'day')).toBeNull();
    photo.dispose();
  });

  it('declares every shader uniform the dome samples', () => {
    const sky = new Sky();
    configureSky(sky);
    for (const name of Object.keys(createPhotoSkyUniforms()))
      expect(sky.material.uniforms[name], name).toBeDefined();
    expect(sky.material.fragmentShader).toContain('photoSky(direction');
    expect(sky.material.fragmentShader).toContain('textureGrad');
  });
});

/** A synthetic equirectangular sky: blue gradient, a sun disc at (az, el),
 * darker ground. */
function syntheticSky(width: number, az: number, el: number, sunRadiance = 40000): FloatImage {
  const height = width / 2,
    data = new Float32Array(width * height * 3);
  const sun = direction(az / DEG, el / DEG);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width - 0.5) * 2 * Math.PI,
        lat = (0.5 - (j + 0.5) / height) * Math.PI;
      const d = direction(lon, lat);
      const cos = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
      const p = (j * width + i) * 3;
      const sky =
        lat > 0 ? [0.3 + 0.2 * Math.cos(lat), 0.45 + 0.2 * Math.cos(lat), 0.9] : [0.12, 0.1, 0.08];
      const disc = cos > Math.cos(0.6 / DEG) ? sunRadiance : 0;
      data[p] = sky[0] + disc;
      data[p + 1] = sky[1] + disc * 0.95;
      data[p + 2] = sky[2] + disc * 0.85;
    }
  return { width, height, data, channels: 3 };
}

describe('HDRI preparation (scripts/assets/hdri.ts)', () => {
  it('finds the sun and measures the dome of a synthetic sky', () => {
    for (const [az, el] of [
      [36, 52],
      [-140, 10],
      [170, 30],
    ]) {
      const a = analyseHdri(syntheticSky(512, az, el));
      expect(Math.abs(a.sunAzimuth - az)).toBeLessThan(1);
      expect(Math.abs(a.sunElevation - el)).toBeLessThan(1);
      expect(a.sunToSky).toBeGreaterThan(1);
      expect(a.sunColor[0]).toBeCloseTo(1, 2);
      expect(a.horizonSunSide[2]).toBeGreaterThan(0.8);
    }
  });

  it('round-trips through the scalar half-size gain map within a few percent', () => {
    const image = syntheticSky(256, 40, 45);
    const analysis = analyseHdri(image);
    const { image: normal } = normaliseHdri(image, analysis, 64);
    const gainMax = Math.log2(65);
    const gain = gainMapLevels(normal, gainMax);
    expect(gain.width).toBe(128);
    const base = sdrBase(normal, gain.levels, gain.width, gain.height, gainMax);
    expect(base.clipped).toBe(0);
    const back = reconstruct(
      base.data,
      normal.width,
      normal.height,
      gain.levels,
      gain.width,
      gain.height,
      gainMax,
    );
    const error = compareHdr(normal, back);
    expect(error.rmsStops).toBeLessThan(0.02);
    expect(error.worstStops).toBeLessThan(0.1);
  });

  it('replaces everything below the skyline with the blurred sky just above it', () => {
    const image = syntheticSky(256, 40, 45);
    bakeBelowSkyline(image, 4);
    const row = (deg: number) => Math.ceil((0.5 - deg / 180) * image.height);
    // Every baked row is the same haze row, darker ground gone.
    for (const deg of [3.5, 0, -30, -88]) {
      const j = row(deg);
      for (const i of [0, 77, 200])
        for (let c = 0; c < 3; c++)
          expect(image.data[(j * 256 + i) * 3 + c]).toBeCloseTo(
            image.data[(row(3.5) * 256 + i) * 3 + c],
            6,
          );
      expect(image.data[(j * 256 + 10) * 3 + 2]).toBeGreaterThan(0.85);
    }
    // Sky above the skyline untouched.
    expect(image.data[(row(20) * 256 + 10) * 3 + 2]).toBeCloseTo(0.9, 6);
  });

  it('splits concatenated JPEG images at their EOI markers', () => {
    const jpeg = (payload: number[]) => [
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x04,
      0x4a,
      0x46,
      0xff,
      0xda,
      0x00,
      0x02,
      ...payload,
      0xff,
      0xd9,
    ];
    const a = jpeg([0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56]),
      b = jpeg([0x01, 0x02]);
    const spans = jpegImageSpans(new Uint8Array([...a, ...b]));
    expect(spans).toEqual([
      { start: 0, end: a.length },
      { start: a.length, end: a.length + b.length },
    ]);
  });
});
