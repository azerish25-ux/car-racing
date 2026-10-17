import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { BikeMaterials, BikeModel, staticSag } from '../../../src/rendering/bike.ts';
import { VEHICLES } from '../../../src/simulation/vehicles.ts';

/** Colour-visible production geometry in a held riding pose for native editing.
 * This is an exchange/inspection asset, not a replacement for the game's IK,
 * tyre/weather shaders, wheel animation or per-entrant material installation.
 * Invisible shadow-only duplicates are not exported as opaque extra helmets.
 */
export async function exportRuntimeGP(id: 'gpr1' | 'gpr2') {
  const definition = VEHICLES[id], materials = new BikeMaterials(0);
  const model = new BikeModel(definition, 0, 'high', materials, true);
  const sag = staticSag(definition);
  model.pose({
    fork: sag.fork, shock: sag.shock, steer: 0, frontRotation: 0,
    rearRotation: 0, chassisLean: 0, riderOffset: 0, tuck: .75,
    brake: .05, rearBrake: 0, discTemp: 280, compoundColour: 0xffffff,
    riding: true, speed: 42, gear: 4, rpm: 12200,
  });
  model.root.position.y = definition.bike!.cgHeight;
  const hidden: T.Object3D[] = [], instances: T.InstancedMesh[] = [];
  model.root.traverse((object) => {
    if (object instanceof T.Mesh) {
      const ms = Array.isArray(object.material) ? object.material : [object.material];
      if (ms.every((m) => !m.colorWrite)) hidden.push(object);
    }
    if (object instanceof T.InstancedMesh) instances.push(object);
  });
  const excludedShadowCopies = hidden.map((o) => o.name || o.type);
  hidden.forEach((o) => { o.visible = false; });
  // Explicit nodes make the linked repeated chain geometry inspectable in
  // importers without requiring EXT_mesh_gpu_instancing support.
  const expanded: { source: T.InstancedMesh; parent: T.Object3D; group: T.Group }[] = [];
  for (const object of instances) {
    const parent = object.parent!;
    const group = new T.Group();
    group.name = object.name;
    group.position.copy(object.position); group.quaternion.copy(object.quaternion);
    group.scale.copy(object.scale);
    const matrix = new T.Matrix4();
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      const mesh = new T.Mesh(object.geometry, object.material);
      mesh.name = `${object.name || 'Repeated component'} ${String(i + 1).padStart(3, '0')}`;
      mesh.applyMatrix4(matrix);
      group.add(mesh);
    }
    parent.remove(object); parent.add(group); expanded.push({ source: object, parent, group });
  }
  // The glTF exporter packs metal/roughness through drawImage, which cannot
  // consume a DataTexture image object. Transfer original RGBA8 pixels into
  // export-owned canvases; do not change the runtime textures or their colour space.
  const converted = new Map<T.DataTexture, T.CanvasTexture>();
  const materialCopies = new Map<T.Material, T.Material>();
  function exchangeMaterial(original: T.Material) {
    const cached = materialCopies.get(original);
    if (cached) return cached;
    const copy = original.clone();
    for (const [key, value] of Object.entries(copy)) {
      if (!(value instanceof T.DataTexture)) continue;
      let target = converted.get(value);
      if (!target) {
        if (value.type !== T.UnsignedByteType || value.format !== T.RGBAFormat)
          throw new Error(`Unsupported data texture exchange: ${key}`);
        const { width, height, data } = value.image;
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Missing exchange canvas');
        const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
        target = new T.CanvasTexture(canvas);
        target.wrapS = value.wrapS; target.wrapT = value.wrapT;
        target.repeat.copy(value.repeat); target.offset.copy(value.offset);
        target.center.copy(value.center); target.rotation = value.rotation;
        target.magFilter = value.magFilter; target.minFilter = value.minFilter;
        target.flipY = value.flipY; target.channel = value.channel;
        target.anisotropy = value.anisotropy; target.colorSpace = value.colorSpace;
        target.generateMipmaps = value.generateMipmaps;
        target.name = `${value.name || key} RGBA8 exchange`;
        converted.set(value, target);
      }
      (copy as unknown as Record<string, unknown>)[key] = target;
    }
    materialCopies.set(original, copy);
    return copy;
  }
  const originalMaterials = new Map<T.Mesh, T.Material | T.Material[]>();
  model.root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    originalMaterials.set(object, object.material);
    object.material = Array.isArray(object.material)
      ? object.material.map(exchangeMaterial) : exchangeMaterial(object.material);
  });
  // glTF has no polygon-offset state. An export-owned 0.35 mm normal offset
  // replaces the game's depth bias for conforming decals in native inspectors.
  // Counts/topology/UVs are preserved and all runtime buffers are restored.
  const originalGeometry = new Map<T.Mesh, T.BufferGeometry>();
  model.root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const ms = Array.isArray(object.material) ? object.material : [object.material];
    if (!ms.every((material) => material.polygonOffset && material.polygonOffsetFactor < 0)) return;
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    if (!normals || normals.count !== positions.count) {
      geometry.dispose();
      throw new Error('Native decal offset requires matched normals');
    }
    const normal = new T.Vector3();
    for (let i = 0; i < positions.count; i++) {
      normal.fromBufferAttribute(normals, i).normalize().multiplyScalar(0.00035);
      positions.setXYZ(i, positions.getX(i) + normal.x, positions.getY(i) + normal.y, positions.getZ(i) + normal.z);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    originalGeometry.set(object, object.geometry);
    object.geometry = geometry;
  });
  model.root.updateMatrixWorld(true);
  let visibleTriangles = 0, visibleMeshes = 0;
  model.root.traverseVisible((object) => {
    if (object instanceof T.Mesh) {
      visibleMeshes++;
      visibleTriangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
    }
  });
  model.root.userData.nativeInspection = {
    source: 'MOTOBOUND production BikeModel', vehicle: id, detail: 'high', units: 'metres',
    pose: 'Held road-riding pose, 42 m/s, tuck .75, no lean',
    shaderBoundary: 'Standard glTF PBR exchange; custom runtime GLSL and IK remain in source.',
    excludedShadowCopies,
    nativeDecalOffsets: originalGeometry.size,
    nativeDecalOffsetMetres: 0.00035,
  };
  try {
    const data = await new GLTFExporter().parseAsync(model.root, {
      binary: true, onlyVisible: true, maxTextureSize: 2048,
    }) as ArrayBuffer;
    const bytes = new Uint8Array(data), chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 32768)
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return { id, binary: btoa(chunks.join('')), bytes: bytes.length,
      visibleTriangles, visibleMeshes, expandedInstancedGroups: expanded.length,
      excludedShadowCopies, nativeDecalOffsets: originalGeometry.size, nativeDecalOffsetMetres: 0.00035,
      boundary: 'Complete colour-visible production model; static native exchange, not a new game rig or shader-equivalent export.' };
  } finally {
    for (const [mesh, geometry] of originalGeometry) {
      mesh.geometry.dispose(); mesh.geometry = geometry;
    }
    for (const [mesh, material] of originalMaterials) mesh.material = material;
    materialCopies.forEach((material) => material.dispose());
    converted.forEach((texture) => texture.dispose());
    for (const entry of expanded) {
      entry.parent.remove(entry.group); entry.parent.add(entry.source);
    }
    model.dispose(); materials.dispose();
  }
}
