import { stadiumSeatGeometry, type SeatTier } from './stadium-seat.ts';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SceneryPassDetail } from './scenery-pass-detail.ts';
import {
  SECONDARY_STAND_ASSET,
  SECONDARY_ROLES,
  SECONDARY_TIERS,
  secondaryStandGeometry,
  type SecondaryRole,
  type SecondaryTier,
} from './secondary-grandstand-assets.ts';

/** Optical distances, not raw camera metres. Separate histories keep a low
 * resolution reflection or a shadow pass from changing the driving view. */
export function secondaryStandTier(distance: number, previous?: SecondaryTier): SecondaryTier {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid A12 detail distance');
  if (previous === 0 && distance < 154) return 0;
  if (previous === 1 && distance >= 126 && distance < 357.5) return 1;
  if (previous === 2 && distance >= 292.5) return 2;
  return distance < 140 ? 0 : distance < 325 ? 1 : 2;
}

/** Every tier exists in one owned allocation. Only the selected index range
 * changes; no geometry is created, disposed or uploaded during a camera cut. */
export function packSecondaryStandRole(role: SecondaryRole, mirror = false) {
  if (!SECONDARY_ROLES.includes(role)) throw new Error('Invalid A12 mesh role');
  // Seats are the shared moulded stadium shell (three tiers), not the
  // authored box seat; every other role keeps its authored geometry.
  const input = SECONDARY_TIERS.map((tier, i) =>
    role === 'seat' && !mirror
      ? stadiumSeatGeometry(i as SeatTier)
      : secondaryStandGeometry(`${role}_${tier}`, mirror),
  );
  return packLevels(input, `${role}${mirror ? ' / mirrored' : ''}`);
}

/** Each unchanged 24 m half contains three rail bays and one protected aisle.
 * Both roles use the same opaque steel material. Baking their translations
 * once saves one draw per stand/pass without removing a triangle or increasing
 * the retained 7,000-triangle allocation ceiling. */
export function packSecondaryStandCirculation(mirror = false) {
  const input = SECONDARY_TIERS.map((tier) => {
    const rail = secondaryStandGeometry(`rails_${tier}`, mirror);
    const aisle = secondaryStandGeometry(`aisle_${tier}`, mirror);
    const parts = [-8, 0, 8].map((z) => rail.clone().translate(0, 0, z));
    parts.push(aisle);
    try {
      const geometry = mergeGeometries(parts, false);
      if (!geometry) throw new Error('Incompatible A12 circulation attributes');
      return geometry;
    } finally {
      rail.dispose();
      parts.forEach((part) => part.dispose());
    }
  });
  return packLevels(input, `circulation${mirror ? ' / mirrored' : ''}`);
}

function packLevels(input: T.BufferGeometry[], name: string) {
  const ranges = input.map((geometry, i) => ({
    start: input.slice(0, i).reduce((n, g) => n + g.index!.count, 0),
    count: geometry.index!.count,
  }));
  let geometry: T.BufferGeometry;
  try {
    const merged = mergeGeometries(input, false);
    if (!merged) throw new Error('Incompatible A12 detail attributes');
    geometry = merged;
  } finally {
    input.forEach((g) => g.dispose());
  }
  geometry.name = `A12 packed ${name}`;
  geometry.userData.authoredAsset = SECONDARY_STAND_ASSET.revision;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const select = (tier: SecondaryTier) => {
    if (!Number.isInteger(tier) || !ranges[tier]) throw new Error('Invalid A12 detail tier');
    geometry.setDrawRange(ranges[tier].start, ranges[tier].count);
  };
  select(0);
  return {
    geometry,
    ranges,
    select,
    bind(mesh: T.InstancedMesh) {
      if (mesh.geometry !== geometry || !mesh.boundingSphere)
        throw new Error('A12 detail requires the owned geometry and measured instance bounds');
      const detail = new SceneryPassDetail();
      const eye = new T.Vector3(),
        sphere = new T.Sphere();
      const history = new WeakMap<T.Camera, SecondaryTier>();
      const before = mesh.onBeforeRender,
        after = mesh.onAfterRender;
      const beforeShadow = mesh.onBeforeShadow,
        afterShadow = mesh.onAfterShadow;
      const choose = (renderer: T.WebGLRenderer, camera: T.Camera) => {
        eye.setFromMatrixPosition(camera.matrixWorld);
        sphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld);
        const distance = detail.distance(
          Math.max(0, eye.distanceTo(sphere.center) - sphere.radius),
          camera,
          renderer,
        );
        const tier = secondaryStandTier(distance, history.get(camera));
        history.set(camera, tier);
        mesh.userData.secondaryStandTier = tier;
        select(tier);
      };
      mesh.onBeforeRender = function (...args) {
        before.apply(this, args);
        choose(args[0], args[2]);
      };
      mesh.onAfterRender = function (...args) {
        select(0);
        after.apply(this, args);
      };
      mesh.onBeforeShadow = function (...args) {
        beforeShadow.apply(this, args);
        choose(args[0], args[3]);
      };
      mesh.onAfterShadow = function (...args) {
        select(0);
        afterShadow.apply(this, args);
      };
      return () => {
        select(0);
        mesh.onBeforeRender = before;
        mesh.onAfterRender = after;
        mesh.onBeforeShadow = beforeShadow;
        mesh.onAfterShadow = afterShadow;
      };
    },
  };
}
export type PackedSecondaryRole = ReturnType<typeof packSecondaryStandRole>;
