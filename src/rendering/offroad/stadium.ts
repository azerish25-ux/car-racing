import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { materials } from '../materials/index.ts';
import { mxAtlasRow, mxEventAtlas } from './mx-course-dressing.ts';
import { STADIUM } from './stadium-dimensions.ts';
export { STADIUM } from './stadium-dimensions.ts';

function member(a: T.Vector3, b: T.Vector3, radius: number) {
  const direction = b.clone().sub(a);
  const g = new T.CylinderGeometry(radius, radius, direction.length(), 6);
  g.applyQuaternion(
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Stepped arena with open-web roof trusses, housed round floodlights,
 * original event ribbons and separate instanced clothing/skin. All static
 * structure is merged by material; crowd occupancy never adds draw calls. */
export class Stadium {
  readonly root = new T.Group();
  readonly crowd: T.InstancedMesh;
  private readonly textures = new Set<T.Texture>();
  constructor(track: Track) {
    this.root.name = 'Supercross stadium';
    const p = trackPoint(),
      box = new T.Box3();
    let floor = Infinity;
    for (let s = 0; s < track.length; s += 4) {
      track.at(s, p);
      box.expandByPoint(new T.Vector3(p.x + p.nx * p.width, p.y, p.z + p.nz * p.width));
      box.expandByPoint(new T.Vector3(p.x - p.nx * p.width, p.y, p.z - p.nz * p.width));
      floor = Math.min(floor, p.y);
    }
    box.expandByVector(new T.Vector3(STADIUM.margin, 0, STADIUM.margin));
    const concrete = materials.concrete({ variant: 'rough', horizontal: 1, color: 0x827f79 });
    installScannedMaps(concrete, 'concrete', libraryAlbedo(concrete));
    const steel = materials.metal({
      kind: 'cast',
      metal: 'steel',
      color: 0x536063,
      roughness: 0.56,
    });
    const deck = new T.MeshStandardMaterial({
      color: 0x626e73,
      roughness: 0.9,
      name: 'Stadium roof deck',
    });
    const housing = new T.MeshStandardMaterial({
      color: 0x151d20,
      roughness: 0.62,
      metalness: 0.42,
      name: 'Arena floodlight housings',
    });
    const lamp = new T.MeshStandardMaterial({
      color: 0xadc8df,
      emissive: 0xeaf4ff,
      emissiveIntensity: 18,
      name: 'Arena round floodlight lenses',
    });
    const atlas = mxEventAtlas(true);
    this.textures.add(atlas);
    const ribbon = new T.MeshStandardMaterial({
      map: atlas,
      emissiveMap: atlas,
      emissive: 0xffffff,
      emissiveIntensity: 0.48,
      roughness: 0.62,
      name: 'MOTOBOUND arena ribbon boards',
    });
    const event = new T.MeshStandardMaterial({
      map: atlas,
      emissiveMap: atlas,
      emissive: 0xffffff,
      emissiveIntensity: 0.85,
      roughness: 0.7,
      side: T.DoubleSide,
      name: 'MOTOBOUND main event board',
    });
    const accent = new T.MeshStandardMaterial({
      color: 0xe3a268,
      emissive: 0xef8d3d,
      emissiveIntensity: 3.5,
      name: 'Warm event board accents',
    });
    const r = new Random(7151);
    const tiers: T.BufferGeometry[] = [],
      rigging: T.BufferGeometry[] = [],
      ribbons: T.BufferGeometry[] = [],
      cases: T.BufferGeometry[] = [],
      lights: T.BufferGeometry[] = [],
      soffits: T.BufferGeometry[] = [];
    let portals = 0;
    const seats: T.Matrix4[] = [],
      clothes: T.Color[] = [],
      skins: T.Color[] = [];
    const sides = [
      { axis: 'x', sign: -1 },
      { axis: 'x', sign: 1 },
      { axis: 'z', sign: -1 },
      { axis: 'z', sign: 1 },
    ] as const;
    const { min, max } = box;
    for (const side of sides) {
      const along = side.axis === 'x' ? max.z - min.z : max.x - min.x;
      const yaw =
        side.axis === 'x'
          ? side.sign < 0
            ? Math.PI / 2
            : -Math.PI / 2
          : side.sign < 0
            ? 0
            : Math.PI;
      for (let k = 0; k < STADIUM.tiers; k++) {
        const concourse = k >= 10 ? STADIUM.concourse : 0;
        const out = k * STADIUM.depth + STADIUM.depth / 2 + concourse;
        const top = floor + (k + 1) * STADIUM.rise + (k >= 10 ? 1.6 : 0);
        const extent = along + 2 * (k * STADIUM.depth + concourse);
        const cx =
          side.axis === 'x' ? (side.sign < 0 ? min.x - out : max.x + out) : (min.x + max.x) / 2;
        const cz =
          side.axis === 'z' ? (side.sign < 0 ? min.z - out : max.z + out) : (min.z + max.z) / 2;
        tiers.push(
          new T.BoxGeometry(
            side.axis === 'x' ? STADIUM.depth : extent,
            top - floor + 0.4,
            side.axis === 'x' ? extent : STADIUM.depth,
          ).translate(cx, (top + floor - 0.4) / 2, cz),
        );
        const n = Math.floor(extent / STADIUM.seat);
        for (let i = 0; i < n; i++) {
          // Paired gaps give the bowl visible access aisles instead of a
          // uniform carpet of figures that reads as a texture from the bike.
          if (i % 20 < 2 || r.next() > STADIUM.occupancy) continue;
          const t = (i + 0.5) / n - 0.5;
          const m = new T.Matrix4().makeRotationY(yaw);
          m.setPosition(
            side.axis === 'x' ? cx : cx + t * extent,
            top,
            side.axis === 'z' ? cz : cz + t * extent,
          );
          seats.push(m);
          clothes.push(
            new T.Color().setHSL(r.next(), 0.12 + 0.32 * r.next(), 0.11 + 0.27 * r.next()),
          );
          skins.push(
            new T.Color().setHSL(
              0.055 + 0.035 * r.next(),
              0.24 + 0.24 * r.next(),
              0.19 + 0.39 * r.next(),
            ),
          );
        }
        if (k === 9 || k === STADIUM.tiers - 1) {
          const x = cx - (side.axis === 'x' ? side.sign * 0.56 : 0),
            z = cz - (side.axis === 'z' ? side.sign * 0.56 : 0);
          const panel = mxAtlasRow(
            new T.PlaneGeometry(extent, 0.7).rotateY(yaw).translate(x, top + 0.32, z),
            k === 9 ? 0 : 1,
          );
          // Repeat readable event panels at a physical width instead of
          // stretching one wordmark around an entire grandstand.
          const uv = panel.getAttribute('uv');
          for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * extent) / 18);
          ribbons.push(panel);
          rigging.push(
            member(
              new T.Vector3(
                side.axis === 'x' ? x : x - extent / 2,
                top + 1.03,
                side.axis === 'z' ? z : z - extent / 2,
              ),
              new T.Vector3(
                side.axis === 'x' ? x : x + extent / 2,
                top + 1.03,
                side.axis === 'z' ? z : z + extent / 2,
              ),
              0.034,
            ),
          );
        }
      }
    }
    // An occupied building, rather than disconnected seating and a black lid:
    // upper service galleries, recessed concourse portals, rail posts and a
    // structural roof grid. Keep every new part behind the racing envelope.
    const outerWall = STADIUM.tiers * STADIUM.depth + STADIUM.concourse;
    for (const side of sides) {
      const along = side.axis === 'x' ? max.z - min.z : max.x - min.x;
      const yaw =
        side.axis === 'x'
          ? side.sign < 0
            ? Math.PI / 2
            : -Math.PI / 2
          : side.sign < 0
            ? 0
            : Math.PI;
      const transform = (geometry: T.BufferGeometry, t: number, out: number, y: number) => {
        const x =
          side.axis === 'x' ? (side.sign < 0 ? min.x - out : max.x + out) : (min.x + max.x) / 2 + t;
        const z =
          side.axis === 'z' ? (side.sign < 0 ? min.z - out : max.z + out) : (min.z + max.z) / 2 + t;
        return geometry.rotateY(yaw).translate(x, floor + y, z);
      };
      const length = along + 2 * outerWall;
      soffits.push(transform(new T.BoxGeometry(length, 14, 0.24), 0, outerWall + 0.7, 26.5));
      // Mullioned, shadowed hospitality/service bays above the last row.
      const bays = Math.max(4, Math.floor(length / 7));
      for (let bay = 0; bay < bays; bay++) {
        const t = ((bay + 0.5) / bays - 0.5) * length;
        cases.push(
          transform(new T.BoxGeometry(length / bays - 0.32, 2.3, 0.2), t, outerWall + 0.47, 20.4),
        );
        rigging.push(transform(new T.BoxGeometry(0.11, 2.4, 0.28), t, outerWall + 0.27, 20.4));
        if (bay % 2 === 0)
          lights.push(transform(new T.BoxGeometry(0.48, 0.1, 0.05), t, outerWall + 0.32, 21.9));
      }
      for (const y of [18.65, 22.05])
        tiers.push(transform(new T.BoxGeometry(length, 0.24, 0.8), 0, outerWall + 0.2, y));
      const portalCount = Math.max(2, Math.floor(along / 17));
      for (let i = 0; i < portalCount; i++) {
        const t = ((i + 0.5) / portalCount - 0.5) * along;
        // Back wall and lintel form a recess; no added collision or player wall.
        cases.push(transform(new T.BoxGeometry(1.5, 1.55, 0.15), t, 12.85, 8.6));
        tiers.push(transform(new T.BoxGeometry(1.85, 0.2, 1.15), t, 12.5, 9.46));
        for (const dx of [-0.83, 0.83])
          tiers.push(transform(new T.BoxGeometry(0.16, 1.65, 1.15), t + dx, 12.5, 8.57));
        lights.push(transform(new T.BoxGeometry(0.38, 0.08, 0.04), t, 12.0, 9.3));
        portals++;
      }
      // Short verticals make the long concourse rail read as a safety railing.
      for (const tier of [9, STADIUM.tiers - 1]) {
        const concourse = tier >= 10 ? STADIUM.concourse : 0;
        const out = tier * STADIUM.depth + STADIUM.depth / 2 + concourse - 0.56;
        const top = (tier + 1) * STADIUM.rise + (tier >= 10 ? 1.6 : 0);
        const railLength = along + 2 * (tier * STADIUM.depth + concourse);
        for (let t = -railLength / 2 + 1; t < railLength / 2; t += 2.4)
          rigging.push(
            transform(new T.CylinderGeometry(0.024, 0.024, 0.93, 5), t, out, top + 0.57),
          );
      }
    }
    this.root.userData.concoursePortals = portals;
    this.batch(tiers, concrete, 'Arena concrete seating decks');
    this.batch(soffits, deck, 'Arena service walls and acoustic cladding');
    const torso = new T.CylinderGeometry(0.16, 0.18, 0.43, 7)
      .scale(1.12, 1, 0.66)
      .rotateX(-0.08)
      .translate(0, 0.78, 0.035);
    const limbs: T.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      // Bent thighs/shins and resting elbows, not a standing torso stuck into a tier.
      limbs.push(
        member(
          new T.Vector3(side * 0.11, 0.54, 0.02),
          new T.Vector3(side * 0.13, 0.43, 0.32),
          0.081,
        ),
      );
      limbs.push(
        member(
          new T.Vector3(side * 0.13, 0.43, 0.32),
          new T.Vector3(side * 0.13, 0.13, 0.37),
          0.056,
        ),
      );
      limbs.push(
        member(
          new T.Vector3(side * 0.18, 0.91, 0.02),
          new T.Vector3(side * 0.24, 0.67, 0.2),
          0.048,
        ),
      );
      limbs.push(
        member(
          new T.Vector3(side * 0.24, 0.67, 0.2),
          new T.Vector3(side * 0.13, 0.54, 0.34),
          0.039,
        ),
      );
    }
    const person = mergeGeometries([torso, ...limbs], false)!;
    for (const g of [torso, ...limbs]) g.dispose();
    const clothing = new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      name: 'Instanced arena spectator clothing',
    });
    this.crowd = new T.InstancedMesh(person, clothing, seats.length);
    const head = new T.SphereGeometry(0.105, 7, 5).scale(0.91, 1.06, 1).translate(0, 1.105, 0.025);
    const faces = new T.InstancedMesh(
      head,
      new T.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.82,
        name: 'Instanced arena spectator faces',
      }),
      seats.length,
    );
    seats.forEach((m, i) => {
      this.crowd.setMatrixAt(i, m);
      this.crowd.setColorAt(i, clothes[i]);
      faces.setMatrixAt(i, m);
      faces.setColorAt(i, skins[i]);
    });
    this.crowd.name = 'Stadium crowd clothing (instanced)';
    faces.name = 'Stadium crowd faces (instanced)';
    this.crowd.receiveShadow = faces.receiveShadow = true;
    this.crowd.computeBoundingSphere();
    faces.computeBoundingSphere();
    this.root.add(this.crowd, faces);
    const seatParts = [
      new T.BoxGeometry(0.43, 0.07, 0.38).translate(0, 0.47, 0.015),
      new T.BoxGeometry(0.43, 0.37, 0.06).rotateX(-0.12).translate(0, 0.69, -0.2),
    ];
    const seatGeometry = mergeGeometries(seatParts, false)!;
    seatParts.forEach((g) => g.dispose());
    const chairs = new T.InstancedMesh(seatGeometry, housing, seats.length);
    chairs.name = 'Moulded stadium chairs (instanced)';
    seats.forEach((m, i) => chairs.setMatrixAt(i, m));
    chairs.receiveShadow = true;
    chairs.computeBoundingSphere();
    this.root.add(chairs);
    const span = box.getSize(new T.Vector3());
    const outer = STADIUM.tiers * STADIUM.depth + STADIUM.concourse;
    const roof = new T.Mesh(new T.BoxGeometry(span.x + 2 * outer, 0.45, span.z + 2 * outer), deck);
    roof.name = 'Arena roof deck';
    roof.position.set((min.x + max.x) / 2, floor + STADIUM.roof, (min.z + max.z) / 2);
    this.root.add(roof);
    // Secondary purlins and diagonal ties connect the five primary trusses.
    // They share the existing steel draw call, with no new shadow-casting light.
    for (let x = min.x - outer + 3; x < max.x + outer; x += 5.2) {
      rigging.push(
        new T.BoxGeometry(0.1, 0.24, span.z + 2 * outer).translate(
          x,
          floor + STADIUM.roof - 0.48,
          (min.z + max.z) / 2,
        ),
      );
    }
    for (let z = min.z - outer + 3; z < max.z + outer; z += 6.4) {
      rigging.push(
        new T.BoxGeometry(span.x + 2 * outer, 0.14, 0.08).translate(
          (min.x + max.x) / 2,
          floor + STADIUM.roof - 0.68,
          z,
        ),
      );
    }
    // Five real open-web trusses: two chords, alternately sloped diagonals,
    // and distinct dark housings/round emitting lenses underneath.
    for (let k = 0; k < 5; k++) {
      const z = min.z + ((k + 0.5) / 5) * span.z;
      const left = min.x - outer * 0.6,
        right = max.x + outer * 0.6,
        y = floor + STADIUM.roof - 2;
      for (const dy of [-0.8, 0.8])
        rigging.push(member(new T.Vector3(left, y + dy, z), new T.Vector3(right, y + dy, z), 0.07));
      const cells = Math.ceil((right - left) / 4.2);
      for (let i = 0; i < cells; i++) {
        rigging.push(
          member(
            new T.Vector3(left + (i / cells) * (right - left), y + (i % 2 ? 0.8 : -0.8), z),
            new T.Vector3(left + ((i + 1) / cells) * (right - left), y + (i % 2 ? -0.8 : 0.8), z),
            0.033,
          ),
        );
      }
      for (let i = 0; i < 8; i++) {
        const x = min.x + ((i + 0.5) / 8) * span.x;
        cases.push(new T.BoxGeometry(1.18, 0.3, 0.75).translate(x, y - 1.1, z));
        for (let lens = -1; lens <= 1; lens++)
          lights.push(
            new T.CylinderGeometry(0.13, 0.17, 0.07, 10).translate(x + lens * 0.34, y - 1.3, z),
          );
      }
    }
    for (const side of [-1, 1]) {
      const x = side < 0 ? min.x - outer + 1 : max.x + outer - 1;
      for (let i = 0; i < 7; i++) {
        const z = min.z + (i / 6) * span.z;
        rigging.push(
          member(new T.Vector3(x, floor, z), new T.Vector3(x, floor + STADIUM.roof - 0.3, z), 0.18),
        );
        rigging.push(
          member(
            new T.Vector3(x, floor + 25, z),
            new T.Vector3(x - side * 6, floor + STADIUM.roof - 0.7, z),
            0.095,
          ),
        );
      }
    }
    this.batch(rigging, steel, 'Merged open-web roof trusses and columns');
    this.batch(cases, housing, 'Merged arena lamp housings');
    this.batch(lights, lamp, 'Merged arena round floodlight lenses');
    this.batch(ribbons, ribbon, 'Arena concourse ribbon boards');
    const main = new T.Group();
    main.name = 'Suspended MOTOBOUND main event board';
    main.position.set((min.x + max.x) / 2, floor + 23, max.z + outer * 0.65);
    main.rotation.y = Math.PI;
    for (let row = 0; row < 2; row++)
      main.add(
        new T.Mesh(
          mxAtlasRow(new T.PlaneGeometry(20, 1.5).translate(0, row === 0 ? 0.8 : -0.8, 0), row),
          event,
        ),
      );
    main.add(new T.Mesh(new T.BoxGeometry(20.6, 3.6, 0.45).translate(0, 0, -0.26), housing));
    for (const side of [-1, 1])
      main.add(
        new T.Mesh(new T.BoxGeometry(0.16, 3.5, 0.09).translate(side * 10.2, 0, 0.05), accent),
      );
    this.root.add(main);
  }
  private batch(parts: T.BufferGeometry[], material: T.Material, name: string) {
    const geometry = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!geometry) throw new Error('Arena static batch contains incompatible geometry');
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.root.clear();
  }
}
