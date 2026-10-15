import * as T from 'three';
import { Random } from '../../core/math.ts';
import { trackPoint } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { terrainFor } from '../terrain.ts';
import type { VenueKitContext } from './context.ts';

/** Instanced boulders and dry scrub on the open ground beyond the skirts,
 * tiled 320 m for frustum culling and shown within 900 m (distance LOD). */
export function buildScatter(kit: VenueKitContext) {
  const count = kit.style.scrub;
  if (!count) return;
  const track = kit.track,
    terrain = terrainFor(track),
    random = new Random(0x51c4 + Math.round(track.length)),
    p = trackPoint(),
    tile = 320;
  const desert = !!kit.style.desertScrub;
  const shrubMaterial = new T.MeshStandardMaterial({
    color: desert ? 0x8b7a4e : 0x4f5d32,
    roughness: 0.95,
  });
  const tiles = new Map<string, { rocks: T.Matrix4[]; shrubs: T.Matrix4[] }>();
  const m = new T.Matrix4(),
    q = new T.Quaternion(),
    e = new T.Euler();
  for (let attempt = 0; attempt < count * 3 && attempt < 4000; attempt++) {
    const s = random.next() * track.length,
      side = random.next() < 0.5 ? -1 : 1;
    track.at(s, p);
    const l = side * (track.boundaryAt(p, side) + 30 + random.next() * 160),
      x = p.x + p.nx * l,
      z = p.z + p.nz * l;
    if (
      kit.overOtherSection(x, z, s, 30) ||
      kit.blocks(x, z, 4) ||
      inStandFootprint(track, x, z, 6)
    )
      continue;
    const y = terrain.height(x, z);
    if (kit.meta.seaLevel !== null && y < kit.meta.seaLevel + 0.5) continue;
    const key = `${Math.floor(x / tile)},${Math.floor(z / tile)}`;
    let cell = tiles.get(key);
    if (!cell) tiles.set(key, (cell = { rocks: [], shrubs: [] }));
    const rock = random.next() < (desert ? 0.45 : 0.35),
      size = rock ? 0.6 + random.next() * random.next() * 3.5 : 0.5 + random.next() * 1.1;
    e.set(random.next() * 0.6, random.next() * Math.PI * 2, random.next() * 0.6);
    q.setFromEuler(e);
    m.compose(
      new T.Vector3(x, y + (rock ? size * 0.25 : size * 0.45), z),
      q,
      new T.Vector3(size * (0.8 + random.next() * 0.5), size * (rock ? 0.7 : 0.9), size),
    );
    (rock ? cell.rocks : cell.shrubs).push(m.clone());
  }
  const rockGeometry = new T.IcosahedronGeometry(1, 1),
    shrubGeometry = new T.IcosahedronGeometry(1, 0);
  for (const [key, cell] of tiles) {
    const group = new T.Group();
    group.name = `Venue kit scatter ${key}`;
    for (const [geometry, material, list, name] of [
      [rockGeometry, kit.materials.rock, cell.rocks, 'Boulders'],
      [shrubGeometry, shrubMaterial, cell.shrubs, 'Scrub'],
    ] as const) {
      if (!list.length) continue;
      const im = new T.InstancedMesh(geometry, material, list.length);
      list.forEach((x, i) => im.setMatrixAt(i, x));
      im.computeBoundingSphere();
      im.castShadow = true;
      im.receiveShadow = true;
      im.name = name;
      group.add(im);
    }
    kit.detail(group, 900);
  }
}
