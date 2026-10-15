import * as T from 'three';
import { eventHallGeometry, eventHallShell, EVENT_HALL_ASSET } from './event-hall-assets.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { terrainFor } from './terrain.ts';
import { venuePlan } from './venue-plan.ts';
import { buildLighthouse, lighthouseSite } from './venue-lighthouse.ts';
import { inStandFootprint } from './grandstand.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { districtPlan, inDistrictFootprint, type DistrictSite } from './venue-districts.ts';
import { catalogueLandmark } from './venue-kit/plan.ts';

/** One original event hall, not another circuit or a copied licensed building.
 * The lower sphere is cut where its shell meets the load-bearing facade ring. */
export const LANDMARK = Object.freeze({
  radius: 21,
  centreHeight: 17,
  lowerCosine: -0.6,
  drumRadius: 16.8,
  drumTop: 4.4,
  plazaRadius: 27.5,
  columns: 24,
});
export interface LandmarkSite {
  x: number;
  z: number;
  s: number;
  yaw: number;
  deckY: number;
  bottomY: number;
  radius: number;
  clearance: number;
}
export function inLandmarkFootprint(site: LandmarkSite, x: number, z: number, margin = 0) {
  if (![x, z, margin].every(Number.isFinite) || margin < 0)
    throw new Error('Invalid landmark clearance query');
  return Math.hypot(x - site.x, z - site.z) <= site.radius + margin;
}

/** The entire plaza must remain on the distant terrain, outside road aprons,
 * stands, service compounds and districts. Planting consumes this same footprint.
 * Ground-contact height is sampled from actual terrain, never from road height. */
export function landmarkSitePlan(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  districts: readonly DistrictSite[] = districtPlan(track, services),
): LandmarkSite {
  if (venuePlan(track).landmark === 'lighthouse') return lighthouseSite(track);
  if (track.circuit.catalogue) {
    // Catalogue venues: the kit's levelled plaza behind the paddock.
    const site = catalogueLandmark(track);
    return {
      x: site.x,
      z: site.z,
      s: site.s,
      yaw: site.yaw,
      deckY: site.y + 0.06,
      bottomY: site.y - 0.25,
      radius: LANDMARK.plazaRadius,
      clearance: 45,
    };
  }
  const terrain = terrainFor(track);
  const point = trackPoint(),
    near = trackPoint();
  for (const shift of [0, -24, 24, -48, 48]) {
    const s = track.length * 0.13 + shift;
    track.at(s, point);
    for (const lateral of [90, 115, 140, -90, -115, -140]) {
      const x = point.x + point.nx * lateral,
        z = point.z + point.nz * lateral;
      let low = Infinity,
        high = -Infinity,
        clearance = Infinity,
        clear = true;
      for (const radius of [0, LANDMARK.plazaRadius * 0.5, LANDMARK.plazaRadius])
        for (let angle = 0; angle < 24; angle++) {
          const a = (angle * Math.PI) / 12;
          const wx = x + Math.cos(a) * radius,
            wz = z + Math.sin(a) * radius;
          const l = track.nearest(wx, wz, near);
          const margin = Math.abs(l) - track.boundary(near.s, l < 0 ? -1 : 1);
          if (
            Math.abs(l) < near.width + 42 ||
            margin < 25 ||
            inStandFootprint(track, wx, wz, 6) ||
            inServiceFootprint(services, wx, wz, 5) ||
            inDistrictFootprint(districts, wx, wz, 8)
          )
            clear = false;
          const ground = terrain.height(wx, wz);
          low = Math.min(low, ground);
          high = Math.max(high, ground);
          clearance = Math.min(clearance, margin);
        }
      if (clear && high - low < 0.8)
        return {
          x,
          z,
          s,
          yaw: Math.atan2(point.tx, point.tz),
          deckY: high + 0.06,
          bottomY: low - 0.25,
          radius: LANDMARK.plazaRadius,
          clearance,
        };
    }
  }
  throw new Error('No grounded, clear site for the original Aurel event hall');
}

/** Resolved seams belong to a physical panel material. Daytime receives the
 * actual scene light; night emission is controlled by VenueLighting. No unlit
 * billboard, reference image, extra light or animation clock is introduced. */
export function landmarkScreenMaterial() {
  const material = new T.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.015,
    metalness: 0.22,
    roughness: 0.5,
  });
  material.name = 'Original event-hall LED panels / daylight-responsive';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHallUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHallUv=uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      varying vec2 vHallUv;
      vec3 hallPattern() {
        float ribbon=smoothstep(-.15,.5,sin(vHallUv.y*9.+vHallUv.x*4.));
        vec3 colour=mix(vec3(.075,.22,.29),vec3(.39,.17,.075),ribbon);
        vec2 grid=vHallUv*vec2(48.,18.);
        vec2 footprint=max(fwidth(grid),vec2(.001));
        vec2 edge=abs(fract(grid+.5)-.5);
        vec2 seam=1.-smoothstep(vec2(.018),vec2(.018)+footprint,edge);
        float resolved=1.-smoothstep(.35,1.2,max(footprint.x,footprint.y));
        return colour*(1.-.32*resolved*max(seam.x,seam.y));
      }
    `,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb*=hallPattern();',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=hallPattern();',
      );
  };
  material.customProgramCacheKey = () => 'aurel-grounded-led-panels-v1';
  return material;
}

export interface VenueLandmark {
  site: LandmarkSite;
  display: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  structure: T.Group;
  solids: T.Mesh[];
}

/** The 42 m screen shell meets a continuous facade/column ring, with its lower
 * edge at 4.4 m. Foundations extend beneath the sampled terrain. All additions
 * are shared-material instanced geometry: this is not hundreds of tiny draws. */
export function buildVenueLandmark(track: Track): VenueLandmark {
  if (venuePlan(track).landmark === 'lighthouse') return buildLighthouse(track);
  const site = landmarkSitePlan(track);
  const structure = new T.Group();
  structure.name = 'Aurel event hall / grounded facade and public plaza';
  structure.position.set(site.x, site.deckY, site.z);
  structure.rotation.y = site.yaw;
  structure.userData.authoredAsset = EVENT_HALL_ASSET.revision;
  const concrete = new T.MeshStandardMaterial({ color: 0x8a887b, roughness: 0.93 });
  const stone = new T.MeshStandardMaterial({ color: 0x636e6c, roughness: 0.83 });
  const metal = new T.MeshStandardMaterial({ color: 0x33484d, metalness: 0.65, roughness: 0.39 });
  const glass = new T.MeshPhysicalMaterial({
    color: 0x17323c,
    metalness: 0.28,
    roughness: 0.19,
    clearcoat: 0.65,
    // Opaque coated glazing avoids a scene-wide transmission render pass.
    transmission: 0,
  });
  const add = <G extends T.BufferGeometry>(name: string, g: G, m: T.Material, y: number) => {
    const mesh = new T.Mesh(g, m);
    mesh.name = name;
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    structure.add(mesh);
    return mesh;
  };
  const thickness = site.deckY - site.bottomY;
  const foundation = add(
    'Terrain-seated plaza foundation',
    eventHallGeometry('foundation'),
    concrete,
    0,
  );
  foundation.scale.y = thickness;
  add('Entrance plinth', eventHallGeometry('plinth'), stone, 0);
  const facade = add('Continuous load-bearing facade drum', eventHallGeometry('facade'), glass, 0);
  const bearing = add('Shell bearing ring', eventHallGeometry('bearing'), metal, 0);
  add('Sheltered entrance canopy', eventHallGeometry('canopy'), metal, 0);
  const columns = new T.InstancedMesh(eventHallGeometry('column'), metal, LANDMARK.columns);
  columns.name = 'Twenty-four facade and shell supports';
  const transform = new T.Object3D();
  for (let i = 0; i < LANDMARK.columns; i++) {
    const angle = (i / LANDMARK.columns) * Math.PI * 2;
    transform.position.set(Math.sin(angle) * 16.91, 2.2, Math.cos(angle) * 16.91);
    transform.rotation.y = angle;
    transform.updateMatrix();
    columns.setMatrixAt(i, transform.matrix);
  }
  columns.computeBoundingBox();
  columns.computeBoundingSphere();
  columns.castShadow = true;
  columns.receiveShadow = true;
  structure.add(columns);
  // Stable pedestrian furniture stays on the plaza and outside its doors.
  const bollards = new T.InstancedMesh(eventHallGeometry('bollard'), metal, 20);
  bollards.name = 'Plaza boundary bollards';
  for (let i = 0; i < bollards.count; i++) {
    const angle = ((i + 0.5) / bollards.count) * Math.PI * 2;
    transform.position.set(Math.sin(angle) * 25.9, 0.45, Math.cos(angle) * 25.9);
    transform.rotation.set(0, 0, 0);
    transform.updateMatrix();
    bollards.setMatrixAt(i, transform.matrix);
  }
  bollards.computeBoundingBox();
  bollards.computeBoundingSphere();
  bollards.castShadow = true;
  structure.add(bollards);
  const shell = eventHallShell();
  const display = new T.Mesh(shell.geometry, landmarkScreenMaterial());
  shell.bind(display);
  display.name = 'Original LED venue landmark / structurally grounded event hall';
  display.position.set(site.x, site.deckY + LANDMARK.centreHeight, site.z);
  display.rotation.y = site.yaw;
  display.castShadow = true;
  display.receiveShadow = true;
  return { site, display, structure, solids: [foundation, facade, bearing, display] };
}
