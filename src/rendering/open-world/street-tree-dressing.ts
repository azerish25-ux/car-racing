import * as T from 'three';
import { TREE_SPECIES, TREE_STRIDE } from '../../simulation/open-world/placement.ts';
import { canvasTexture } from '../geometry.ts';
import { bindSeasonUniforms } from './season.ts';

/** Instanced kit at the foot of the street trees (street-trees.ts): cast-iron
 * tree grates (1.0 m square, radial slots, soil in the centre) in the town
 * footways, and a seasonal litter ring under every street tree: cherry
 * petals in spring (015, 096), fallen gold / red leaves in autumn (027, 090),
 * nothing in summer and winter. One grate draw, two litter draws per 512 m
 * chunk; chunks beyond `range` are hidden. */
export const STREET_DRESSING = Object.freeze({
  grate: 1.0,
  litter: 4.6,
  chunk: 512,
  range: { low: 0, medium: 260, high: 380, ultra: 520 } as Record<string, number>,
});

function grateTexture() {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#2a2b2c';
    c.fillRect(0, 0, 256, 256);
    // Soil and the trunk opening.
    c.fillStyle = '#2b2018';
    c.beginPath();
    c.arc(128, 128, 46, 0, Math.PI * 2);
    c.fill();
    // Radial slots in rings, raised rim.
    c.strokeStyle = '#0d0d0d';
    c.lineCap = 'round';
    for (const [r0, r1, n] of [
      [56, 80, 24],
      [88, 112, 36],
    ])
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
        c.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
        c.stroke();
      }
    c.strokeStyle = '#444546';
    c.lineWidth = 8;
    c.strokeRect(4, 4, 248, 248);
  });
}
/** Litter: scattered small ellipses (petals / leaves), denser near the
 * centre; alpha only (the colour follows the season). */
function litterTexture() {
  return canvasTexture(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 1500; k++) {
      const r = 118 * Math.sqrt(rnd()) * (0.35 + 0.65 * rnd()),
        a = rnd() * Math.PI * 2,
        x = 128 + Math.cos(a) * r,
        y = 128 + Math.sin(a) * r;
      const l = 0.55 + 0.45 * rnd();
      c.fillStyle = `rgba(${(255 * l) | 0},${(255 * l) | 0},${(255 * l) | 0},${0.55 + 0.45 * rnd()})`;
      c.beginPath();
      c.ellipse(x, y, 2.4 + rnd() * 1.6, 1.1 + rnd() * 0.8, rnd() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
  });
}
function litterMaterial(map: T.Texture, spring: T.Color | null, autumn: T.Color) {
  const m = new T.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (shader) => {
    bindSeasonUniforms(shader);
    shader.uniforms.owSpring = { value: spring ?? new T.Color(0, 0, 0) };
    shader.uniforms.owAutumn = { value: autumn };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec4 owSeason;\nuniform vec3 owSpring;\nuniform vec3 owAutumn;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float springAmount = ${spring ? '1.0' : '0.0'} * owSeason.x, autumnAmount = owSeason.z;
  vec3 tone = (owSpring * springAmount + owAutumn * autumnAmount) / max(springAmount + autumnAmount, 1e-3);
  diffuseColor.rgb = tone * diffuseColor.r;
  diffuseColor.a *= min(1.0, springAmount + autumnAmount);
}`,
      );
  };
  m.customProgramCacheKey = () => `festival-street-litter-${spring ? 'cherry' : 'leaf'}`;
  return m;
}

export class StreetTreeDressing {
  readonly root = new T.Group();
  readonly stats = { trees: 0, grates: 0, chunks: 0 };
  private readonly grateMaterial = new T.MeshStandardMaterial({
    map: grateTexture(),
    roughness: 0.62,
    metalness: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  private readonly litterMap = litterTexture();
  // Linear albedo: Somei-yoshino petals (015 #9b6996 graded), maple red,
  // ginkgo gold (089/097), cherry leaves orange-red.
  private readonly cherryLitter = litterMaterial(
    this.litterMap,
    new T.Color(0.66, 0.44, 0.52),
    new T.Color(0.5, 0.13, 0.04),
  );
  private readonly leafLitter = litterMaterial(this.litterMap, null, new T.Color(1, 1, 1));
  private readonly geometry = {
    grate: new T.BoxGeometry(STREET_DRESSING.grate, 0.03, STREET_DRESSING.grate),
    litter: new T.PlaneGeometry(STREET_DRESSING.litter, STREET_DRESSING.litter).rotateX(
      -Math.PI / 2,
    ),
  };
  private readonly chunks: { centre: T.Vector3; group: T.Group }[] = [];
  constructor(
    trees: Float32Array,
    height: (x: number, z: number) => number,
    /** Town footway trees get a grate (the avenues stand in the verge). */
    paved: (x: number, z: number) => boolean,
  ) {
    this.root.name = 'Street tree pits';
    this.grateMaterial.name = 'Street tree grates';
    const byChunk = new Map<string, number[]>();
    for (let i = 0; i < trees.length; i += TREE_STRIDE) {
      const key = `${Math.floor(trees[i] / STREET_DRESSING.chunk)},${Math.floor(trees[i + 1] / STREET_DRESSING.chunk)}`;
      byChunk.set(key, [...(byChunk.get(key) ?? []), i]);
    }
    const m = new T.Matrix4(),
      q = new T.Quaternion(),
      v = new T.Vector3(),
      one = new T.Vector3(1, 1, 1),
      up = new T.Vector3(0, 1, 0),
      n = new T.Vector3(),
      c = new T.Color();
    for (const list of byChunk.values()) {
      const group = new T.Group(),
        grates: T.Matrix4[] = [],
        cherry: [T.Matrix4, T.Color][] = [],
        leaves: [T.Matrix4, T.Color][] = [];
      const centre = new T.Vector3();
      for (const i of list) {
        const x = trees[i],
          z = trees[i + 1],
          species = trees[i + 3],
          y = height(x, z),
          yaw = trees[i + 4];
        centre.x += x / list.length;
        centre.z += z / list.length;
        centre.y += y / list.length;
        if (paved(x, z)) {
          q.setFromAxisAngle(up, yaw);
          grates.push(new T.Matrix4().compose(v.set(x, y + 0.005, z), q, one));
        }
        // Litter follows the local ground slope.
        const d = 1.6;
        n.set(
          height(x - d, z) - height(x + d, z),
          2 * d,
          height(x, z - d) - height(x, z + d),
        ).normalize();
        q.setFromUnitVectors(up, n).multiply(new T.Quaternion().setFromAxisAngle(up, yaw));
        m.compose(v.set(x, y + 0.02, z), q, one);
        const tint = 0.8 + 0.2 * trees[i + 5];
        if (species === TREE_SPECIES.STREET_CHERRY)
          cherry.push([m.clone(), new T.Color(tint, tint, tint)]);
        else
          leaves.push([
            m.clone(),
            species === TREE_SPECIES.STREET_MAPLE
              ? c.setRGB(0.5, 0.05, 0.025).multiplyScalar(tint).clone()
              : c.setRGB(0.62, 0.43, 0.04).multiplyScalar(tint).clone(),
          ]);
        this.stats.trees++;
      }
      if (grates.length) {
        const mesh = new T.InstancedMesh(this.geometry.grate, this.grateMaterial, grates.length);
        grates.forEach((g, k) => mesh.setMatrixAt(k, g));
        mesh.receiveShadow = true;
        mesh.name = 'Street tree grates';
        mesh.computeBoundingSphere();
        group.add(mesh);
        this.stats.grates += grates.length;
      }
      for (const [items, material, name] of [
        [cherry, this.cherryLitter, 'Street cherry petals'],
        [leaves, this.leafLitter, 'Street leaf litter'],
      ] as const) {
        if (!items.length) continue;
        const mesh = new T.InstancedMesh(this.geometry.litter, material, items.length);
        items.forEach(([mx, col], k) => {
          mesh.setMatrixAt(k, mx);
          mesh.setColorAt(k, col);
        });
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        mesh.name = name;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
      group.matrixAutoUpdate = false;
      this.root.add(group);
      this.chunks.push({ centre, group });
    }
    this.stats.chunks = this.chunks.length;
  }
  private readonly eye = new T.Vector3();
  update(camera: T.Camera, preset: string) {
    camera.getWorldPosition(this.eye);
    const range = (STREET_DRESSING.range[preset] ?? 260) + STREET_DRESSING.chunk * 0.71;
    for (const c of this.chunks)
      c.group.visible =
        range > STREET_DRESSING.chunk * 0.71 &&
        Math.hypot(c.centre.x - this.eye.x, c.centre.z - this.eye.z) < range;
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
    });
    for (const g of Object.values(this.geometry)) g.dispose();
    this.grateMaterial.map?.dispose();
    this.grateMaterial.dispose();
    this.litterMap.dispose();
    this.cherryLitter.dispose();
    this.leafLitter.dispose();
  }
}
