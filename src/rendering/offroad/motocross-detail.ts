import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../geometry.ts';
import type { RiderColours, RiderDetail } from '../rider.ts';

/** Original race graphics authored for MOTObound. Reference photographs inform
 * the hierarchy and placement; no photographed manufacturer artwork is used. */
export function motocrossGraphics(
  colours: RiderColours,
  kind: 'shroud' | 'number' | 'jersey' | 'sleeve' | 'helmet',
  number = 2,
) {
  const width = kind === 'jersey' ? 1024 : 512;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const primary = hex(colours.primary),
    secondary = hex(colours.secondary),
    accent = hex(colours.accent);
  const texture = canvasTexture(width, 512, (c) => {
    c.fillStyle = kind === 'number' ? '#eeeae1' : primary;
    c.fillRect(0, 0, width, 512);
    const polygon = (points: number[][], colour: string) => {
      c.fillStyle = colour;
      c.beginPath();
      points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    if (kind === 'number') {
      polygon(
        [
          [0, 0],
          [512, 0],
          [512, 83],
          [0, 62],
        ],
        secondary,
      );
      polygon(
        [
          [0, 430],
          [512, 468],
          [512, 512],
          [0, 512],
        ],
        primary,
      );
      c.fillStyle = '#ffffff';
      c.font = '800 29px "Saira Variable", sans-serif';
      c.textAlign = 'center';
      c.fillText('MOTOBOUND', 256, 48, 380);
      c.fillStyle = '#171a1d';
      c.font = 'italic 950 334px "Saira Variable", sans-serif';
      c.textBaseline = 'middle';
      c.fillText(String(number), 247, 278, 416);
      c.fillStyle = '#ffffff';
      c.font = '700 21px "Saira Variable", sans-serif';
      c.fillText('FACTORY  /  MX', 256, 477, 300);
    } else if (kind === 'jersey') {
      for (const centre of [256, 768]) {
        polygon(
          [
            [centre - 198, 0],
            [centre - 156, 512],
            [centre + 174, 512],
            [centre + 196, 0],
          ],
          secondary,
        );
        polygon(
          [
            [centre - 204, 128],
            [centre - 156, 164],
            [centre - 130, 462],
            [centre - 151, 492],
          ],
          accent,
        );
        polygon(
          [
            [centre + 202, 123],
            [centre + 156, 163],
            [centre + 127, 462],
            [centre + 149, 492],
          ],
          accent,
        );
      }
      c.textAlign = 'center';
      // The loft wraps U clockwise, so each chest/back panel needs its text
      // mirrored around its own centre to read normally on the outside.
      const print = (text: string, x: number, y: number, width: number) => {
        c.save();
        c.translate(x, y);
        c.scale(-1, 1);
        c.fillText(text, 0, 0, width);
        c.restore();
      };
      c.fillStyle = '#f0ede6';
      c.font = '800 42px "Saira Variable", sans-serif';
      print('MOTOBOUND', 256, 206, 292);
      c.font = '700 23px "Saira Variable", sans-serif';
      print('OFFROAD RACING', 256, 244, 246);
      print('FACTORY RIDER', 768, 121, 272);
      c.font = 'italic 950 225px "Saira Variable", sans-serif';
      print(String(number), 758, 359, 274);
      c.font = '800 24px "Saira Variable", sans-serif';
      print('MOTOBOUND', 768, 405, 270);
      c.fillStyle = accent;
      c.fillRect(166, 273, 180, 6);
      c.fillRect(674, 425, 188, 6);
    } else {
      polygon(
        [
          [0, 42],
          [512, 252],
          [512, 512],
          [0, 315],
        ],
        secondary,
      );
      polygon(
        [
          [0, 58],
          [512, 268],
          [512, 303],
          [0, 92],
        ],
        accent,
      );
      polygon(
        [
          [0, 364],
          [512, 135],
          [512, 158],
          [0, 393],
        ],
        '#eeeae1',
      );
      if (kind === 'shroud') {
        c.save();
        c.translate(246, 269);
        c.rotate(-0.2);
        c.textAlign = 'center';
        c.fillStyle = '#f3f0e8';
        c.font = 'italic 900 61px "Saira Variable", sans-serif';
        c.fillText('MOTOBOUND', 0, 0, 422);
        c.font = '800 28px "Saira Variable", sans-serif';
        c.fillText('MX  /  FACTORY', 0, 43, 326);
        c.restore();
        c.fillStyle = '#eeeae1';
        c.fillRect(345, 420, 116, 30);
        c.fillStyle = '#22272a';
        c.font = '800 22px "Saira Variable", sans-serif';
        c.textAlign = 'center';
        c.fillText('RACING', 403, 443, 107);
      }
    }
  });
  texture.name = `Motocross original ${kind} graphics ${number}`;
  texture.anisotropy = 4;
  return texture;
}

/** Woven textile rather than glossy road-racing leather. Mipmapped linear
 * data maps remain stable under distant cameras and are owned by the rider. */
export function motocrossFabricMaps() {
  const size = 64,
    normal = new Uint8Array(size * size * 4),
    roughness = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : -1;
      normal.set([128 + weave * 15, 128 + (y % 4 < 2 ? 11 : -11), 254, 255], i);
      const grain = ((Math.imul(x + 11, 73) ^ Math.imul(y + 5, 151)) >>> 0) % 13;
      roughness.set([230 + grain, 230 + grain, 230 + grain, 255], i);
    }
  const texture = (data: Uint8Array, label: string) => {
    const t = new T.DataTexture(data, size, size, T.RGBAFormat);
    t.name = `Motocross woven fabric ${label}`;
    t.colorSpace = T.NoColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(14, 14);
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { normalMap: texture(normal, 'normal'), roughnessMap: texture(roughness, 'roughness') };
}

/** A closed, softly bevelled moulded panel in XY, with useful planar decal UVs. */
export function mouldedPanel(
  outline: readonly (readonly [number, number])[],
  depth = 0.008,
  bevel = 0.003,
) {
  const shape = new T.Shape(outline.map(([x, y]) => new T.Vector2(x, y)));
  const g = new T.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 2,
  });
  g.translate(0, 0, -depth / 2);
  g.computeBoundingBox();
  const box = g.boundingBox!,
    p = g.getAttribute('position'),
    uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++)
    uv.setXY(
      i,
      (p.getX(i) - box.min.x) / (box.max.x - box.min.x),
      (p.getY(i) - box.min.y) / (box.max.y - box.min.y),
    );
  return g;
}

/** Side panels use [rear/forward Z, height Y] coordinates. Each exposed face
 * keeps its number readable; normals are transformed with the moulding. */
export function motocrossSidePanel(
  outline: readonly (readonly [number, number])[],
  side: number,
  depth = 0.008,
) {
  const g = mouldedPanel(outline, depth, 0.003);
  if (side > 0) {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  }
  g.rotateY(-Math.PI / 2);
  return g;
}

/** True open wave rotor: the ground and spokes remain visible through the
 * cooling holes, unlike a solid disc painted with black dots. Axis is X. */
export function motocrossRotor(radius: number, detail: RiderDetail, sprocket = false) {
  const shape = new T.Shape(),
    count = detail === 'high' ? 120 : 64;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = radius * (sprocket ? 0.97 + 0.03 * Math.cos(a * 40) : 0.97 + 0.03 * Math.cos(a * 10));
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const centre = new T.Path();
  centre.absarc(0, 0, radius * 0.44, 0, Math.PI * 2, true);
  shape.holes.push(centre);
  const holes = detail === 'high' ? 12 : 8;
  for (let k = 0; k < holes; k++) {
    const a = (k / holes) * Math.PI * 2,
      hole = new T.Path();
    hole.absarc(
      Math.cos(a) * radius * 0.73,
      Math.sin(a) * radius * 0.73,
      radius * (sprocket ? 0.12 : 0.085),
      0,
      Math.PI * 2,
      true,
    );
    shape.holes.push(hole);
  }
  const g = new T.ExtrudeGeometry(shape, {
    depth: 0.004,
    steps: 1,
    bevelEnabled: false,
    curveSegments: detail === 'high' ? 3 : 2,
  });
  g.translate(0, 0, -0.002);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Staggered centre blocks and angled shoulder lugs. The outer tyre radius is
 * exact: wheel-ground contact does not change when the close detail appears. */
export function motocrossTread(radius: number, halfWidth: number, height: number, count: number) {
  const parts: T.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const rows = k % 2 === 0 ? [0, -0.9, 0.9] : [-0.43, 0.43, -0.94, 0.94];
    for (const row of rows) {
      const shoulder = Math.abs(row) > 0.8;
      const g = new T.BoxGeometry(shoulder ? halfWidth * 0.5 : halfWidth * 0.58, height, 0.026);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++)
        if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.79, p.getY(i), p.getZ(i) * 0.82);
      g.computeVertexNormals();
      g.rotateZ(shoulder ? -Math.sign(row) * 0.46 : row * 0.12);
      g.translate(
        row * halfWidth * 0.84,
        radius - height * 0.52 - (shoulder ? height * 0.27 : 0),
        0,
      );
      // A rectangular lug's tangential corners otherwise exceed the tyre
      // envelope slightly. Keep every vertex within the physical radius.
      for (let i = 0; i < p.count; i++) {
        const radial = Math.hypot(p.getY(i), p.getZ(i));
        if (radial > radius)
          p.setXYZ(i, p.getX(i), (p.getY(i) * radius) / radial, (p.getZ(i) * radius) / radial);
      }
      g.computeVertexNormals();
      g.rotateX(a + (shoulder ? (Math.PI / count) * 0.28 : 0));
      parts.push(g);
    }
  }
  const result = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  return result;
}
