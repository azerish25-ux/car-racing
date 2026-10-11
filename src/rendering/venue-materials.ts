import { installGlazing } from './studio/glazing.ts';
import * as T from 'three';
import { PERIODIC_COVERAGE_GLSL } from './periodic-coverage.ts';
import { installFacadeWeathering } from './facade-weathering.ts';

export type VenueFinish = 'stone' | 'timber' | 'metal' | 'paving';
const FINISH_ID: Record<VenueFinish, number> = { stone: 0, timber: 1, metal: 2, paving: 3 };

/** Metre-scaled finish survives spatial batching and instancing. Filtered joints
 * converge to their coverage below a pixel; no baked lighting, extra texture or animation clock. */
export function installVenueFinish(material: T.MeshStandardMaterial, finish: VenueFinish) {
  if (!Object.hasOwn(FINISH_ID, finish)) throw new Error('Unknown venue finish');
  if (material.userData.venueFinish !== undefined)
    throw new Error('Venue finish already installed');
  material.userData.venueFinish = finish;
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVenueWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 venuePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          venuePosition = instanceMatrix * venuePosition;
        #endif
        vVenueWorld = (modelMatrix * venuePosition).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vVenueWorld;
        ${PERIODIC_COVERAGE_GLSL}
        float venueHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float venueNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(mix(venueHash(i), venueHash(i+vec2(1.,0.)), f.x),
            mix(venueHash(i+vec2(0.,1.)), venueHash(i+vec2(1.,1.)), f.x), f.y);
        }
        vec2 venueFinishResponse() {
          vec3 face = abs(cross(dFdx(vVenueWorld), dFdy(vVenueWorld)));
          vec2 q = face.y > max(face.x, face.z) ? vVenueWorld.xz :
            (face.x > face.z ? vVenueWorld.zy : vVenueWorld.xy);
          float broad = venueNoise(q * .37);
          float resolvedNoise = 1.-smoothstep(.35, 1.5, max(fwidth(q.x), fwidth(q.y)));
          float mottling = (broad-.5)*.09*resolvedNoise;
          float seam = 0.;
          ${
            finish === 'timber'
              ? `
          float grain = sin(q.y*23. + venueNoise(q*.9)*4.);
          float filtered = 1.-smoothstep(.7, 2.5, fwidth(q.y*23.));
          mottling += grain*.035*filtered;
          vec2 grid = q*vec2(5.,.18);
          vec2 footprint = max(fwidth(grid), vec2(.00001));`
              : finish === 'metal'
                ? `
          vec2 grid = q*vec2(2.5,.5);
          vec2 footprint = max(fwidth(grid), vec2(.00001));`
                : finish === 'paving'
                  ? `
          vec2 grid = q/vec2(.6,.9);
          vec2 footprint = max(fwidth(grid), vec2(.00001));
          grid.x += mod(floor(grid.y), 2.)*.5;`
                  : `
          vec2 grid = q/vec2(.85,.32);
          vec2 footprint = max(fwidth(grid), vec2(.00001));
          grid.x += mod(floor(grid.y), 2.)*.5;`
          }
          float horizontal = apexStripeCoverage(grid.y, footprint.y, .014);
          float vertical = apexStripeCoverage(grid.x, footprint.x, .014);
          // Once a pixel spans rows, phase-average both brick offsets instead
          // of differentiating the discontinuous stagger or erasing the joints.
          ${
            finish === 'stone' || finish === 'paving'
              ? `
          float otherRow = apexStripeCoverage(grid.x + .5, footprint.x, .014);
          vertical = mix(vertical, (vertical + otherRow) * .5, smoothstep(.25, 1., footprint.y));
          `
              : ''
          }
          seam = 1. - (1. - horizontal) * (1. - vertical);
          return vec2(1.+mottling-seam*.14, mottling*.4+seam*.06);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nvec2 venueResponse=venueFinishResponse();\ndiffuseColor.rgb*=venueResponse.x;',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+venueResponse.y,.18,1.);',
      );
  };
  material.customProgramCacheKey = () =>
    `${previousKey}:aurel-metric-finish-v1:coverage-v2:${FINISH_ID[finish]}`;
  // Run-off streaks and panel-to-panel grime on walls (floors stay as laid).
  if (finish !== 'paving') installFacadeWeathering(material, finish, 'world');
  return material;
}

/** Shared across all four districts; physical glazing stays opaque to avoid a
 * second full-scene transmission pass for small, distant window panes. */
export function venueMaterials() {
  const materials = {
    stone: installVenueFinish(
      new T.MeshStandardMaterial({ color: 0xaca596, roughness: 0.91 }),
      'stone',
    ),
    timber: installVenueFinish(
      new T.MeshStandardMaterial({ color: 0x786047, roughness: 0.76 }),
      'timber',
    ),
    steel: installVenueFinish(
      new T.MeshStandardMaterial({ color: 0x344a4c, roughness: 0.43, metalness: 0.72 }),
      'metal',
    ),
    roof: installVenueFinish(
      new T.MeshStandardMaterial({ color: 0xb8b9ad, roughness: 0.66, metalness: 0.38 }),
      'metal',
    ),
    paving: installVenueFinish(
      new T.MeshStandardMaterial({ color: 0x8b8b7f, roughness: 0.94 }),
      'paving',
    ),
    glass: new T.MeshPhysicalMaterial({
      color: 0x3e6267,
      roughness: 0.17,
      metalness: 0.18,
      clearcoat: 0.8,
      transmission: 0,
    }),
    accent: new T.MeshStandardMaterial({ color: 0x9f5739, roughness: 0.8 }),
    interior: new T.MeshStandardMaterial({ color: 0x414b47, roughness: 0.89 }),
    fabric: new T.MeshStandardMaterial({ color: 0xd3c8ad, roughness: 0.94, side: T.DoubleSide }),
  };
  materials.fabric.userData.weatherSurface = 'fabric';
  // D26: reflective glazing with a parallax interior (no transmission pass).
  installGlazing(materials.glass);
  for (const [role, material] of Object.entries(materials)) material.name = `Aurel venue / ${role}`;
  return materials;
}
export type VenueMaterials = ReturnType<typeof venueMaterials>;
