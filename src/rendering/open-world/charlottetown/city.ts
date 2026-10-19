import * as T from 'three';
import { trackPoint } from '../../../simulation/track.ts';
import type { OpenWorld } from '../../../simulation/open-world/world.ts';
import type { SurveyBuilding, SurveyPoint } from '../../../simulation/open-world/survey.ts';
import type { QualityPreset } from '../../options.ts';
import { CityBatches, type CityChunk } from './batch.ts';
import { CityMaterials, type CityMaterial } from './materials.ts';

type Point = readonly [number, number, number];
const BRICK = [0xa86754, 0x965646, 0xb57660, 0x8d4e41, 0xa37964];
const SIDING = [0xc6c8b9, 0xe1d7b8, 0xb7bfb8, 0x96aaa5, 0x8798a0, 0xc7b79c, 0xc0c5ca];
function seed(text: string) {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
function centre(p: readonly SurveyPoint[]): SurveyPoint {
  return [p.reduce((a, v) => a + v[0], 0) / p.length, p.reduce((a, v) => a + v[1], 0) / p.length];
}
function signedArea(p: readonly SurveyPoint[]) {
  return (
    p.reduce((a, v, i) => {
      const n = p[(i + 1) % p.length];
      return a + v[0] * n[1] - n[0] * v[1];
    }, 0) * 0.5
  );
}
function ring(p: readonly SurveyPoint[]) {
  const q = p.filter((v, i) => !i || Math.hypot(v[0] - p[i - 1][0], v[1] - p[i - 1][1]) > 0.03);
  if (q.length > 2 && Math.hypot(q[0][0] - q.at(-1)![0], q[0][1] - q.at(-1)![1]) < 0.03) q.pop();
  return q;
}
/** Clip a triangle against one side of the ridge; separate triangles keep
 * concave ground plans concave rather than creating a roof across courtyards. */
function clip(p: readonly SurveyPoint[], distance: (p: SurveyPoint) => number, side: number) {
  const out: SurveyPoint[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length],
      da = distance(a) * side,
      db = distance(b) * side;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
/** Baked, metre-scale architecture from actual OSM ground plans. All façade
 * styling, windows and roof pitches not in the source are authored estimates.
 * Geometry, texels and sign lettering are generated here; no image downloads. */
export class SurveyCity {
  readonly root = new T.Group();
  readonly palette = new CityMaterials();
  readonly chunks: CityChunk[];
  readonly stats = { buildings: 0, windows: 0, triangles: 0, visibleChunks: 0 };
  private readonly batches = new CityBatches();
  constructor(readonly world: OpenWorld) {
    this.root.name = 'Charlottetown · mapped footprints / estimated architecture';
    const survey = world.region.survey;
    if (!survey) throw new Error('SurveyCity requires geographic source geometry');
    for (const area of survey.greens) this.groundPolygon(area.points, 'grass', 0x607147, 0.014);
    for (const area of survey.parking) this.groundPolygon(area.points, 'asphalt', 0x777a76, 0.022);
    for (const path of survey.footways)
      this.path(path.points, path.width, path.kind === 'service' ? 'asphalt' : 'paving');
    for (const building of survey.buildings) this.building(building);
    this.streetFurniture();
    const built = this.batches.build(this.palette.materials);
    this.chunks = built.chunks;
    this.stats.triangles = built.triangles;
    this.root.add(...this.chunks.map((c) => c.root));
  }
  private height(x: number, z: number) {
    return this.world.field.height(x, z);
  }
  private groundPolygon(
    source: readonly SurveyPoint[],
    material: CityMaterial,
    tint: number,
    lift: number,
  ) {
    const points = ring(source);
    if (points.length < 3) return;
    const [x, z] = centre(points),
      batch = this.batches.get(x, z, material);
    const triangles = T.ShapeUtils.triangulateShape(
      points.map((p) => new T.Vector2(...p)),
      [],
    );
    for (const triangle of triangles) {
      const p = triangle.map(
        (i) => [points[i][0], this.height(...points[i]) + lift, points[i][1]] as Point,
      );
      batch.tri(p[0], p[1], p[2], [0, 1, 0], tint);
    }
  }
  private path(points: readonly SurveyPoint[], width: number, kind: CityMaterial) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const nx = (-dz / length) * width * 0.5,
        nz = (dx / length) * width * 0.5;
      const p = (q: SurveyPoint, s: number): Point => [
        q[0] + nx * s,
        this.height(...q) + 0.025,
        q[1] + nz * s,
      ];
      this.batches
        .get((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, kind)
        .quad(
          p(a, 1),
          p(b, 1),
          p(b, -1),
          p(a, -1),
          [0, 1, 0],
          kind === 'asphalt' ? 0x777b77 : 0xb0afa1,
          length / 2.4,
          width / 2.4,
        );
    }
  }
  private building(building: SurveyBuilding) {
    const p = ring(building.footprint);
    if (p.length < 3) return;
    const [x, z] = centre(p),
      h = seed(building.id),
      tags = building.tags,
      area = Math.abs(signedArea(p));
    const campus = /holland|charlottetown centre|wales/i.test(`${tags.name} ${tags.operator}`);
    const home =
      !campus &&
      area < 320 &&
      !/commercial|retail|industrial|church|school|college|apartments/.test(tags.building ?? '');
    const cladding = tags['building:material'] ?? tags.material ?? '';
    const type: CityMaterial =
      /brick/.test(cladding) || campus || !home
        ? 'brick'
        : /stone/.test(cladding)
          ? 'stone'
          : h % 5 === 0
            ? 'brick'
            : 'siding';
    const colours = type === 'brick' ? BRICK : SIDING,
      tint = colours[h % colours.length];
    const base = Math.min(...p.map((q) => this.height(...q))) - 0.12,
      eave = base + building.height;
    const floorCount = Math.min(6, Math.max(1, building.floors)),
      floorHeight = building.height / floorCount;
    const wall = this.batches.get(x, z, type),
      stone = this.batches.get(x, z, 'stone'),
      trim = this.batches.get(x, z, 'trim', 2);
    const glazing = this.batches.get(x, z, h % 3 === 0 ? 'litGlass' : 'glass', 1),
      roof = this.batches.get(x, z, 'roof');
    const orientation = signedArea(p) > 0 ? 1 : -1;
    let longest = 0,
      axisX = 1,
      axisZ = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length],
        l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > longest) {
        longest = l;
        axisX = (b[0] - a[0]) / l;
        axisZ = (b[1] - a[1]) / l;
      }
    }
    const distances = p.map((q) => (q[0] - x) * -axisZ + (q[1] - z) * axisX),
      min = Math.min(...distances),
      max = Math.max(...distances),
      middle = (min + max) / 2;
    const pitch = home && tags['roof:shape'] !== 'flat' ? Math.min(3.8, (max - min) * 0.33) : 0;
    const ridge = (q: SurveyPoint) => (q[0] - x) * -axisZ + (q[1] - z) * axisX - middle;
    const roofY = (q: SurveyPoint) =>
      eave + pitch * (1 - Math.min(1, Math.abs(ridge(q)) / Math.max(0.1, (max - min) / 2)));
    const triangles = T.ShapeUtils.triangulateShape(
      p.map((q) => new T.Vector2(...q)),
      [],
    );
    for (const t of triangles)
      for (const side of pitch ? [-1, 1] : [1]) {
        const part = pitch
          ? clip(
              t.map((i) => p[i]),
              ridge,
              side,
            )
          : t.map((i) => p[i]);
        for (let i = 1; i < part.length - 1; i++) {
          const a: Point = [part[0][0], roofY(part[0]), part[0][1]],
            b: Point = [part[i][0], roofY(part[i]), part[i][1]],
            c: Point = [part[i + 1][0], roofY(part[i + 1]), part[i + 1][1]];
          const n = new T.Vector3()
            .subVectors(new T.Vector3(...b), new T.Vector3(...a))
            .cross(new T.Vector3().subVectors(new T.Vector3(...c), new T.Vector3(...a)))
            .normalize();
          if (n.y < 0) n.negate();
          roof.tri(a, b, c, [n.x, n.y, n.z], h % 3 === 0 ? 0x65665f : 0x474e51);
        }
      }
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        l = Math.hypot(dx, dz);
      if (l < 0.15) continue;
      const nx = (orientation * dz) / l,
        nz = (-orientation * dx) / l,
        angle = Math.atan2(dz, dx),
        normal: Point = [nx, 0, nz];
      const at = (u: number, y: number, d = 0.01): Point => [
        a[0] + dx * u + nx * d,
        y,
        a[1] + dz * u + nz * d,
      ];
      wall.quad(
        at(0, base, 0),
        at(1, base, 0),
        at(1, eave, 0),
        at(0, eave, 0),
        normal,
        tint,
        l / 2.4,
        building.height / 2.4,
      );
      stone.quad(
        at(0, base, 0.012),
        at(1, base, 0.012),
        at(1, base + 0.45, 0.012),
        at(0, base + 0.45, 0.012),
        normal,
        0x99988b,
        l / 2.4,
        0.2,
      );
      if (pitch > 0) {
        const da = ridge(a),
          db = ridge(b),
          split = da * db < 0 ? da / (da - db) : -1;
        if (split > 0 && split < 1) {
          const top = at(split, eave + pitch, 0);
          wall.quad(
            at(0, eave, 0),
            at(split, eave, 0),
            top,
            at(0, roofY(a), 0),
            normal,
            tint,
            l / 2.4,
            pitch / 2.4,
          );
          wall.quad(
            at(split, eave, 0),
            at(1, eave, 0),
            at(1, roofY(b), 0),
            top,
            normal,
            tint,
            l / 2.4,
            pitch / 2.4,
          );
        } else
          wall.quad(
            at(0, eave, 0),
            at(1, eave, 0),
            at(1, roofY(b), 0),
            at(0, roofY(a), 0),
            normal,
            tint,
            l / 2.4,
            pitch / 2.4,
          );
      }
      const columns = Math.min(24, Math.floor((l - 0.9) / (campus ? 2.45 : 2.7)));
      for (let f = 0; f < floorCount; f++)
        for (let col = 0; col < columns; col++) {
          const u = (col + 0.5) / columns,
            y = base + f * floorHeight + Math.min(1.0, floorHeight * 0.26),
            wh = Math.min(campus ? 2.15 : 1.5, floorHeight * 0.57),
            ww = Math.min(campus ? 1.4 : 1.03, (l / columns) * 0.55);
          const rectangle = (
            batch: ReturnType<CityBatches['get']>,
            w: number,
            hh: number,
            yy: number,
            depth: number,
            color: number,
          ) =>
            batch.quad(
              at(u - w / l / 2, yy, depth),
              at(u + w / l / 2, yy, depth),
              at(u + w / l / 2, yy + hh, depth),
              at(u - w / l / 2, yy + hh, depth),
              normal,
              color,
            );
          // Slightly protruding outer frame, recessed glass and divided sash.
          rectangle(
            this.batches.get(x, z, 'trim', 1),
            ww + 0.18,
            wh + 0.17,
            y - 0.085,
            0.02,
            0xd5d1bd,
          );
          rectangle(glazing, ww, wh, y, 0.038, (h + col + f) % 4 === 0 ? 0x43545e : 0x2b3b46);
          rectangle(trim, 0.042, wh, y, 0.055, 0xdad8c8);
          rectangle(trim, ww, 0.05, y + wh * 0.52, 0.055, 0xdad8c8);
          const sill = at(u, y - 0.08, 0.07);
          trim.box(sill[0], sill[1], sill[2], ww + 0.3, 0.12, 0.16, angle, 0xe0d9c4);
          if (type === 'brick' && (f === 0 || campus)) {
            const lintel = at(u, y + wh + 0.09, 0.06);
            trim.box(lintel[0], lintel[1], lintel[2], ww + 0.26, 0.14, 0.14, angle, 0xc8c0a9);
          }
          this.stats.windows++;
        }
      const cornice = at(0.5, eave - 0.04, 0.045);
      trim.box(cornice[0], cornice[1], cornice[2], l, 0.18, 0.17, angle, 0xd8d2bc);
      if (i === h % p.length && l > 3) {
        const u = 0.5,
          w = Math.min(1.05, l * 0.25),
          y = base + 0.25;
        this.batches
          .get(x, z, 'wood', 1)
          .quad(
            at(u - w / l / 2, y, 0.02),
            at(u + w / l / 2, y, 0.02),
            at(u + w / l / 2, y + 2.05, 0.02),
            at(u - w / l / 2, y + 2.05, 0.02),
            normal,
            h % 2 ? 0x365a54 : 0x664632,
          );
      }
      if (campus && l > 18 && i % 3 === 0) {
        const u = 0.5,
          y = base + Math.min(4.4, building.height - 0.7),
          w = Math.min(8, l * 0.6);
        this.batches
          .get(x, z, 'sign', 1)
          .quad(
            at(u - w / l / 2, y, 0.1),
            at(u + w / l / 2, y, 0.1),
            at(u + w / l / 2, y + 1.1, 0.1),
            at(u - w / l / 2, y + 1.1, 0.1),
            normal,
            0xffffff,
            1,
            1,
            4,
          );
      }
    }
    if (home && area > 55) {
      const q = p[h % p.length],
        chimney: SurveyPoint = [(q[0] + x) / 2, (q[1] + z) / 2];
      this.batches
        .get(x, z, 'brick', 1)
        .box(
          chimney[0],
          roofY(chimney) + 0.3,
          chimney[1],
          0.65,
          1.4,
          0.65,
          Math.atan2(axisZ, axisX),
          0x9c5a47,
        );
    }
    this.stats.buildings++;
  }
  private streetFurniture() {
    const survey = this.world.region.survey!;
    // On-road geometry below is render-only paint, never fictitious obstacles.
    const crossingPositions: SurveyPoint[] = [];
    for (const node of survey.streetNodes) {
      if (!/crossing/.test(node.kind)) continue;
      if (crossingPositions.some((p) => Math.hypot(p[0] - node.x, p[1] - node.z) < 13)) continue;
      const pose = trackPoint();
      this.world.network.nearest(node.x, node.z, pose);
      if (this.world.network.lastDistance > 20) continue;
      crossingPositions.push([node.x, node.z]);
      const road = this.world.network.edgeAt(pose.s);
      const batch = this.batches.get(node.x, node.z, 'paint', 1);
      // Narrow white bars aligned to the road, across its running width.
      for (let n = -road.spec.halfWidth + 0.6; n < road.spec.halfWidth - 0.3; n += 1.1) {
        const x = pose.x + pose.nx * n,
          z = pose.z + pose.nz * n;
        batch.box(x, pose.y + 0.022, z, 0.48, 0.012, 2.7, Math.atan2(pose.tx, pose.tz), 0xd4d1bc);
      }
    }
    const indices = [1, 8, 39, 57];
    for (let i = 0; i < indices.length; i++) {
      const a = survey.route[indices[i]],
        b = survey.route[indices[i] + 1],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / length,
        tz = (b[1] - a[1]) / length,
        nx = tz,
        nz = -tx,
        x = a[0] + nx * 6.8,
        z = a[1] + nz * 6.8,
        y = this.height(x, z);
      this.batches.get(x, z, 'metal', 1).box(x, y + 1.7, z, 0.075, 3.4, 0.075, 0, 0x66706d);
      const width = 2.8,
        batch = this.batches.get(x, z, 'sign', 1);
      const left: Point = [x - (tx * width) / 2, y + 2.9, z - (tz * width) / 2],
        right: Point = [x + (tx * width) / 2, y + 2.9, z + (tz * width) / 2];
      batch.quad(
        left,
        right,
        [right[0], y + 3.4, right[2]],
        [left[0], y + 3.4, left[2]],
        [nx, 0, nz],
        0xffffff,
        1,
        1,
        i,
      );
      batch.quad(
        right,
        left,
        [left[0], y + 3.4, left[2]],
        [right[0], y + 3.4, right[2]],
        [-nx, 0, -nz],
        0xffffff,
        1,
        1,
        i,
      );
    }
  }
  update(camera: T.Camera, preset: QualityPreset, night: number, wet: number) {
    this.palette.update(night, wet);
    const detail =
      preset === 'ultra' ? 300 : preset === 'high' ? 210 : preset === 'medium' ? 145 : 90;
    let visible = 0;
    for (const chunk of this.chunks) {
      const distance = Math.max(
        0,
        Math.hypot(camera.position.x - chunk.x, camera.position.z - chunk.z) - chunk.radius,
      );
      chunk.root.visible = distance < 1200;
      chunk.levels[1].visible = distance < detail * 2;
      chunk.levels[2].visible = distance < detail;
      if (chunk.root.visible) visible++;
    }
    this.stats.visibleChunks = visible;
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.root.clear();
    this.palette.dispose();
  }
}
