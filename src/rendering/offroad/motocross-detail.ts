import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { canvasTexture } from '../geometry.ts';
import type { RiderColours, RiderDetail } from '../rider.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Mould texture and fine riding scuffs in metres. The same physical grain
 * survives the very different fender, number-board and shroud UV layouts.
 * Derivative filtering removes unresolved grain instead of making it sparkle.
 * No extra textures, geometry or draws are allocated by this finish. */
export function installMotocrossPlasticFinish(material: T.MeshPhysicalMaterial) {
  chainShaderHook(material, 'motocross-moulded-polymer-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vMxPlasticPosition;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxPlasticPosition = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vMxPlasticPosition;
float mxPlasticHeight, mxPlasticScuff;
float mxPlasticNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  vec4 a=fract(sin(vec4(dot(i,vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,0,0),vec3(127.1,311.7,74.7)),
    dot(i+vec3(0,1,0),vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,1,0),vec3(127.1,311.7,74.7))))*43758.5453);
  vec4 b=fract(sin(vec4(dot(i+vec3(0,0,1),vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,0,1),vec3(127.1,311.7,74.7)),
    dot(i+vec3(0,1,1),vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,1,1),vec3(127.1,311.7,74.7))))*43758.5453);
  return mix(mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y),
    mix(mix(b.x,b.y,f.x),mix(b.z,b.w,f.x),f.y),f.z);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
{
  float footprint=length(fwidth(vMxPlasticPosition));
  float fine=1.-smoothstep(.0008,.0035,footprint);
  float grain=mxPlasticNoise(vMxPlasticPosition*850.);
  float scuff=mxPlasticNoise(vMxPlasticPosition*vec3(330.,92.,21.));
  mxPlasticScuff=smoothstep(.66,.87,scuff)*(1.-smoothstep(.004,.019,footprint));
  mxPlasticHeight=(grain-.5)*.000018*fine-mxPlasticScuff*.000018;
  diffuseColor.rgb*=1.+(grain-.5)*.022*fine;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = clamp(roughnessFactor + mxPlasticScuff * .17, .28, .86);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
{
  vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
  vec3 r1=cross(dy,normal),r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(mxPlasticHeight)*r1+dFdy(mxPlasticHeight)*r2);
  normal=normalize(max(abs(det),1.e-10)*normal-gradient);
}`,
      'fragment',
    );
  });
  return material;
}

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

/** A radiator shroud is an injection-moulded duct, not a flat printed plate.
 * A shallow crown, tucked rear edge and raised upper intake catch a continuous
 * moving highlight. Subdivision precedes bending; normals follow the analytic
 * surface so the existing bevel stays hard without faceting the main panel. */
export function motocrossRadiatorShroud(side: number, detail: RiderDetail) {
  const flat = motocrossSidePanel(
    [
      [-0.17, 0.135],
      [0.085, 0.168],
      [0.325, 0.105],
      [0.23, -0.028],
      [0.209, -0.265],
      [0.103, -0.299],
      [0.027, -0.118],
      [-0.129, -0.052],
    ],
    side,
  );
  const geometry = new TessellateModifier(
    detail === 'high' ? 0.055 : detail === 'mid' ? 0.09 : 0.18,
    detail === 'far' ? 2 : 4,
  ).modify(flat);
  flat.dispose();
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  const crown = (y: number, z: number) => {
    const u = T.MathUtils.clamp((z + 0.17) / 0.495, 0, 1),
      v = T.MathUtils.clamp((y + 0.3) / 0.47, 0, 1);
    return (
      0.028 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) -
      0.021 * (1 - T.MathUtils.smoothstep(u, 0, 0.38)) +
      0.008 * T.MathUtils.smoothstep(v, 0.5, 0.8) * T.MathUtils.smoothstep(u, 0.35, 0.75)
    );
  };
  const n = new T.Vector3(),
    step = 0.0001;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i),
      z = position.getZ(i);
    const dy = (crown(y + step, z) - crown(y - step, z)) / (2 * step),
      dz = (crown(y, z + step) - crown(y, z - step)) / (2 * step);
    n.fromBufferAttribute(normal, i);
    n.set(n.x, n.y - side * dy * n.x, n.z - side * dz * n.x).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    position.setX(i, position.getX(i) + side * crown(y, z));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
      const g = motocrossLug(shoulder ? halfWidth * 0.5 : halfWidth * 0.58, height, 0.026);
      const p = g.getAttribute('position');
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

/** Rounded manufacturing corners and a narrow worn crown on each tread lug.
 * Three chamfered rings keep the polygon cost bounded; no per-lug mesh, texture
 * or rounded-box subdivision is kept after the wheel has been merged. */
function motocrossLug(width: number, height: number, length: number) {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const corner = 0.17;
  const ring = [
    [-1 + corner, -1],
    [1 - corner, -1],
    [1, -1 + corner],
    [1, 1 - corner],
    [1 - corner, 1],
    [-1 + corner, 1],
    [-1, 1 - corner],
    [-1, -1 + corner],
  ];
  for (const [scale, y] of [
    [1, -height * 0.5],
    [0.88, height * 0.35],
    [0.76, height * 0.5],
  ])
    for (const [x, z] of ring) {
      positions.push((x * width * scale) / 2, y, (z * length * scale) / 2);
      uv.push((x + 1) / 2, (z + 1) / 2);
    }
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 8; i++) {
      const a = row * 8 + i,
        b = row * 8 + ((i + 1) % 8);
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  for (let i = 1; i < 7; i++) {
    indices.push(0, i, i + 1);
    indices.push(16, 16 + i + 1, 16 + i);
  }
  const indexed = new T.BufferGeometry();
  indexed.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  return geometry;
}
