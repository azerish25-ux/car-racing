import * as T from 'three';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import { buildSea, installSeaWaves } from '../sea.ts';

/** The sea wave shader maps plane UV to world metres at this scale. */
const SEA_UV_METRES = 5500;

/**
 * Water of the region: the open sea (the circuit sea material and its wave
 * trains, re-meshed to reach the horizon: 160 km square (past the distant
 * ranges and the far plane), UVs keeping the
 * shader's metre scale) and the Ashvale river as a ribbon at its water level
 * along the valley channel down to the harbour.
 */
export class Water {
  readonly root = new T.Group();
  readonly sea: T.Mesh;
  readonly river: T.Mesh;
  constructor(field: TerrainField) {
    this.root.name = 'Festival water';
    const region = field.region;
    this.sea = buildSea(region.seaLevel);
    const size = 160000;
    const geometry = new T.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getX(i) * size) / SEA_UV_METRES, (uv.getY(i) * size) / SEA_UV_METRES);
    this.sea.geometry.dispose();
    this.sea.geometry = geometry;
    this.sea.name = 'Festival sea';
    this.sea.position.set(0, region.seaLevel - 0.05, -size / 2 + 2000);
    this.sea.userData.excludeMotionBlur = true;
    // River ribbon along the valley polyline at its water level.
    const points = region.valley.points,
      positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [],
      index: number[] = [];
    let along = 0;
    const width = region.valley.channel * 0.95;
    const steps: { x: number; z: number; y: number }[] = [];
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, az, ah] = points[k],
        [bx, bz, bh] = points[k + 1],
        len = Math.hypot(bx - ax, bz - az),
        n = Math.max(1, Math.ceil(len / 8));
      for (let i = k === 0 ? 0 : 1; i <= n; i++) {
        const t = i / n;
        steps.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: ah + (bh - ah) * t - 0.9 });
      }
    }
    steps.forEach((p, i) => {
      const a = steps[Math.max(0, i - 1)],
        b = steps[Math.min(steps.length - 1, i + 1)],
        dx = b.x - a.x,
        dz = b.z - a.z,
        len = Math.hypot(dx, dz) || 1,
        nx = dz / len,
        nz = -dx / len;
      if (i) along += Math.hypot(p.x - steps[i - 1].x, p.z - steps[i - 1].z);
      // The river meets the sea at sea level.
      const y = Math.max(region.seaLevel, p.y);
      for (const side of [-1, 1]) {
        positions.push(p.x + nx * side * width, y, p.z + nz * side * width);
        normals.push(0, 1, 0);
        uvs.push((side * width) / SEA_UV_METRES, along / SEA_UV_METRES);
      }
      if (i) {
        const base = i * 2;
        index.push(base - 2, base, base - 1, base - 1, base, base + 1);
      }
    });
    const river = new T.BufferGeometry();
    river.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    river.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    river.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    river.setIndex(index);
    river.computeBoundingSphere();
    const riverMaterial = (this.sea.material as T.MeshPhysicalMaterial).clone();
    riverMaterial.color.setHex(0x1d3a33);
    riverMaterial.name = 'Ashvale river';
    installSeaWaves(riverMaterial);
    riverMaterial.polygonOffset = true;
    riverMaterial.polygonOffsetFactor = -1;
    this.river = new T.Mesh(river, riverMaterial);
    this.river.name = 'Ashvale river';
    this.root.add(this.sea, this.river);
  }
  dispose() {
    this.sea.geometry.dispose();
    (this.sea.material as T.Material).dispose();
    this.river.geometry.dispose();
    (this.river.material as T.Material).dispose();
  }
}
