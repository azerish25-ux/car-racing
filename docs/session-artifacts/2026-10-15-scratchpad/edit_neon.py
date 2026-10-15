p='src/rendering/venue-kit/materials.ts'
s=open(p).read()
start=s.index("/** Facade texture: one 4 x 8 storey tile of mullioned windows; the emissive")
end=s.index("export function venueKitMaterials(style: VenueThemeStyle) {")
new='''/** Night windows of the city frontage. A real night facade is mostly dark
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
      'attribute float streetLevel;\\nvarying float vStreetHeight;',
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
      'varying float vStreetHeight;\\nuniform float facadeStreetLight;\\nuniform vec3 facadeStreetColour;',
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

'''
s=s[:start]+new+s[end:]
old="""    material.name = `Venue kit facade ${i + 1}`;
    return material;"""
new="""    material.name = `Venue kit facade ${i + 1}`;
    installFacadeStreetLight(material);
    return material;"""
assert old in s; s=s.replace(old,new)
s=s.replace("""import type { VenueThemeStyle } from './theme.ts';""","""import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import type { VenueThemeStyle } from './theme.ts';""")
open(p,'w').write(s)

p='src/rendering/venue-kit/structures.ts'
s=open(p).read()
old="""      const g = facadeBox(width, height + 1.5, depth);
      g.rotateY(Math.atan2(p.tx, p.tz));
      g.translate(x, ground + (height + 1.5) / 2, z);"""
new="""      const g = facadeBox(width, height + 1.5, depth);
      g.rotateY(Math.atan2(p.tx, p.tz));
      g.translate(x, ground + (height + 1.5) / 2, z);
      // The road's height beside the building, for the street light falloff.
      const street = new Float32Array(g.getAttribute('position').count).fill(p.y);
      g.setAttribute('streetLevel', new T.BufferAttribute(street, 1));"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/venue-kit/index.ts'
s=open(p).read()
old="""  /** Distance LOD and night emission. Cheap: one distance per detail cell. */
  update(camera: T.Camera, night: boolean) {
    camera.getWorldPosition(this.camera);
    for (const cell of this.context.cells)
      cell.object.visible = cell.centre.distanceTo(this.camera) < cell.range;
    if (night === this.nightState) return;
    this.nightState = night;
    const m = this.context.materials;
    for (const f of m.facades) f.emissiveIntensity = night ? 1.6 : 0;
    for (const n of m.neon) n.emissiveIntensity = night ? 4 : 0.5;
    m.lamp.emissiveIntensity = night ? 8 : 0.05;
  }"""
new="""  /** A city venue: frontage lines the circuit (urban skyglow at night). */
  get urban() {
    return this.context.meta.dressing.facades.length > 0;
  }
  /** Distance LOD and night emission. Cheap: one distance per detail cell.
   * `physical`: the energy-conserving bloom draws the lamp heads' glare, so
   * they carry physical radiance. */
  update(camera: T.Camera, night: boolean, physical = false) {
    camera.getWorldPosition(this.camera);
    for (const cell of this.context.cells)
      cell.object.visible = cell.centre.distanceTo(this.camera) < cell.range;
    const state = `${night}:${physical}`;
    if (state === this.nightState) return;
    this.nightState = state;
    const m = this.context.materials;
    // Windows: FACADE_WINDOWS (log-normal rooms); the street lights the
    // lower storeys (FACADE_STREET_LIGHT).
    for (const f of m.facades) f.emissiveIntensity = night ? FACADE_WINDOWS.emissive : 0;
    facadeStreetUniforms.facadeStreetLight.value = night ? FACADE_STREET_LIGHT.irradiance : 0;
    for (const n of m.neon) n.emissiveIntensity = night ? 4 : 0.5;
    m.lamp.emissiveIntensity = night ? (physical ? 150 : 8) : 0.05;
  }"""
assert old in s; s=s.replace(old,new)
s=s.replace("  private nightState: boolean | null = null;","  private nightState: string | null = null;")
s=s.replace("""import { chunks } from './sweep.ts';""","""import { chunks } from './sweep.ts';
import { FACADE_STREET_LIGHT, FACADE_WINDOWS, facadeStreetUniforms } from './materials.ts';""")
open(p,'w').write(s)

p='src/rendering/daylight.ts'
s=open(p).read()
old="""    nightSky += vec3(.004, .003, .002) * pow(1.0 - elevation, 10.0);"""
new="""    nightSky += vec3(.004, .003, .002) * pow(1.0 - elevation, 10.0);
    // Urban skyglow over a night city venue: warm grey light pollution,
    // ${URBAN_SKYGLOW.horizon} at the horizon falling to ~${URBAN_SKYGLOW.zenith} by 30 degrees.
    nightSky += ${vec3(URBAN_SKYGLOW.colour)} * urbanGlow * (${URBAN_SKYGLOW.zenith.toFixed(4)} +
      ${(URBAN_SKYGLOW.horizon - URBAN_SKYGLOW.zenith).toFixed(4)} * exp(-asin(elevation) / ${URBAN_SKYGLOW.falloff.toFixed(3)}));"""
assert old in s; s=s.replace(old,new)
old="""        nightSky += stars * celestialExtinction(direction.y) * starAmount *
          (1.0 - 0.85 * cloudCover);"""
new="""        nightSky += stars * celestialExtinction(direction.y) * starAmount *
          (1.0 - 0.85 * cloudCover) * mix(1.0, ${URBAN_SKYGLOW.stars.toFixed(3)}, urbanGlow);"""
assert old in s; s=s.replace(old,new)
old="""uniform float nightAmount;
uniform float sunsetAmount;"""
new="""uniform float nightAmount;
uniform float sunsetAmount;
uniform float urbanGlow;"""
assert old in s; s=s.replace(old,new)
old="""  u.nightAmount = { value: 0 };
  u.sunsetAmount = { value: 0 };"""
new="""  u.nightAmount = { value: 0 };
  u.sunsetAmount = { value: 0 };
  u.urbanGlow = { value: 0 };"""
assert old in s; s=s.replace(old,new)
# define URBAN_SKYGLOW before the shader source: insert before the CELESTIAL docs
anchor = s.index("/**\n * The celestial sky (sky-ephemeris.ts)")
s = s[:anchor] + '''/** Urban skyglow over catalogue night city venues (linear radiance): a warm
 * grey dome brightest at the horizon, which leaves only the brightest stars
 * (`stars` of their light) and lifts the night haze to the same glow. */
export const URBAN_SKYGLOW = Object.freeze({
  horizon: 0.03,
  zenith: 0.004,
  /** Exponential falloff with elevation (radians): ~0.0043 at 30 degrees. */
  falloff: 0.12,
  colour: Object.freeze([1, 0.86, 0.7] as const),
  stars: 0.05,
});
/** Night haze colour of an urban venue: the skyglow's horizon. */
export function urbanFogColor(out: T.Color) {
  const [r, g, b] = URBAN_SKYGLOW.colour;
  return out.setRGB(
    Math.max(out.r, URBAN_SKYGLOW.horizon * r),
    Math.max(out.g, URBAN_SKYGLOW.horizon * g),
    Math.max(out.b, URBAN_SKYGLOW.horizon * b),
  );
}

''' + s[anchor:]
open(p,'w').write(s)

p='src/rendering/renderer.ts'
s=open(p).read()
old="""    fog.color.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    this.sky.material.uniforms.cloudCover.value = daylight.cover;"""
new="""    fog.color.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    // Catalogue night cities: urban skyglow on the dome and in the haze.
    const urban = illumination === 'night' && !studio && !!this.circuit.venueKit?.urban;
    this.sky.material.uniforms.urbanGlow.value = urban ? 1 : 0;
    if (urban) {
      urbanFogColor(fog.color);
      urbanFogColor(this.nightFog);
    }
    this.sky.material.uniforms.cloudCover.value = daylight.cover;"""
assert old in s; s=s.replace(old,new)
old="""    this.circuit.venueKit?.update(this.camera, this.night);"""
new="""    this.circuit.venueKit?.update(this.camera, this.night, this.bloom.energyConserving);"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
