import * as T from 'three';
import { Random } from '../../core/math.ts';
import { valueNoise } from '../terrain-profile.ts';
import { canvasTexture } from '../geometry.ts';
import { surfaceMaterial } from '../surface-detail.ts';
import { installVenueFinish } from '../venue-materials.ts';
import { installCarGrounding } from '../studio/car-grounding.ts';
import { installLightPools } from '../studio/light-pools.ts';
import { installGravelFinish } from '../studio/grass-gravel-finish.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import type { VenueThemeStyle } from './theme.ts';

/** Procedural stratified rock: albedo and a derived tangent-space normal map
 * (512 px, 6 m tile), no photographs. Shared by cuttings, cliffs and boulders. */
function rockTextures(tint: number) {
  const size = 256,
    heights = new Float32Array(size * size),
    base = new T.Color(tint);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      // Periodic sampling keeps the tile seamless.
      const n =
        0.55 * valueNoise(Math.cos(u * 6.283) * 2 + 7, Math.sin(u * 6.283) * 2 + v * 9) +
        0.3 * valueNoise(u * 23 + 3, v * 31 + 1) +
        0.15 * valueNoise(u * 61, v * 67);
      const strata = 0.5 + 0.5 * Math.sin(v * 6.283 * 7 + n * 5);
      heights[y * size + x] = 0.65 * n + 0.35 * strata;
    }
  const albedo = canvasTexture(size, size, (c) => {
    const image = c.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const h = heights[i],
        k = 0.62 + 0.55 * h;
      image.data[i * 4] = Math.min(255, base.r * 255 * k);
      image.data[i * 4 + 1] = Math.min(255, base.g * 255 * k);
      image.data[i * 4 + 2] = Math.min(255, base.b * 255 * k);
      image.data[i * 4 + 3] = 255;
    }
    c.putImageData(image, 0, 0);
  });
  const normal = canvasTexture(size, size, (c) => {
    const image = c.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const at = (xx: number, yy: number) =>
          heights[((yy + size) % size) * size + ((xx + size) % size)];
        const nx = (at(x - 1, y) - at(x + 1, y)) * 3,
          ny = (at(x, y - 1) - at(x, y + 1)) * 3,
          inverse = 1 / Math.hypot(nx, ny, 1),
          i = (y * size + x) * 4;
        image.data[i] = (nx * inverse * 0.5 + 0.5) * 255;
        image.data[i + 1] = (ny * inverse * 0.5 + 0.5) * 255;
        image.data[i + 2] = (inverse * 0.5 + 0.5) * 255;
        image.data[i + 3] = 255;
      }
    c.putImageData(image, 0, 0);
  });
  normal.colorSpace = T.NoColorSpace;
  for (const t of [albedo, normal]) t.wrapS = t.wrapT = T.RepeatWrapping;
  return { albedo, normal };
}

/** Night windows of the city frontage. A real night facade is mostly dark
 * glass: about a third of the rooms are lit, at very different levels (a
 * log-normal spread, median `median` of the brightest), mostly warm
 * 2700-4500 K homes and a few cool offices (as a camera balanced near 4000 K
 * records them), each lit from its ceiling (brighter at the top) and some
 * behind blinds. `emissive` is the night emissive intensity of the facade
 * (a lit pane's linear radiance is its luminance times this). */
export const FACADE_WINDOWS = Object.freeze({
  lit: 0.32,
  /** Share of the unlit rooms with a faint glow (a hallway, a screen). */
  dim: 0.18,
  median: 0.25,
  /** Log-normal sigma of the lit rooms' luminance, clamped to [min, 1]. */
  sigma: 0.85,
  min: 0.05,
  blinds: 0.3,
  emissive: 0.6,
  /** Warm-to-cool colour of the rooms (sRGB) at 2700, 3500, 4500 K and a
   * cool 6000 K office, under a ~4000 K white balance. */
  temperatures: Object.freeze([
    [255, 196, 140],
    [255, 222, 190],
    [255, 240, 225],
    [222, 233, 255],
  ] as const),
});
const toSrgbByte = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
};
const toLinear = (byte: number) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** Deterministic window plan for one facade tile: per pane a linear
 * luminance (0 = dark) and a temperature index, plus blinds. */
export function facadeWindowPlan(seed: number, warm: boolean, panes: number) {
  const random = new Random(seed),
    w = FACADE_WINDOWS;
  return Array.from({ length: panes }, () => {
    const pick = random.next();
    // Box-Muller from two uniform draws (the stream stays deterministic).
    const u1 = Math.max(1e-6, random.next()),
      u2 = random.next();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const tone = random.next(),
      blinds = random.next() < w.blinds;
    let luminance = 0;
    if (pick < w.lit)
      luminance = Math.min(1, Math.max(w.min, w.median * Math.exp(w.sigma * gauss)));
    else if (pick < w.lit + w.dim) luminance = 0.012 + 0.02 * u2;
    // Homes are warm; the cool building is mostly offices.
    const temperature = warm
      ? tone < 0.4
        ? 0
        : tone < 0.75
          ? 1
          : tone < 0.93
            ? 2
            : 3
      : tone < 0.15
        ? 1
        : tone < 0.45
          ? 2
          : 3;
    return { luminance, temperature, blinds };
  });
}

/** Facade texture: one 4 x 8 storey tile of mullioned windows; the emissive
 * twin lights a deterministic subset of rooms at night (FACADE_WINDOWS). */
function facadeTextures(seed: number, warm: boolean) {
  const w = 256,
    h = 512,
    cols = 4,
    rows = 8,
    plan = facadeWindowPlan(seed, warm, cols * rows);
  const draw = (emissive: boolean) =>
    canvasTexture(w, h, (c) => {
      c.fillStyle = emissive ? '#000000' : '#5d6266';
      c.fillRect(0, 0, w, h);
      for (let r = 0; r < rows; r++)
        for (let col = 0; col < cols; col++) {
          const x = col * (w / cols) + 7,
            y = r * (h / rows) + 9,
            ww = w / cols - 14,
            hh = h / rows - 20;
          if (emissive) {
            const pane = plan[r * cols + col];
            if (!(pane.luminance > 0)) continue;
            const colour = FACADE_WINDOWS.temperatures[pane.temperature].map(toLinear);
            // Ceiling-lit room: brighter at the top of the pane; blinds slat it.
            for (let j = 0; j < hh; j++) {
              const t = j / Math.max(1, hh - 1);
              let k = pane.luminance * (1 - 0.45 * t);
              if (pane.blinds) k *= j % 5 < 2 ? 0.25 : 0.85;
              c.fillStyle = `rgb(${colour.map((v) => toSrgbByte(v * k)).join(',')})`;
              c.fillRect(x, y + j, ww, 1);
            }
          } else {
            c.fillStyle = '#26323a';
            c.fillRect(x, y, ww, hh);
            c.fillStyle = '#8b939a';
            c.fillRect(x + ww / 2 - 1, y, 2, hh);
          }
        }
    });
  const map = draw(false),
    emissiveMap = draw(true);
  for (const t of [map, emissiveMap]) t.wrapS = t.wrapT = T.RepeatWrapping;
  return { map, emissiveMap };
}

/**
 * Street light on the city frontage at night: the lamp rows along the road
 * light the lower storeys of the buildings beside it, falling off with
 * height above the street (`streetLevel` attribute, the road's height at the
 * building). Irradiance (scene units) on vertical faces: `irradiance` up to
 * `full` metres, halving `halve` metres higher. 0 by day. No lights, no draws.
 */
export const FACADE_STREET_LIGHT = Object.freeze({
  irradiance: 2.4,
  full: 4,
  halve: 7,
  colour: 0xffd6a8,
});
export const facadeStreetUniforms = Object.freeze({
  facadeStreetLight: { value: 0 },
  facadeStreetColour: { value: new T.Color(FACADE_STREET_LIGHT.colour) },
});
export function installFacadeStreetLight(material: T.MeshStandardMaterial) {
  return chainShaderHook(material, 'facade-street-light-v1', (shader) => {
    Object.assign(shader.uniforms, facadeStreetUniforms);
    injectDeclarations(
      shader,
      'common',
      'attribute float streetLevel;\nvarying float vStreetHeight;',
      'vertex',
    );
    injectAfter(
      shader,
      'project_vertex',
      'vStreetHeight = ( modelMatrix * vec4( transformed, 1.0 ) ).y - streetLevel;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      'varying float vStreetHeight;\nuniform float facadeStreetLight;\nuniform vec3 facadeStreetColour;',
      'fragment',
    );
    injectAfter(
      shader,
      'lights_fragment_end',
      `if ( facadeStreetLight > 0.0 ) {
	// Street lamps light the lower storeys; vertical faces only.
	float streetRise = max( vStreetHeight - ${FACADE_STREET_LIGHT.full.toFixed(1)}, 0.0 ) / ${FACADE_STREET_LIGHT.halve.toFixed(1)};
	float streetFall = 1.0 / ( 1.0 + streetRise * streetRise );
	vec3 streetUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
	float streetWall = 1.0 - abs( dot( normal, streetUp ) );
	reflectedLight.directDiffuse += facadeStreetColour * ( facadeStreetLight * streetFall * streetWall ) * BRDF_Lambert( material.diffuseColor );
}`,
      'fragment',
    );
  });
}

export function venueKitMaterials(style: VenueThemeStyle) {
  const groundKind =
    style.ground === 'sand' ? 'gravel' : style.ground === 'grass' ? 'grass' : 'concrete';
  const ground = surfaceMaterial(groundKind, groundKind === 'concrete' ? 'concrete' : undefined);
  // Grass keeps the circuit's original grass look; other grounds are tinted.
  if (style.ground !== 'grass') ground.color.set(style.groundTint).multiplyScalar(1.25);
  if (groundKind === 'gravel') installGravelFinish(ground);
  const gravel = surfaceMaterial('gravel');
  installGravelFinish(gravel);
  if (style.ground === 'sand') gravel.color.set(0xd9b08a);
  const runoff = surfaceMaterial('asphalt', 'concrete');
  runoff.color.multiplyScalar(0.92);
  const rockMaps = rockTextures(style.rockTint);
  const rock = new T.MeshStandardMaterial({
    map: rockMaps.albedo,
    normalMap: rockMaps.normal,
    normalScale: new T.Vector2(1.4, 1.4),
    roughness: 0.93,
  });
  rock.name = 'Venue kit stratified rock';
  rockMaps.albedo.repeat.set(1 / 6, 1 / 6);
  rockMaps.normal.repeat.set(1 / 6, 1 / 6);
  const concrete = new T.MeshStandardMaterial({ color: 0xa7a69e, roughness: 0.9 });
  installVenueFinish(concrete, 'stone');
  const steel = new T.MeshStandardMaterial({ color: 0xb4babd, metalness: 0.82, roughness: 0.34 });
  installVenueFinish(steel, 'metal');
  const darkSteel = new T.MeshStandardMaterial({
    color: 0x3d4447,
    metalness: 0.7,
    roughness: 0.45,
  });
  const tyre = new T.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.88 });
  const tyreBand = new T.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7 });
  const saferFoam = new T.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.55 });
  const facades = [0, 1, 2].map((i) => {
    const maps = facadeTextures(91 + i * 17, i !== 1);
    const material = new T.MeshStandardMaterial({
      color: [0xc8c4bb, 0x9fb2c0, 0xb7a58f][i],
      map: maps.map,
      emissiveMap: maps.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.55,
      metalness: 0.15,
    });
    material.name = `Venue kit facade ${i + 1}`;
    installFacadeStreetLight(material);
    return material;
  });
  const neon = [0xff2fa6, 0x22e4ff, 0xffd23a, 0x7c5cff].map(
    (c) =>
      new T.MeshStandardMaterial({
        color: 0x111111,
        emissive: c,
        emissiveIntensity: 0.4,
        roughness: 0.4,
      }),
  );
  const lamp = new T.MeshStandardMaterial({
    color: 0x2a2a2a,
    emissive: 0xfff3dc,
    emissiveIntensity: 0.05,
    roughness: 0.3,
  });
  const water = new T.MeshStandardMaterial({ color: 0x4a4f50, roughness: 0.95 });
  for (const m of [ground, gravel, runoff]) {
    installCarGrounding(m);
    installLightPools(m);
  }
  return {
    ground,
    gravel,
    runoff,
    rock,
    concrete,
    steel,
    darkSteel,
    tyre,
    tyreBand,
    saferFoam,
    facades,
    neon,
    lamp,
    quay: water,
  };
}
export type VenueKitMaterials = ReturnType<typeof venueKitMaterials>;
