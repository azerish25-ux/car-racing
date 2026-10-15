import * as T from 'three';
import {
  TRACKSIDE_NOISE_GLSL,
  TRACKSIDE_RUBBER_GLSL,
  rubberWear,
} from '../trackside-weathering.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { clamp } from '../../core/math.ts';
import { reflectInWetRoad } from '../wet-reflection.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import { BRAND_ART, drawMark, type MarkArt } from './brand-atlas.ts';
import {
  ATLAS,
  PANELS,
  brandingPlan,
  plainPanel,
  type BrandSpan,
  type Panel,
} from './branding-plan.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';
import { useStudioUniforms } from './studio-frame.ts';

/**
 * Trackside branding (D13): barrier vinyl on every concrete barrier run and
 * sponsor banner bridges over the track, all from one fictional-brand atlas.
 *
 * Vinyl follows the barrier's track face (the A01 / procedural profile: base
 * 0.275 m out to 0.16 m high, sloping to 0.17 m at 0.55 m, upright to 0.89 m)
 * 6 mm proud of it, skipping guardrail, impact-barrier and gate spans. One
 * mesh per `CHUNK_METRES` of lap (both sides merged), so the whole lap costs
 * about ten draws. Each sponsor span repeats its wordmark every
 * `BOARD_METRES`; LED spans are displays (see `LED`) and scroll with
 * presented simulation time. Vinyl roughness 0.7, reflected in the wet road.
 */
export const VINYL = Object.freeze({
  /** (outward from the barrier centre toward the track, height) rows, metres. */
  profile: Object.freeze([
    [0.281, 0.03],
    [0.281, 0.16],
    [0.176, 0.55],
    [0.176, 0.885],
  ] as const),
  module: 2,
  roughness: 0.7,
});
export const CHUNK_METRES = 300;
export const BOARD_METRES = 4.6;
/**
 * LED boards are displays, not lit vinyl: a dark glossy face (albedo
 * `substrate`, roughness `roughness`, so daylight reflects off it) carrying an
 * LED matrix of `pitch` metres at `fill` coverage whose emission is the
 * wordmark colour. The matrix converges to its mean before it could alias.
 * The mean radiance (`gain`, x the atlas colour, linear) follows the lighting:
 * a sunlit white board is about as bright as sunlit white vinyl by day, so
 * the board reads as a saturated, legible panel rather than a neon tube; the
 * operators turn it up at night.
 */
export const LED = Object.freeze({
  substrate: 0.04,
  roughness: 0.3,
  pitch: 0.012,
  fill: 0.5,
  gain: Object.freeze({ day: 0.8, sunset: 1.2, night: 2.0 }),
});
/** Shared by every branding material; the renderer sets it per lighting. */
export const brandLedUniforms = Object.freeze({ brandLedGain: { value: LED.gain.day } });
export function setBrandLedLighting(mode: keyof typeof LED.gain) {
  brandLedUniforms.brandLedGain.value = LED.gain[mode];
}
const PROFILE_METRES = VINYL.profile.reduce(
  (sum, row, i, rows) =>
    i ? sum + Math.hypot(row[0] - rows[i - 1][0], row[1] - rows[i - 1][1]) : 0,
  0,
);
/** LED wordmark scroll speed, boards per second. */
export const LED_SCROLL = 0.12;
/** Banner bridges over the track: lap stations and dimensions. */
export const BRIDGES = Object.freeze({
  stations: Object.freeze([0.31, 0.63] as const),
  height: 6.2,
  bannerHeight: 1.15,
  post: 0.32,
});

/** Draw the 1024×2048 sponsor atlas into `context`. */
export function drawBrandingAtlas(context: CanvasRenderingContext2D) {
  const { panelWidth: w, panelHeight: h } = ATLAS;
  for (const panel of PANELS) {
    const x = (panel.index % 2) * w,
      y = Math.floor(panel.index / 2) * h;
    context.fillStyle = panel.colourway.background;
    context.fillRect(x, y, w, h);
    if (!panel.brand) continue;
    const art: MarkArt = { ...BRAND_ART[panel.brand], ink: panel.colourway.ink };
    if (art.accent && panel.colourway.name === 'yellow') art.accent = panel.colourway.ink;
    if (art.fill && art.fill.toLowerCase() === panel.colourway.background.toLowerCase())
      art.fill = panel.colourway.ink;
    drawMark(context, art, x + 18, y + 12, w - 36, h - 24);
  }
}

let atlas: T.CanvasTexture | null = null;
export function brandingAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.width;
  canvas.height = ATLAS.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D unavailable');
  drawBrandingAtlas(context);
  atlas = new T.CanvasTexture(canvas);
  atlas.colorSpace = T.SRGBColorSpace;
  atlas.anisotropy = 8;
  // Kept at full size: 1024×2048 RGBA (8 MiB + mips) for legible boards at
  // trackside distances; the TextureBudget's canvas downscale is opted out.
  atlas.userData.dynamic = true;
  atlas.name = 'Trackside fictional sponsor atlas';
  return atlas;
}

/** The vinyl/board material: panel cells chosen per vertex, LED glow and scroll. */
export function brandingMaterial() {
  const material = new T.MeshStandardMaterial({
    map: brandingAtlas(),
    roughness: VINYL.roughness,
    metalness: 0,
  });
  material.name = 'Trackside sponsor vinyl';
  chainShaderHook(material, 'trackside-vinyl-v4', (shader) => {
    useStudioUniforms(shader, ['studioTime'], 'fragment');
    Object.assign(shader.uniforms, brandLedUniforms);
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 brandPanel;\nattribute float brandLed;\nattribute vec3 brandWeather;\nvarying vec4 vBrandPanel;\nvarying float vBrandLed;\nvarying vec2 vBrandUv;\nvarying vec3 vBrandWeather;',
      'vertex',
    );
    injectAfter(
      shader,
      'uv_vertex',
      'vBrandPanel = brandPanel;\nvBrandLed = brandLed;\nvBrandUv = uv;\nvBrandWeather = brandWeather;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `varying vec4 vBrandPanel;\nvarying float vBrandLed;\nvarying vec2 vBrandUv;\nvarying vec3 vBrandWeather;\nfloat vinylWear = 0.0, vinylRubber = 0.0;\nuniform float brandLedGain;\nvec3 apexLedEmission = vec3( 0.0 );
${TRACKSIDE_NOISE_GLSL}
${TRACKSIDE_RUBBER_GLSL}
float apexVinylHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float apexVinylNoise( vec2 p ) {
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	float n = mix( mix( apexVinylHash( i ), apexVinylHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( apexVinylHash( i + vec2( 0.0, 1.0 ) ), apexVinylHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
	return mix( 0.5, n, 1.0 - smoothstep( 0.35, 1.25, footprint ) );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'map_fragment',
      `{
	// D13: repeat the span's panel along the barrier; LED boards scroll.
	vec2 boardUv = vBrandUv;
	boardUv.x += vBrandLed * studioTime * ${LED_SCROLL.toFixed(3)};
	vec2 cell = vec2( fract( boardUv.x ), clamp( boardUv.y, 0.002, 0.998 ) );
	vec2 atlasUv = vBrandPanel.xy + cell * vBrandPanel.zw;
	vec4 board = textureGrad( map, atlasUv, dFdx( boardUv ) * vBrandPanel.zw, dFdy( boardUv ) * vBrandPanel.zw );
	diffuseColor = vec4( diffuse, opacity ) * board;
	// Weathered vinyl (printed boards are not decals): module joints every
	// ${VINYL.module} m, a little sun fade, road grime splashed up the lower
	// third with a broken edge, and wrinkle sheen. LED boards stay clean.
	float alongM = vBrandUv.x * ${BOARD_METRES.toFixed(3)};
	float jointM = abs( fract( alongM / ${VINYL.module.toFixed(1)} + 0.5 ) - 0.5 ) * ${VINYL.module.toFixed(1)};
	float jointPx = max( fwidth( alongM ), 1e-4 );
	float joint = clamp( ( 0.006 - jointM ) / jointPx + 0.5, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.006, 0.03, jointPx ) );
	float clean = 1.0 - vBrandLed;
	float grimeN = apexVinylNoise( vec2( alongM * 1.7, vBrandUv.y * 7.0 ) );
	float grime = ( 1.0 - smoothstep( 0.0, 0.34, vBrandUv.y + ( grimeN - 0.5 ) * 0.18 ) ) * clean;
	float vinylLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( vinylLuma ), 0.07 * clean );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.5, 0.45 ), grime * 0.45 );
	diffuseColor.rgb *= 1.0 - 0.55 * joint;
	vinylWear = apexVinylNoise( vec2( alongM * 2.3, vBrandUv.y * 3.1 ) + 7.7 ) - 0.5;
	// Tyre rubber from cars that touched the wall, as on the bare concrete
	// (station, height above the foot, corner-exit wear per vertex).
	vinylRubber = twRubberMarks( vBrandWeather.x, vBrandWeather.y, vBrandWeather.z ) * clean;
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.03, 0.032 ), vinylRubber * 0.82 );
	// LED display: the wordmark is the emission of a ${(LED.pitch * 1000).toFixed(0)} mm matrix
	// (${(LED.fill * 100).toFixed(0)} % fill) on a dark glossy face, converged to its mean
	// before one pixel spans a pitch (derivatives in uniform control flow).
	vec2 ledCell = vec2( alongM, vBrandUv.y * ${PROFILE_METRES.toFixed(4)} ) / ${LED.pitch.toFixed(4)};
	float ledFoot = max( length( dFdx( ledCell ) ), length( dFdy( ledCell ) ) );
	float ledRadius = ${Math.sqrt(LED.fill / Math.PI).toFixed(4)};
	float ledDot = 1.0 - smoothstep( ledRadius - ledFoot, ledRadius + ledFoot, length( fract( ledCell ) - 0.5 ) );
	ledDot = mix( ledDot, ${LED.fill.toFixed(3)}, smoothstep( 0.2, 0.6, ledFoot ) );
	apexLedEmission = diffuseColor.rgb * ( ledDot / ${LED.fill.toFixed(3)} ) * brandLedGain * vBrandLed;
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${LED.substrate.toFixed(3)} ), vBrandLed );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = mix( clamp( roughnessFactor + 0.16 * vinylWear, 0.0, 1.0 ), 0.6, vinylRubber );\nroughnessFactor = mix( roughnessFactor, ${LED.roughness.toFixed(2)}, vBrandLed );`,
      'fragment',
    );
    injectAfter(
      shader,
      'emissivemap_fragment',
      'totalEmissiveRadiance += apexLedEmission;',
      'fragment',
    );
  });
  tagWeatherSurface(material, 'paint');
  return material;
}

/** Barrier modules (side, s0, s1) that carry vinyl, grouped by sponsor span. */
export function vinylModules(
  track: Track,
  skip: (s: number, side: number) => boolean,
  spans: readonly BrandSpan[] = brandingPlan(track.length),
) {
  const modules: { span: BrandSpan; a: number; b: number }[] = [];
  for (const span of spans) {
    const count = Math.max(1, Math.round((span.end - span.start) / VINYL.module));
    for (let i = 0; i < count; i++) {
      const a = span.start + ((span.end - span.start) * i) / count,
        b = span.start + ((span.end - span.start) * (i + 1)) / count;
      if (!skip((a + b) / 2, span.side)) modules.push({ span, a, b });
    }
  }
  return modules;
}

function barrierPoint(track: Track, s: number, side: number, inward: number, height: number) {
  const p = track.at(s, trackPoint());
  const l = side * (track.boundary(s, side) - inward);
  return new T.Vector3(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + height, p.z + p.nz * l);
}

/** One merged vinyl geometry for the modules inside [start, end). */
export function vinylGeometry(
  track: Track,
  modules: readonly { span: BrandSpan; a: number; b: number }[],
) {
  const position: number[] = [],
    uv: number[] = [],
    panel: number[] = [],
    led: number[] = [],
    weather: number[] = [],
    index: number[] = [];
  const rows = VINYL.profile;
  const lengths = [0];
  for (let r = 1; r < rows.length; r++)
    lengths.push(
      lengths[r - 1] + Math.hypot(rows[r][0] - rows[r - 1][0], rows[r][1] - rows[r - 1][1]),
    );
  const total = lengths[lengths.length - 1];
  for (const { span, a, b } of modules) {
    const base = position.length / 3,
      wear = rubberWear(track, (a + b) / 2);
    for (const s of [a, b])
      rows.forEach(([inward, height], r) => {
        const p = barrierPoint(track, s, span.side, inward, height);
        position.push(p.x, p.y, p.z);
        // Boards read left to right from the track on both sides.
        const along = (span.side > 0 ? s - span.start : span.end - s) / BOARD_METRES;
        uv.push(along, lengths[r] / total);
        panel.push(span.panel.u, span.panel.v, span.panel.du, span.panel.dv);
        led.push(span.led ? 1 : 0);
        weather.push(s, height, wear);
      });
    const n = rows.length;
    for (let r = 0; r < n - 1; r++) {
      const i0 = base + r,
        i1 = base + r + 1,
        j0 = base + n + r,
        j1 = base + n + r + 1;
      // Faces the track: the winding flips with the side.
      if (span.side < 0) index.push(i0, i1, j0, i1, j1, j0);
      else index.push(i0, j0, i1, i1, j0, j1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('brandPanel', new T.Float32BufferAttribute(panel, 4));
  g.setAttribute('brandLed', new T.Float32BufferAttribute(led, 1));
  g.setAttribute('brandWeather', new T.Float32BufferAttribute(weather, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A sponsor bridge across the track at lap station `s`: two posts, a beam
 * and a banner facing each direction, one geometry in the vinyl material. */
export function bridgeGeometry(track: Track, s: number, brand: Panel, post = plainPanel('black')) {
  const p = track.at(s, trackPoint());
  const parts: T.BufferGeometry[] = [];
  const yaw = Math.atan2(p.tx, p.tz);
  // Posts stand 1 m behind each barrier; the banner spans the whole width.
  const left = track.boundary(s, -1) + 1,
    right = track.boundary(s, 1) + 1,
    span = (left + right) / 2,
    centre = (right - left) / 2;
  const tag = (g: T.BufferGeometry, cell: Panel, uScale: number, vScale: number) => {
    const count = g.getAttribute('position').count;
    const uvs = g.getAttribute('uv');
    for (let i = 0; i < count; i++) uvs.setXY(i, uvs.getX(i) * uScale, uvs.getY(i) * vScale);
    g.setAttribute(
      'brandPanel',
      new T.Float32BufferAttribute(
        new Array(count).fill(0).flatMap(() => [cell.u, cell.v, cell.du, cell.dv]),
        4,
      ),
    );
    g.setAttribute('brandLed', new T.Float32BufferAttribute(new Array(count).fill(0), 1));
    // Out of reach of any tyre: no rubber on bridges.
    g.setAttribute(
      'brandWeather',
      new T.Float32BufferAttribute(
        new Array(count).fill(0).flatMap(() => [0, -10, 0]),
        3,
      ),
    );
    return g;
  };
  for (const side of [-1, 1]) {
    const column = new T.BoxGeometry(
      BRIDGES.post,
      BRIDGES.height + BRIDGES.bannerHeight,
      BRIDGES.post,
    );
    column.translate(centre + side * span, (BRIDGES.height + BRIDGES.bannerHeight) / 2, 0);
    parts.push(tag(column, post, 1, 1));
  }
  const banner = new T.BoxGeometry(span * 2, BRIDGES.bannerHeight, 0.18);
  banner.translate(centre, BRIDGES.height + BRIDGES.bannerHeight / 2, 0);
  parts.push(tag(banner, brand, (span * 2) / (BRIDGES.bannerHeight * 4), 1));
  const merged = mergeAll(parts);
  merged.rotateY(yaw);
  merged.translate(p.x, p.y, p.z);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
function mergeAll(parts: T.BufferGeometry[]) {
  const position: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    panel: number[] = [],
    led: number[] = [],
    weather: number[] = [],
    index: number[] = [];
  for (const g of parts) {
    const base = position.length / 3;
    position.push(...(g.getAttribute('position').array as Float32Array));
    normal.push(...(g.getAttribute('normal').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    panel.push(...(g.getAttribute('brandPanel').array as Float32Array));
    led.push(...(g.getAttribute('brandLed').array as Float32Array));
    weather.push(...(g.getAttribute('brandWeather').array as Float32Array));
    for (const i of g.index!.array as ArrayLike<number> as number[]) index.push(base + i);
    g.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('brandPanel', new T.Float32BufferAttribute(panel, 4));
  g.setAttribute('brandLed', new T.Float32BufferAttribute(led, 1));
  g.setAttribute('brandWeather', new T.Float32BufferAttribute(weather, 3));
  g.setIndex(index);
  return g;
}

export interface BrandingBuild {
  meshes: T.Mesh[];
  modules: number;
  /** Fraction of barrier modules (outside skipped spans) carrying vinyl. */
  coverage: number;
}
/** Build the vinyl and bridges into `root` (the circuit's surfaces group). */
export function buildTracksideBranding(
  track: Track,
  root: T.Object3D,
  skip: (s: number, side: number) => boolean,
): BrandingBuild {
  const material = brandingMaterial();
  const spans = brandingPlan(track.length);
  const modules = vinylModules(track, skip, spans);
  const meshes: T.Mesh[] = [];
  for (let start = 0; start < track.length; start += CHUNK_METRES) {
    const inside = modules.filter((m) => m.a >= start && m.a < start + CHUNK_METRES);
    if (!inside.length) continue;
    const mesh = new T.Mesh(vinylGeometry(track, inside), material);
    mesh.name = `Sponsor barrier vinyl ${Math.round(start)}m`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    reflectInWetRoad(mesh);
    root.add(mesh);
    meshes.push(mesh);
  }
  const branded = PANELS.filter((p) => p.brand);
  BRIDGES.stations.forEach((fraction, i) => {
    const mesh = new T.Mesh(
      bridgeGeometry(track, fraction * track.length, branded[(i * 7 + 3) % branded.length]),
      material,
    );
    mesh.name = `Sponsor bridge ${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    reflectInWetRoad(mesh);
    root.add(mesh);
    meshes.push(mesh);
  });
  let total = 0;
  for (const span of spans)
    total += Math.max(1, Math.round((span.end - span.start) / VINYL.module));
  return { meshes, modules: modules.length, coverage: total ? modules.length / total : 0 };
}
