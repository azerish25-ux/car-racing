import * as T from 'three';
import { canvasTexture } from './geometry.ts';
import { Random } from '../core/math.ts';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';
import { useStudioUniforms } from './studio/studio-frame.ts';

/** Tileable original wave normals: a seeded spectrum of 56 directional
 * waves with integer wave vectors (so the tile wraps), amplitude falling as
 * k^-1.6 like a wind-sea spectrum and biased to one wind heading, instead of
 * four axis-aligned sines that read as a diamond lattice. Static texels; the
 * motion comes from the drifting wave trains in the shader. */
function waveNormals(size = 256) {
  const random = new Random(0x5ea);
  const waves: [number, number, number, number][] = [];
  while (waves.length < 56) {
    const kx = Math.round((random.next() * 2 - 1) * 22),
      ky = Math.round((random.next() * 2 - 1) * 22);
    const k = Math.hypot(kx, ky);
    if (k < 2) continue;
    // Wind toward +x: waves running across it are weaker.
    const along = Math.abs(kx) / k;
    waves.push([kx, ky, (0.35 + 0.65 * along) * k ** -1.6, random.next() * Math.PI * 2]);
  }
  const texture = canvasTexture(size, size, (context) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2,
          v = (y / size) * Math.PI * 2;
        let dx = 0,
          dy = 0;
        for (const [kx, ky, a, phase] of waves) {
          // Sharpened crests (a cosine raised toward its peak) as real chop.
          const c = Math.cos(kx * u + ky * v + phase);
          const slope = a * Math.sin(kx * u + ky * v + phase) * (1 + 0.6 * c);
          dx -= slope * kx;
          dy -= slope * ky;
        }
        const n = new T.Vector3(-dx * 0.55, -dy * 0.55, 1).normalize();
        const i = (y * size + x) * 4;
        image.data[i] = (n.x * 0.5 + 0.5) * 255;
        image.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        image.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        image.data[i + 3] = 255;
      }
    context.putImageData(image, 0, 0);
  });
  texture.colorSpace = T.NoColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(160, 160);
  texture.name = 'Original sea wave normals';
  return texture;
}

/** A single sea surface at the venue's sea level. Land terrain above it
 * occludes it by depth; it receives the sky environment and local probe, so
 * the water reflects the actual sky, weather and night lighting. */
export function buildSea(level: number) {
  const material = new T.MeshPhysicalMaterial({
    color: 0x0d3a4a,
    roughness: 0.12,
    metalness: 0,
    normalMap: waveNormals(),
    normalScale: new T.Vector2(0.35, 0.35),
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
  });
  material.name = 'Vellamar sea surface';
  installSeaWaves(material);
  const geometry = new T.PlaneGeometry(5500, 5500, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const sea = new T.Mesh(geometry, material);
  sea.name = 'Sea';
  sea.position.y = level;
  sea.receiveShadow = false;
  sea.castShadow = false;
  return sea;
}

/** Open-water look on top of the stock normal map:
 *  - three wave trains of the same original normal texture at 9 m, 23 m and
 *    61 m, drifting in different directions with presented simulation time
 *    (held and replayed frames match), so no single tile repeats;
 *  - the short train fades with distance before it can alias, and distant
 *    water tends to the long swell, a little rougher (unresolved chop);
 *  - deep water darkens toward the horizon-facing troughs and lifts a
 *    sub-surface blue-green where the waves face the viewer.
 * Zero extra textures or draws. */
export const SEA_WAVES = Object.freeze({
  /** Wave train wavelength (m), drift (m/s) and heading (rad). */
  trains: Object.freeze([
    [9, 0.9, 0.4],
    [23, 0.55, 2.1],
    [61, 0.3, 4.0],
  ] as const),
  /** Distance over which the short train fades, metres. */
  shortFade: Object.freeze([120, 600] as const),
  /** Sub-surface scatter colour (linear) on wave faces toward the viewer. */
  scatter: Object.freeze([0.01, 0.055, 0.06] as const),
});
const sf = (v: number) => v.toFixed(4);
export function installSeaWaves(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, 'sea-waves-v1', (shader) => {
    useStudioUniforms(shader, ['studioTime'], 'fragment');
    injectAfter(
      shader,
      'normal_fragment_maps',
      `#ifdef USE_NORMALMAP_TANGENTSPACE
{
  // World xz from the 160x-repeated plane UV (5500 m across).
  vec2 seaWorld = (vNormalMapUv / ${sf(160 / 5500)});
  float seaDistance = length(vViewPosition);
  float seaShort = 1.0 - smoothstep(${sf(SEA_WAVES.shortFade[0])}, ${sf(SEA_WAVES.shortFade[1])}, seaDistance);
  vec3 seaSum = vec3(0.0);
  ${SEA_WAVES.trains
    .map(
      ([wave, drift, heading], i) => `{
    vec2 dir = vec2(${sf(Math.cos(heading))}, ${sf(Math.sin(heading))});
    vec2 uv = (seaWorld + dir * studioTime * ${sf(drift)}) / ${sf(wave)};
    uv = vec2(uv.x * dir.x - uv.y * dir.y, uv.x * dir.y + uv.y * dir.x);
    vec3 n = texture2D(normalMap, uv).xyz * 2.0 - 1.0;
    // Back from the rotated train frame to the plane's tangent frame.
    n.xy = vec2(n.x * dir.x + n.y * dir.y, -n.x * dir.y + n.y * dir.x);
    seaSum += n * ${i === 0 ? 'seaShort * 0.9' : i === 1 ? '0.75' : '0.6'};
  }`,
    )
    .join('\n  ')}
  seaSum.xy *= normalScale;
  normal = normalize(tbn * vec3(seaSum.xy, max(seaSum.z, 0.2)));
  roughnessFactor = min(1.0, roughnessFactor + 0.06 * (1.0 - seaShort));
}
#endif`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_fragment_end',
      `{
  // Sub-surface blue-green where a wave face turns toward the viewer.
  float seaFacing = clamp(dot(normal, normalize(vViewPosition)) * -1.0, 0.0, 1.0);
  float seaFace = smoothstep(0.75, 1.0, seaFacing);
  reflectedLight.indirectDiffuse += vec3(${SEA_WAVES.scatter.map(sf).join(', ')}) * seaFace;
}`,
      'fragment',
    );
  });
}

/** Coastal band on the land terrain: wet shingle at the waterline, then a
 * sand/pebble beach that breaks up with noise before the turf, except on steep
 * faces where the landform rock shading stays exposed. The geometry's `shore`
 * attribute (1 on the seaward strip, 0 inland) keeps low ground beside the
 * paddock grassed. It runs after the terrain finish, so Aurel's inland terrain
 * shader and cache key are unchanged. */
export function installShoreline(material: T.MeshStandardMaterial, seaLevel: number) {
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float shore;\nvarying float vShore;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShore=shore;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShore;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float shoreHeight=vFinishWorld.y-${seaLevel.toFixed(3)};
      float shoreNoise=finishFilteredNoise(vFinishWorld.xz*.045);
      float shoreSlope=1.0-clamp(normalize(vFinishNormal).y,0.0,1.0);
      float beach=(1.0-smoothstep(.7,2.4,shoreHeight+(shoreNoise-.5)*1.6))*
        (1.0-smoothstep(.3,.5,shoreSlope))*vShore;
      vec3 shingle=mix(vec3(.30,.27,.21),vec3(.46,.41,.31),finishFilteredNoise(vFinishWorld.xz*.55));
      diffuseColor.rgb=mix(diffuseColor.rgb,shingle,beach);
      diffuseColor.rgb*=mix(1.0,.5,(1.0-smoothstep(-.05,.45,shoreHeight))*vShore);`,
      );
  };
  material.customProgramCacheKey = () => `${baseKey}:shoreline-v1:${seaLevel}`;
}

/** Seaward-strip weight for a terrain vertex: 1 within 60 m inland of the
 * coastline (and offshore), 0 beyond 140 m inland. */
export function shoreWeight(z: number, coastZ: number) {
  const inland = z - coastZ;
  const t = Math.min(1, Math.max(0, (inland - 60) / 80));
  return 1 - t * t * (3 - 2 * t);
}
