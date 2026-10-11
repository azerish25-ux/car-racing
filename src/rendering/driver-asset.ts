import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import manifest from './apx01-driver.manifest.json' with { type: 'json' };

const abort = () => new DOMException('Driver loading cancelled', 'AbortError');
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
interface Document {
  asset?: { version?: string };
  buffers?: { byteLength?: number; uri?: string }[];
  bufferViews?: { buffer?: number; byteLength?: number; byteOffset?: number }[];
  accessors?: { count?: number; sparse?: unknown }[];
  nodes?: {
    name?: string;
    mesh?: number;
    skin?: number;
    children?: number[];
    camera?: number;
    extras?: { apex_character_role?: string };
  }[];
  meshes?: {
    primitives?: {
      attributes?: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
      targets?: unknown[];
      extensions?: unknown;
    }[];
  }[];
  skins?: { joints?: number[]; inverseBindMatrices?: number }[];
  materials?: { name?: string }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  [key: string]: unknown;
}
/** A separate character contract: nine bounded skin joints, three known roles,
 * vertex-coloured fabric and no images, external buffers or imported motion.
 * The mechanical car's static loader is deliberately NOT relaxed. */
export function validateDriverDocument(value: unknown) {
  const fail = (): never => {
    throw new Error('Invalid authored driver contract');
  };
  if (!value || typeof value !== 'object') fail();
  const d = value as Document;
  if (
    d.asset?.version !== '2.0' ||
    d.scene !== 0 ||
    d.scenes?.length !== 1 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    !Number.isInteger(d.buffers[0].byteLength) ||
    d.buffers[0].byteLength! < 1 ||
    d.buffers[0].byteLength! > manifest.maxRawBytes ||
    d.nodes?.length !== 13 ||
    d.meshes?.length !== 3 ||
    d.materials?.length !== 1 ||
    d.materials[0].name !== 'APX / woven suit' ||
    d.skins?.length !== 1 ||
    !Array.isArray(d.accessors) ||
    !Array.isArray(d.bufferViews)
  )
    fail();
  for (const key of [
    'images',
    'textures',
    'samplers',
    'animations',
    'cameras',
    'extensionsUsed',
    'extensionsRequired',
  ])
    if (d[key] !== undefined && (!Array.isArray(d[key]) || (d[key] as unknown[]).length)) fail();
  const seen = new Set<number>(),
    roles = new Set<string>(),
    meshes = new Set<number>();
  const walk = (id: number) => {
    if (!Number.isInteger(id) || id < 0 || id >= d.nodes!.length || seen.has(id)) fail();
    seen.add(id);
    const node = d.nodes![id];
    if (node.camera !== undefined) fail();
    if (node.mesh !== undefined) {
      const role = node.extras?.apex_character_role;
      if (
        !role ||
        !manifest.roles.includes(role) ||
        roles.has(role) ||
        !Number.isInteger(node.mesh) ||
        meshes.has(node.mesh) ||
        (role === 'suit_torso' ? node.skin !== undefined : node.skin !== 0)
      )
        fail();
      roles.add(role!);
      meshes.add(node.mesh);
      const primitive = d.meshes![node.mesh]?.primitives;
      if (primitive?.length !== 1) fail();
      const p = primitive![0];
      const expected =
        role === 'suit_torso'
          ? 'COLOR_0,NORMAL,POSITION,TEXCOORD_0'
          : 'COLOR_0,JOINTS_0,NORMAL,POSITION,TEXCOORD_0,WEIGHTS_0';
      if (
        !p.attributes ||
        Object.keys(p.attributes).sort().join(',') !== expected ||
        p.material !== 0 ||
        (p.mode !== undefined && p.mode !== 4) ||
        p.targets ||
        p.extensions
      )
        fail();
      for (const a of Object.values(p.attributes!))
        if (
          !Number.isInteger(a) ||
          !d.accessors![a] ||
          !Number.isInteger(d.accessors![a].count) ||
          d.accessors![a].count! < 3 ||
          d.accessors![a].count! > manifest.maxVertices ||
          d.accessors![a].sparse
        )
          fail();
      const index = d.accessors![p.indices!];
      if (
        !Number.isInteger(p.indices) ||
        !index ||
        !Number.isInteger(index.count) ||
        index.count! < 3 ||
        index.count! % 3 ||
        index.count! > manifest.maxTriangles * 3
      )
        fail();
    }
    if (node.children !== undefined && !Array.isArray(node.children)) fail();
    for (const child of node.children ?? []) walk(child);
  };
  if (!Array.isArray(d.scenes![0].nodes)) fail();
  for (const id of d.scenes![0].nodes!) walk(id);
  if (seen.size !== d.nodes!.length || roles.size !== 3) fail();
  const skin = d.skins![0],
    joints = skin.joints;
  if (
    !joints ||
    joints.length !== manifest.bones.length ||
    new Set(joints).size !== joints.length ||
    joints.some(
      (id) => !Number.isInteger(id) || !d.nodes![id] || d.nodes![id].mesh !== undefined,
    ) ||
    joints
      .map((id) => d.nodes![id].name)
      .sort()
      .join(',') !== [...manifest.bones].sort().join(',') ||
    !Number.isInteger(skin.inverseBindMatrices) ||
    d.accessors![skin.inverseBindMatrices!]?.count !== joints.length
  )
    fail();
  for (const view of d.bufferViews!)
    if (
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      view.byteLength! < 1 ||
      !Number.isInteger(view.byteOffset ?? 0) ||
      (view.byteOffset ?? 0) < 0 ||
      (view.byteOffset ?? 0) + view.byteLength! > d.buffers![0].byteLength!
    )
      fail();
}

function release(root: T.Object3D) {
  const geometry = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    skins = new Set<T.Skeleton>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      geometry.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
    if (o instanceof T.SkinnedMesh) skins.add(o.skeleton);
  });
  geometry.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  skins.forEach((s) => s.dispose());
}

/** Owned prototypes. Each car receives independent geometry, bones and material;
 * unloading a prototype or changing one driver's pose cannot affect another. */
export class DriverAsset {
  private disposed = false;
  private constructor(
    private prototype: T.Group,
    readonly triangles: number,
  ) {}
  instantiate(fabric: T.MeshStandardMaterial) {
    if (this.disposed) throw new Error('Authored driver already disposed');
    const root = clone(this.prototype) as T.Group;
    const material = fabric.clone();
    // Material.copy() does not carry shader hooks: keep the team-kit recolour
    // (and any other chained edit) so the authored suit wears the team colours.
    material.onBeforeCompile = fabric.onBeforeCompile;
    material.customProgramCacheKey = fabric.customProgramCacheKey;
    material.name = 'Blender-authored woven suit panels';
    material.color.set(0xffffff);
    material.vertexColors = true;
    material.side = T.FrontSide;
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry = o.geometry.clone();
        o.material = material;
        o.castShadow = o.receiveShadow = true;
      }
    });
    return new DriverSkin(root);
  }
  diagnostics() {
    return {
      loaded: !this.disposed,
      revision: manifest.revision,
      sha256: manifest.sha256,
      skinnedSleeves: 2,
      joints: manifest.bones.length,
      triangles: this.triangles,
      compressedBytes: manifest.compressedBytes,
      finalArtApproved: false,
    };
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      release(this.prototype);
    }
  }
  static async decode(input: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
    if (signal?.aborted) throw abort();
    let bytes = input;
    if (
      bytes.length === manifest.compressedBytes &&
      (await digest(bytes)) === manifest.compressedSHA256
    )
      bytes = new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer(),
      );
    if (bytes.length !== manifest.bytes || (await digest(bytes)) !== manifest.sha256)
      throw new Error('Authored driver integrity check failed');
    if (signal?.aborted) throw abort();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      jsonLength = view.getUint32(12, true);
    if (
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length ||
      view.getUint32(16, true) !== 0x4e4f534a ||
      jsonLength > bytes.length - 28
    )
      throw new Error('Invalid authored driver header');
    validateDriverDocument(
      JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))),
    );
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    try {
      if (signal?.aborted) throw abort();
      let vertices = 0,
        triangles = 0,
        skins = 0;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const p = o.geometry.getAttribute('position'),
          normal = o.geometry.getAttribute('normal'),
          index = o.geometry.index;
        if (!p || !normal || !index || normal.count !== p.count)
          throw new Error('Invalid driver topology');
        for (let i = 0; i < p.count; i++) {
          if (
            !Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)) ||
            Math.abs(p.getX(i)) > 0.34 ||
            p.getY(i) < -0.4 ||
            p.getY(i) > 0.3 ||
            p.getZ(i) < -0.65 ||
            p.getZ(i) > 0.3 ||
            Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) > 0.001
          )
            throw new Error('Driver surface outside seated envelope');
        }
        for (let i = 0; i < index.count; i++)
          if (index.getX(i) < 0 || index.getX(i) >= p.count)
            throw new Error('Invalid driver index');
        vertices += p.count;
        triangles += index.count / 3;
        if (o instanceof T.SkinnedMesh) {
          skins++;
          const joints = o.geometry.getAttribute('skinIndex'),
            weights = o.geometry.getAttribute('skinWeight');
          if (
            !joints ||
            !weights ||
            joints.count !== p.count ||
            weights.count !== p.count ||
            o.skeleton.bones.length !== 9
          )
            throw new Error('Invalid driver weights');
          for (let i = 0; i < p.count; i++) {
            let sum = 0;
            for (let j = 0; j < 4; j++) {
              const joint = joints.getComponent(i, j),
                weight = weights.getComponent(i, j);
              if (
                !Number.isInteger(joint) ||
                joint < 0 ||
                joint >= 9 ||
                !Number.isFinite(weight) ||
                weight < 0 ||
                weight > 1
              )
                throw new Error('Invalid driver weights');
              sum += weight;
            }
            if (Math.abs(sum - 1) > 0.0001) throw new Error('Unnormalized driver weights');
          }
        }
      });
      if (vertices > manifest.maxVertices || triangles > manifest.maxTriangles || skins !== 2)
        throw new Error('Driver budget exceeded');
      return new DriverAsset(gltf.scene, triangles);
    } catch (error) {
      release(gltf.scene);
      throw error;
    }
  }
}

interface Binding {
  bone: T.Bone;
  rest: T.Matrix4;
  parentInverse: T.Matrix4;
}
/** Joint matrices are absolute functions of the current IK/steering pose. There
 * is no AnimationMixer clock, spring history or accumulated quaternion drift. */
export class DriverSkin {
  readonly torso: T.Mesh;
  readonly sleeves: T.SkinnedMesh[] = [];
  private readonly bindings = new Map<string, Binding>();
  private readonly rest = Object.fromEntries(
    Object.entries(manifest.rest).map(([side, p]) => [
      side,
      {
        shoulder: new T.Vector3(...(p.shoulder as [number, number, number])),
        elbow: new T.Vector3(...(p.elbow as [number, number, number])),
        wrist: new T.Vector3(...(p.wrist as [number, number, number])),
      },
    ]),
  );
  private a = new T.Vector3();
  private b = new T.Vector3();
  private c = new T.Vector3();
  private q = new T.Quaternion();
  private m = new T.Matrix4();
  private offset = new T.Matrix4();
  private readonly restWheelInverse = new T.Quaternion()
    .setFromAxisAngle(new T.Vector3(1, 0, 0), 0.12)
    .invert();
  constructor(readonly root: T.Group) {
    root.updateMatrixWorld(true);
    this.torso = root.getObjectByName('suit_torso') as T.Mesh;
    if (!(this.torso instanceof T.Mesh)) throw new Error('Missing driver torso');
    root.traverse((o) => {
      if (o instanceof T.Bone) {
        this.bindings.set(o.name, {
          bone: o,
          rest: o.matrixWorld.clone(),
          parentInverse: o.parent!.matrixWorld.clone().invert(),
        });
        o.matrixAutoUpdate = false;
      }
      if (o instanceof T.SkinnedMesh) {
        // Known full-lock envelope, not bind-pose bounds. This also covers all
        // shadow/mirror views without per-frame CPU skinning of the whole mesh.
        o.boundingBox = new T.Box3(
          new T.Vector3(-0.36, -0.35, -0.61),
          new T.Vector3(0.36, 0.36, 0.3),
        );
        o.boundingSphere = o.boundingBox.getBoundingSphere(new T.Sphere());
        this.sleeves.push(o);
      }
    });
    root.name = 'Blender-authored articulated suit';
  }
  private put(name: string, restStart: T.Vector3, start: T.Vector3, rotation: T.Quaternion) {
    const b = this.bindings.get(name)!;
    this.m.makeRotationFromQuaternion(rotation).setPosition(start);
    this.offset.makeTranslation(-restStart.x, -restStart.y, -restStart.z);
    b.bone.matrix.copy(b.parentInverse).multiply(this.m).multiply(this.offset).multiply(b.rest);
    b.bone.matrixWorldNeedsUpdate = true;
  }
  pose(side: number, shoulder: T.Vector3, elbow: T.Vector3, wrist: T.Vector3, wheel: T.Quaternion) {
    const label = side < 0 ? 'R' : 'L',
      r = this.rest[label];
    this.q.setFromUnitVectors(
      this.a.subVectors(r.elbow, r.shoulder).normalize(),
      this.b.subVectors(elbow, shoulder).normalize(),
    );
    this.put(`Upper_${label}`, r.shoulder, shoulder, this.q);
    this.q.setFromUnitVectors(
      this.a.subVectors(r.wrist, r.elbow).normalize(),
      this.b.subVectors(wrist, elbow).normalize(),
    );
    this.put(`Forearm_${label}`, r.elbow, elbow, this.q);
    this.a
      .subVectors(r.elbow, r.shoulder)
      .normalize()
      .add(this.c.subVectors(r.wrist, r.elbow).normalize())
      .normalize();
    this.b
      .subVectors(elbow, shoulder)
      .normalize()
      .add(this.c.subVectors(wrist, elbow).normalize())
      .normalize();
    this.q.setFromUnitVectors(this.a, this.b);
    this.put(`Elbow_${label}`, r.elbow, elbow, this.q);
    this.q.copy(wheel).multiply(this.restWheelInverse);
    this.put(`Cuff_${label}`, r.wrist, wrist, this.q);
  }
}

export async function loadDriverAsset(
  cancelled: () => boolean = () => false,
  fetcher: typeof fetch = fetch,
  url?: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000),
    polling = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: DriverAsset | undefined;
  try {
    if (cancelled()) throw abort();
    const response = await fetcher(url ?? new URL('./apx01-driver.glb.gz', import.meta.url).href, {
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok || !response.body) throw new Error(`Driver HTTP ${response.status}`);
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted || cancelled()) throw abort();
        if (done) break;
        size += value.length;
        if (size > manifest.bytes) throw new Error('Driver response exceeds budget');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const input = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    asset = await DriverAsset.decode(input, controller.signal);
    if (controller.signal.aborted || cancelled()) throw abort();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(polling);
  }
}
