import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  parseSolvaneKit,
  SolvaneDetails,
  SOLVANE_DETAILS,
} from '../src/rendering/open-world/solvane-details.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';
import { HorizonGuidance } from '../src/rendering/open-world/horizon-guidance.ts';
import { HorizonDressing } from '../src/rendering/open-world/horizon-dressing.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { EVENT_COLOURS } from '../src/rendering/open-world/markers.ts';
import { F, carBase } from '../src/simulation/protocol.ts';

const bytes = async () => new Uint8Array(await readFile('public/models/solvane/detail-kit.glb'));
const world = openWorld();
const structures = regionStructures(world);

describe('Blender source to Festival runtime contract', () => {
  it('ships all 12 immutable templates inside a verified, texture-free 2 MB budget', async () => {
    const data = await bytes();
    const source = await parseSolvaneKit(data);
    expect(Object.keys(SOLVANE_DETAILS.templates)).toHaveLength(12);
    for (const [name, stats] of Object.entries(SOLVANE_DETAILS.templates)) {
      const object = source.getObjectByName(name)!;
      expect(object, name).toBeDefined();
      let triangles = 0;
      object.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
        const normals = node.geometry.attributes.normal;
        for (let i = 0; i < normals.count; i++)
          expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 2);
      });
      expect(triangles, name).toBe(stats.triangles);
      const box = new T.Box3().setFromObject(object);
      for (let axis = 0; axis < 3; axis++) {
        expect(box.min.getComponent(axis)).toBeCloseTo(stats.bounds[0][axis], 4);
        expect(box.max.getComponent(axis)).toBeCloseTo(stats.bounds[1][axis], 4);
      }
    }
    expect(SOLVANE_DETAILS.templates.aero_flap_far.triangles).toBeLessThan(
      SOLVANE_DETAILS.templates.aero_main.triangles / 6,
    );
    expect(SOLVANE_DETAILS.templates.launch_far.triangles).toBeLessThan(
      SOLVANE_DETAILS.templates.launch_near.triangles / 6,
    );
    new SolvaneDetails(source, world, structures).dispose();
  });
  it('decodes a validated byte view without reading unrelated backing-buffer bytes', async () => {
    const data = await bytes();
    const padded = new Uint8Array(data.length + 48);
    padded.fill(0x7f);
    padded.set(data, 17);
    const source = await parseSolvaneKit(padded.subarray(17, 17 + data.length));
    expect(source.getObjectByName('frontage_near')).toBeDefined();
    new SolvaneDetails(source, world, structures).dispose();
  });
  it('rejects truncated, oversized, HTML and modified payloads before attaching anything', async () => {
    const data = await bytes();
    await expect(parseSolvaneKit(data.slice(0, 24))).rejects.toThrow();
    await expect(parseSolvaneKit(new Uint8Array(data.length + 1))).rejects.toThrow();
    const html = new Uint8Array(data.length);
    html.set(new TextEncoder().encode('<!DOCTYPE html>'));
    await expect(parseSolvaneKit(html)).rejects.toThrow();
    data[data.length - 12] ^= 1;
    await expect(parseSolvaneKit(data)).rejects.toThrow(/integrity/);
  });
  it('places real 3D details, uses only far instances on LOW, and bounds submitted matrices', async () => {
    const kit = new SolvaneDetails(await parseSolvaneKit(await bytes()), world, structures);
    // Every shop and block reads as a Japanese building with its own ground
    // floor (aluminium sashes, shutters, lattice): the kit's European timber
    // shopfronts are withdrawn there and only legacy styles may carry them.
    expect(kit.stats.frontage).toBe(0);
    // The festival reads the region as Japanese: city blocks carry their own
    // slab-and-parapet balconies in the merged building mesh, so the
    // European wrought-iron kit balconies are no longer planned there.
    expect(kit.stats.balconies).toBe(0);
    expect(kit.stats.boats).toBe(3);
    const camera = new T.PerspectiveCamera(60, 16 / 9, 0.3, 26000);
    camera.position.set(560, 7.5, -2608);
    camera.lookAt(560, 6, -2540);
    camera.updateMatrixWorld();
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      kit.update(1, 0, camera, quality);
      expect(kit.stats.farInstances).toBeLessThanOrEqual(320);
      expect(kit.stats.nearInstances).toBeLessThanOrEqual(
        quality === 'low' ? 0 : quality === 'medium' ? 32 : quality === 'high' ? 56 : 80,
      );
      kit.root.traverse((node) => {
        if (!(node instanceof T.InstancedMesh)) return;
        expect(node.count).toBeLessThanOrEqual(node.instanceMatrix.count);
        for (let i = 0; i < node.count * 16; i++)
          expect(Number.isFinite(node.instanceMatrix.array[i])).toBe(true);
      });
    }
    kit.dispose();
  });
  it('releases each shared GPU resource once, including instance matrices, even on repeated disposal', async () => {
    const source = await parseSolvaneKit(await bytes());
    const kit = new SolvaneDetails(source, world, structures);
    const resources = new Set<T.BufferGeometry | T.Material | T.InstancedMesh>();
    kit.root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      resources.add(node.geometry);
      if (node instanceof T.InstancedMesh) resources.add(node);
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        resources.add(material);
    });
    const spies = Array.from(resources, (resource) => vi.spyOn(resource, 'dispose'));
    kit.dispose();
    kit.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(kit.root.children).toHaveLength(0);
  });
  it('checkpoint flag copies survive library disposal and are released by guidance', async () => {
    const kit = new SolvaneDetails(await parseSolvaneKit(await bytes()), world, structures);
    const guidance = new HorizonGuidance();
    guidance.useFlagTemplate(kit.flagTemplate());
    const owned = new Set<T.BufferGeometry>();
    guidance.root.traverse((node) => {
      if (node instanceof T.Mesh) owned.add(node.geometry);
    });
    const spies = Array.from(owned, (g) => vi.spyOn(g, 'dispose'));
    kit.dispose();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    guidance.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
  it('recolours same-checkpoint LOD replacements and disposes the retired private meshes', async () => {
    const kit = new SolvaneDetails(await parseSolvaneKit(await bytes()), world, structures);
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
    const event = sim.events.find((value) => value.spec.id === 'harbour-welcome')!;
    const guidance = new HorizonGuidance();
    const subject = new T.Vector3(event.marker.x, 0, event.marker.z);
    const update = () => guidance.update(event, event.marker, subject, 20, () => 0);
    guidance.useFlagTemplate(kit.flagTemplate());
    update();
    const retired = new Set<T.BufferGeometry | T.Material>();
    const pole = guidance.root.getObjectByName('Right checkpoint flag')!;
    pole.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      retired.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        retired.add(material);
    });
    const spies = Array.from(retired, (value) => vi.spyOn(value, 'dispose'));
    guidance.useFlagTemplate(kit.flagTemplate(true));
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    update();
    let fabricCount = 0;
    pole.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (material instanceof T.MeshStandardMaterial && material.name === 'fabric') {
          fabricCount++;
          expect(material.color.getHex()).toBe(EVENT_COLOURS[event.spec.kind]);
        }
    });
    expect(fabricCount).toBeGreaterThan(0);
    guidance.dispose();
    kit.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
  it('does not erase the old coast if the authored asset is unavailable', () => {
    const dressing = new HorizonDressing(world, structures);
    const camera = new T.PerspectiveCamera();
    camera.position.set(740, 10, -2900);
    dressing.update(0, 0, camera, 'high');
    const boats = dressing.root.children.filter((node) => node.userData.legacyBoat);
    expect(boats.length).toBeGreaterThan(0);
    expect(boats.some((node) => node.visible)).toBe(true);
    dressing.useAuthoredBoats();
    dressing.update(0, 0, camera, 'high');
    expect(boats.every((node) => !node.visible)).toBe(true);
    dressing.dispose();
  });
  it('responds to recorded wetness without accumulating darkening and restores dry materials', async () => {
    const source = await parseSolvaneKit(await bytes());
    const kit = new SolvaneDetails(source, world, structures);
    const finishes = new Map<T.MeshStandardMaterial, { color: T.Color; roughness: number }>();
    source.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (
          material instanceof T.MeshStandardMaterial &&
          ['stone', 'timber', 'cream', 'carbon'].includes(material.name)
        )
          finishes.set(material, { color: material.color.clone(), roughness: material.roughness });
    });
    expect(finishes.size).toBeGreaterThan(2);
    const camera = new T.PerspectiveCamera();
    camera.updateMatrixWorld();
    kit.update(1, 1, camera, 'medium', 1);
    const wet = Array.from(finishes.keys(), (m) => m.color.clone());
    for (let i = 0; i < 100; i++) kit.update(i, 1, camera, 'medium', 1);
    Array.from(finishes.keys()).forEach((m, i) => expect(m.color.equals(wet[i])).toBe(true));
    kit.update(101, 0, camera, 'medium', 0);
    for (const [m, dry] of finishes) {
      expect(m.color.equals(dry.color)).toBe(true);
      expect(m.roughness).toBe(dry.roughness);
    }
    kit.dispose();
  });
  it('poses only the EH-3, respects damage, and articulates smoothly without altering physics', async () => {
    const sim = new OpenWorldSimulation({ vehicle: 'eh3', tileBudget: 12 });
    const kit = new SolvaneDetails(await parseSolvaneKit(await bytes()), world, structures);
    const frame = sim.makeFrame();
    const subject = new T.Object3D(),
      camera = new T.PerspectiveCamera();
    subject.position.set(frame[carBase(0) + F.X], frame[carBase(0) + F.Y], frame[carBase(0) + F.Z]);
    camera.position.copy(subject.position).add(new T.Vector3(0, 2, -6));
    frame[carBase(0) + F.SPEED] = 25;
    frame[carBase(0) + F.BRAKE] = 1;
    const before = frame.slice();
    expect(kit.poseAero(frame, subject, 1 / 60, camera)).toBe(true);
    const flap = kit.aero.getObjectByName('aero_flap')!;
    expect(flap.rotation.x).toBeLessThan(0);
    expect(flap.rotation.x).toBeGreaterThan(-0.1);
    expect(frame).toEqual(before);
    frame[carBase(0) + F.REAR_HEALTH] = 0;
    kit.poseAero(frame, subject, 1 / 60, camera);
    expect(kit.aero.visible).toBe(false);
    expect(kit.poseAero(frame, null, 1 / 60, camera)).toBe(false);
    kit.dispose();
  });
});
