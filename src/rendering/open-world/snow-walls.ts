import * as T from 'three';
import type { RoadNetwork } from '../../simulation/open-world/road-network.ts';
import { seasonUniforms } from './season.ts';

/** Lowest road level (m) where winter snow walls are ploughed. */
const SNOW_WALL_ALTITUDE = 260;
/** The cut beside the road must rise at least this far above the asphalt. */
const MIN_CUT = 0.9;
/** Sampling stride along each road (network samples). */
const STRIDE = 1;

/**
 * Winter snow corridor (ref 070): on high mountain roads, where the road is
 * cut into the slope, ploughed snow stands as layered walls 2.5–7 m above the
 * asphalt on the uphill side. Walls only stand where the carved terrain
 * beside the shoulder already rises above the road, so a car leaving the
 * road meets the slope it would have met anyway; there is no new collider.
 * Visible in winter only; one merged mesh and one draw.
 */
export class SnowWalls {
  readonly root = new T.Group();
  readonly stats = { metres: 0, triangles: 0 };
  private readonly material: T.MeshStandardMaterial;
  private readonly texture: T.CanvasTexture | null;
  constructor(network: RoadNetwork, ground: (x: number, z: number) => number) {
    this.root.name = 'Winter snow walls';
    this.texture = typeof document === 'undefined' ? null : strataTexture();
    this.material = new T.MeshStandardMaterial({
      name: 'Ploughed snow strata',
      color: 0xf4f7fb,
      roughness: 0.74,
      metalness: 0,
      map: this.texture,
      bumpMap: this.texture,
      bumpScale: 2.5,
      side: T.DoubleSide,
    });
    const position: number[] = [],
      uv: number[] = [],
      index: number[] = [];
    for (const edge of network.edges) {
      if (edge.roadClass !== 'mountain' && edge.roadClass !== 'country') continue;
      const reach = edge.spec.halfWidth + edge.spec.shoulder + 0.45;
      for (const side of [-1, 1]) {
        let run: number[] = [];
        const flush = () => {
          if (run.length >= 2) this.wall(run, position, uv, index);
          run = [];
        };
        let along = 0;
        for (let i = edge.first; i <= edge.last; i += STRIDE) {
          const y = network.y[i];
          // Left of travel is (-tz, tx) in x/z.
          const nx = -network.tz[i] * side,
            nz = network.tx[i] * side;
          const x = network.x[i] + nx * reach,
            z = network.z[i] + nz * reach;
          const cut = ground(x + nx * 1.5, z + nz * 1.5) - y;
          if (y < SNOW_WALL_ALTITUDE || cut < MIN_CUT) {
            flush();
            continue;
          }
          if (i > edge.first)
            along += Math.hypot(network.x[i] - network.x[i - 1], network.z[i] - network.z[i - 1]);
          // Ploughed height grows with the cut and with altitude.
          const height = Math.min(
            7,
            Math.max(2.5, cut * 1.15 + 1.2 + (y - SNOW_WALL_ALTITUDE) * 0.006),
          );
          run.push(x, y - 0.25, z, nx, nz, height, along);
        }
        flush();
      }
    }
    if (index.length) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new T.Mesh(geometry, this.material);
      mesh.name = 'Snow wall corridor';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.stats.triangles = index.length / 3;
    }
    this.root.visible = false;
  }
  /** One wall: a near-vertical face leaning back 0.5 m, a rounded crest and
   * a back slope into the cut. `run` holds x, y, z, nx, nz, height, along. */
  private wall(run: number[], position: number[], uv: number[], index: number[]) {
    const profile: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.18, 0.55],
      [0.38, 0.97],
      [0.75, 1.02],
      [2.6, 0.55],
    ];
    const n = run.length / 7;
    const base = position.length / 3;
    for (let k = 0; k < n; k++) {
      const [x, y, z, nx, nz, h, along] = run.slice(k * 7, k * 7 + 7);
      // A little irregularity along the wall (plough passes, slumps).
      const wobble = 1 + 0.08 * Math.sin(along * 0.37) + 0.05 * Math.sin(along * 1.13);
      for (const [out, up] of profile) {
        const height = up * h * wobble;
        position.push(x + nx * out, y + height, z + nz * out);
        uv.push(along / 16, height / 6);
      }
    }
    const m = profile.length;
    for (let k = 0; k + 1 < n; k++)
      for (let j = 0; j + 1 < m; j++) {
        const a = base + k * m + j,
          b = a + 1,
          c = a + m,
          d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    this.stats.metres += run[(n - 1) * 7 + 6] - run[6];
  }
  update() {
    this.root.visible = seasonUniforms.owSnowCover.value > 0.5 && this.stats.triangles > 0;
  }
  dispose() {
    for (const child of this.root.children) (child as T.Mesh).geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}

/** Layered plough strata: horizontal bands of compacted and fresh snow with
 * dirty seams and vertical cutter scallops (ref 070). Greyscale, used as both
 * albedo modulation and bump. */
function strataTexture() {
  const width = 1024,
    height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#f4f6f9';
  c.fillRect(0, 0, width, height);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Seasonal layers: thin wavy horizontal seams (compacted or dusty
  // snowfalls), each with its own slow undulation, wrapping seamlessly.
  for (let y = 4; y < height; y += 4 + random() * 14) {
    const shade = 205 + random() * 40,
      alpha = 0.18 + random() * 0.4,
      amp = 1 + random() * 4,
      waves = 1 + Math.floor(random() * 4),
      phase = random() * Math.PI * 2,
      thick = 0.8 + random() * 2.4;
    c.strokeStyle = `rgba(${shade - 22},${shade - 12},${shade},${alpha})`;
    c.lineWidth = thick;
    c.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const yy = y + amp * Math.sin((x / width) * Math.PI * 2 * waves + phase);
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  // Rotary-blower scallops: shallow horizontal arcs left by the cutter.
  for (let k = 0; k < 160; k++) {
    const x = random() * width,
      y = random() * height,
      w = 40 + random() * 120;
    c.strokeStyle = `rgba(180,192,210,${0.08 + random() * 0.14})`;
    c.lineWidth = 2 + random() * 5;
    c.beginPath();
    c.ellipse(x, y, w, 6 + random() * 10, 0, Math.PI * 0.1, Math.PI * 0.9);
    c.stroke();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
