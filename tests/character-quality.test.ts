import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import { glovePalmGeometry, buildGlove } from '../src/rendering/driver-anatomy.ts';
import { driverMaterials } from '../src/rendering/driver-materials.ts';
import { HAND_ANCHOR, wheelGripGeometry } from '../src/rendering/wheel-grip.ts';
import {
  selectorBezelGeometry,
  selectorCapGeometry,
  displaySurroundGeometry,
  SELECTOR_Y,
} from '../src/rendering/cockpit.ts';
import { peopleGeometry, CREW_REST } from '../src/rendering/people-asset.ts';
import { installCrewHelmetFinish } from '../src/rendering/crew-geometry.ts';
import driver from '../src/rendering/apx01-driver.manifest.json';
import people from '../src/rendering/aurel-people.manifest.json';

function finite(g: T.BufferGeometry) {
  for (const a of Object.values(g.attributes))
    expect([...a.array].every(Number.isFinite)).toBe(true);
  g.computeBoundingBox();
  expect(g.boundingBox!.isEmpty()).toBe(false);
}

describe('Driver and service-character construction', () => {
  it('places the continuous hand back ahead of the suede in the actual driver sightline', () => {
    const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    for (const side of [-1, 1]) {
      const palm = new T.Mesh(glovePalmGeometry(), material);
      palm.position.set(side * HAND_ANCHOR.x, HAND_ANCHOR.y, HAND_ANCHOR.z);
      const grip = new T.Mesh(wheelGripGeometry(side), material);
      palm.updateMatrixWorld(true);
      grip.updateMatrixWorld(true);
      finite(palm.geometry);
      for (const y of [-0.024, 0, 0.022]) {
        const ray = new T.Raycaster(
          new T.Vector3(side * HAND_ANCHOR.x, y + HAND_ANCHOR.y, -0.2),
          new T.Vector3(0, 0, 1),
        );
        const skin = ray.intersectObject(palm),
          suede = ray.intersectObject(grip);
        expect(skin.length).toBeGreaterThan(0);
        expect(suede.length).toBeGreaterThan(0);
        expect(skin[0].distance).toBeLessThan(suede[0].distance - 0.008);
      }
      expect(palm.geometry.boundingBox!.max.z).toBeLessThan(-0.009);
      expect(palm.geometry.boundingBox!.getSize(new T.Vector3()).x).toBeLessThan(0.066);
      palm.geometry.dispose();
      grip.geometry.dispose();
    }
    material.dispose();
  });
  it('retains independently articulated thumbs and the established distal-index topology', () => {
    const m = driverMaterials();
    expect(() => buildGlove(0, m)).toThrow();
    for (const side of [-1, 1]) {
      const glove = buildGlove(side, m);
      expect(glove.root.children).toContain(glove.index);
      expect(glove.root.children).toContain(glove.thumb);
      const finger = (glove.index.children[0] as T.Mesh).geometry;
      expect(finger.getAttribute('position').count).toBe(21 * 17 + 2 * 18);
      expect(glove.thumb.position.z).toBe(-0.035);
      glove.root.traverse((o) => {
        if (o instanceof T.Mesh) {
          finite(o.geometry);
          o.geometry.dispose();
        }
      });
    }
    m.suit.normalMap!.dispose();
    m.suit.roughnessMap!.dispose();
    Object.values(m).forEach((v) => v.dispose());
  });
  it('has bored selector rings and a genuinely open display frame', () => {
    const m = new T.MeshBasicMaterial({ side: T.DoubleSide });
    for (const [geometry, witness] of [
      [selectorBezelGeometry(), new T.Vector3(0.0262, 0, -0.1)],
      [displaySurroundGeometry(), new T.Vector3(0.096, 0, -0.1)],
    ] as const) {
      finite(geometry);
      const mesh = new T.Mesh(geometry, m);
      mesh.updateMatrixWorld(true);
      expect(
        new T.Raycaster(new T.Vector3(0, 0, -0.1), new T.Vector3(0, 0, 1)).intersectObject(mesh),
      ).toHaveLength(0);
      expect(
        new T.Raycaster(witness, new T.Vector3(0, 0, 1)).intersectObject(mesh).length,
      ).toBeGreaterThan(0);
      geometry.dispose();
    }
    m.dispose();
  });
  it('keeps the enlarged scale surround below the unchanged display aperture', () => {
    const bezel = selectorBezelGeometry();
    const screenBottom = 0.014 - 0.09 / 2;
    expect(SELECTOR_Y + bezel.boundingBox!.max.y).toBeLessThan(screenBottom - 0.001);
    expect(SELECTOR_Y + bezel.boundingBox!.min.y).toBeGreaterThan(-0.1);
    const cap = selectorCapGeometry();
    finite(cap);
    expect(cap.boundingBox!.getSize(new T.Vector3()).x).toBeLessThan(0.037);
    expect(cap.boundingBox!.getSize(new T.Vector3()).y).toBeCloseTo(0.014, 6);
    cap.dispose();
    bezel.dispose();
  });
  it('retains the driver hardpoints and binds each regenerated asset to its author', () => {
    for (const [path, sha] of [
      ['scripts/author-driver.py', driver.sourceSHA256],
      ['scripts/author-people.py', people.sourceSHA256],
    ])
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(sha);
    expect(driver.bones).toHaveLength(9);
    expect(driver.roles).toEqual(['suit_torso', 'r_sleeve', 'l_sleeve']);
    expect(driver.rest.R.shoulder).toEqual([
      -0.1599999964237213, 0.014999999664723873, -0.47999998927116394,
    ]);
    expect(CREW_REST).toHaveLength(15);
    expect(CREW_REST[4].toArray()).toEqual([-0.21, 1.09, 0]);
    expect(CREW_REST[7].toArray()).toEqual([0.21, 1.09, 0]);
    expect(people.triangles.crew_high).toBeLessThan(6000);
    expect(people.triangles.crew_mid).toBeLessThan(2500);
    expect(people.triangles.crew_mid).toBeLessThan(people.triangles.crew_high * 0.5);
  });
  it('keeps canonical joint transforms consistent with their binds without rounding skin weights', () => {
    const raw = gunzipSync(readFileSync('src/rendering/apx01-driver.glb.gz'));
    const jsonLength = raw.readUInt32LE(12), bin = raw.subarray(28 + jsonLength);
    const g = JSON.parse(raw.subarray(20, 20 + jsonLength).toString()) as {
      nodes: { children?: number[]; rotation?: number[]; translation?: number[]; scale?: number[] }[];
      skins: { joints: number[]; inverseBindMatrices: number }[];
      accessors: { bufferView: number; byteOffset?: number }[];
      bufferViews: { byteOffset?: number; byteLength: number }[];
      meshes: { primitives: { attributes: Record<string, number> }[] }[];
    };
    const objects = g.nodes.map((node) => {
      const object = new T.Object3D();
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
      expect(object.quaternion.length()).toBeCloseTo(1, 12);
      return object;
    });
    g.nodes.forEach((node, i) => node.children?.forEach((j) => objects[i].add(objects[j])));
    for (const object of objects) if (!object.parent) object.updateMatrixWorld(true);
    for (const skin of g.skins) {
      const a = g.accessors[skin.inverseBindMatrices], v = g.bufferViews[a.bufferView];
      const start = (a.byteOffset ?? 0) + (v.byteOffset ?? 0);
      skin.joints.forEach((joint, i) => {
        const values = Array.from({ length: 16 }, (_, k) => bin.readFloatLE(start + i * 64 + k * 4));
        const restored = objects[joint].matrixWorld.clone().multiply(new T.Matrix4().fromArray(values));
        const expected = new T.Matrix4().elements;
        restored.elements.forEach((n, k) => expect(Math.abs(n - expected[k])).toBeLessThan(2e-7));
      });
    }
    // The two original sleeve influence buffers are retained verbatim, not
    // coarsened as a side effect of making joint decomposition reproducible.
    let buffers = 0;
    for (const mesh of g.meshes) for (const primitive of mesh.primitives) {
      const index = primitive.attributes.WEIGHTS_0;
      if (index === undefined) continue;
      const v = g.bufferViews[g.accessors[index].bufferView], start = v.byteOffset ?? 0;
      expect(createHash('sha256').update(bin.subarray(start, start + v.byteLength)).digest('hex'))
        .toBe('948283ff2ce2d639b10e806c81a901c2caaddc81bc45c7ffaecbd6a7ce7a625d');
      buffers++;
    }
    expect(buffers).toBe(2);
  });
  it('keeps the new visor on the front and within millimetres of the actual authored shell', () => {
    const g = peopleGeometry('helmet'),
      p = g.getAttribute('position'),
      c = g.getAttribute('color');
    const isLens = (i: number) => c.getX(i) < 0.021 && c.getY(i) > 0.03 && c.getZ(i) > 0.039;
    const isShell = (i: number) => c.getX(i) > 0.8 && c.getY(i) > 0.81 && c.getZ(i) > 0.76;
    const shell = g.clone(),
      indices: number[] = [];
    for (let i = 0; i < g.index!.count; i += 3) {
      const tri = [0, 1, 2].map((j) => g.index!.getX(i + j));
      if (tri.every(isShell)) indices.push(...tri);
    }
    shell.setIndex(indices);
    const mat = new T.MeshBasicMaterial({ side: T.DoubleSide }),
      mesh = new T.Mesh(shell, mat);
    mesh.updateMatrixWorld(true);
    let count = 0;
    for (let i = 0; i < p.count; i++)
      if (isLens(i)) {
        count++;
        expect(p.getZ(i)).toBeGreaterThan(0);
        expect(p.getY(i)).toBeGreaterThan(-0.052);
        expect(p.getY(i)).toBeLessThan(0.044);
        if (count % 11) continue;
        const point = new T.Vector3().fromBufferAttribute(p, i),
          origin = new T.Vector3(0, point.y, 0);
        const direction = point.clone().sub(origin),
          distance = direction.length();
        direction.normalize();
        const hits = new T.Raycaster(origin, direction).intersectObject(mesh);
        expect(hits.length).toBeGreaterThan(0);
        const gap = distance - hits[0].distance;
        expect(gap).toBeGreaterThan(0.0003);
        expect(gap).toBeLessThan(0.008);
      }
    expect(count).toBeGreaterThan(400);
    g.dispose();
    shell.dispose();
    mat.dispose();
  });
  it('composes one idempotent lens-roughness hook without changing colour or allocating maps', () => {
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
    material.onBeforeCompile = (s) => {
      s.uniforms.retained = { value: 42 };
    };
    expect(installCrewHelmetFinish(material)).toBe(material);
    const key = material.customProgramCacheKey();
    installCrewHelmetFinish(material);
    expect(material.customProgramCacheKey()).toBe(key);
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: {},
    } as Parameters<T.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.retained.value).toBe(42);
    expect(shader.vertexShader.match(/varying float vCrewLens/g)).toHaveLength(1);
    expect(shader.fragmentShader).toContain('roughnessFactor=mix(roughnessFactor,.17');
    expect(material.roughness).toBe(0.35);
    expect(material.map).toBeNull();
    expect(material.roughnessMap).toBeNull();
    material.dispose();
  });
});
