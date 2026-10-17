import * as T from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tagWeatherSurface } from './weather-presentation.ts';
import { canvasTexture } from './geometry.ts';
import { liveryScheme } from './car-livery.ts';
import { BRAND_ART, drawMark, drawWordmark, fitHeight } from './studio/brand-atlas.ts';
import type { BikeMaterials } from './bike.ts';
import type { RiderColours } from './rider.ts';

/** Original typography and paint masks, not copied team marks. One atlas and
 * one merged draw serve both flanks, the nose and the tail. Projection follows
 * the final Blender surfaces; there are no floating circular number plates. */
export function addGPIdentity(root: T.Group, materials: BikeMaterials, entrant = 0) {
  const shell = root.children.find(
    (o) => o instanceof T.Mesh && o.name === 'GP bodywork / paint',
  ) as T.Mesh | undefined;
  if (!shell) return;
  const number = String((entrant % 98) + 2).padStart(2, '0');
  const scheme = liveryScheme(entrant);
  const map = canvasTexture(2048, 1024, (c) => {
    c.clearRect(0, 0, 2048, 1024);
    const polygon = (points: readonly (readonly [number, number])[], colour: string) => {
      c.beginPath();
      points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };
    const ink = '#e7e9e1',
      dark = '#182126';
    const word = (text: string, x: number, y: number, w: number, h: number, colour = ink) => {
      c.strokeStyle = colour;
      const style = { weight: 0.19, width: 0.92, tracking: 0.13, slant: 0.12, corner: 0.1 };
      drawWordmark(c, text, x, y, fitHeight(text, w, h, style), style);
    };
    // A composed works livery: a dark keel, thin cream sweep and individual
    // fictional partner marks. Keep the upper fairing paint visible; the
    // previous giant white nameplate flattened the entire side panel.
    polygon(
      [
        [25, 275],
        [590, 83],
        [1000, 125],
        [1000, 505],
        [25, 505],
      ],
      dark,
    );
    polygon(
      [
        [31, 258],
        [596, 57],
        [1000, 102],
        [1000, 121],
        [594, 78],
        [31, 278],
      ],
      ink,
    );
    polygon(
      [
        [90, 446],
        [1000, 398],
        [1000, 413],
        [90, 465],
      ],
      scheme.accent,
    );
    word('MOTOBOUND', 557, 136, 467, 38);
    drawMark(c, { ...BRAND_ART[scheme.title], ink, accent: scheme.accent }, 116, 175, 774, 134);
    word(scheme.partners[0], 269, 350, 320, 25);
    word(scheme.partners[1], 715, 350, 330, 25);
    c.fillStyle = ink;
    c.fillRect(486, 328, 3, 42);
    word('GP-R1  /  WORKS TEAM', 483, 410, 568, 17);
    word('COMPOSITE SYSTEMS', 520, 482, 442, 15);
    // The prominent race number has a dark backing and a cream outline, not
    // a floating circular plate. All glyphs are original canvas paths, so
    // there is no OS-font or font-loading difference in the race identity.
    polygon(
      [
        [1109, 42],
        [1944, 42],
        [1846, 490],
        [1185, 490],
      ],
      dark,
    );
    polygon(
      [
        [1123, 40],
        [1150, 40],
        [1233, 490],
        [1209, 490],
      ],
      scheme.accent,
    );
    word('MOTOBOUND', 1540, 87, 589, 36);
    const numberStyle = { weight: 0.28, width: 1.0, slant: 0.16, tracking: 0.19, corner: 0.11 };
    c.strokeStyle = ink;
    drawWordmark(c, number, 1538, 266, 242, numberStyle);
    word(scheme.title, 1540, 434, 611, 30);
    // Tail and tank templates share the same atlas and merged material draw.
    word(number, 520, 721, 456, 184);
    word('WORKS RACING', 520, 919, 628, 27);
    polygon(
      [
        [1100, 585],
        [1950, 585],
        [1860, 945],
        [1180, 945],
      ],
      dark,
    );
    word('MOTOBOUND', 1536, 722, 668, 56);
    word(scheme.title, 1536, 813, 601, 31);
    word('PROTOTYPE   /   1000', 1536, 893, 525, 23);
  });
  const material = new T.MeshPhysicalMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.43,
    clearcoat: 0.5,
    clearcoatRoughness: 0.19,
  });
  material.name = 'Original GP conformal identity atlas';
  tagWeatherSurface(material, 'paint');
  materials.list.push(material);
  shell.updateMatrixWorld(true);
  const pieces: T.BufferGeometry[] = [];
  const project = (
    position: T.Vector3,
    rotation: T.Euler,
    size: T.Vector3,
    box: readonly number[],
  ) => {
    const g = new DecalGeometry(shell, position, rotation, size);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, box[0] + uv.getX(i) * box[2], box[1] + uv.getY(i) * box[3]);
    if (g.getAttribute('position').count) pieces.push(g);
    else g.dispose();
  };
  for (const side of [-1, 1])
    project(
      new T.Vector3(side * 0.212, -0.216, 0.095),
      new T.Euler(0, (side * Math.PI) / 2, 0),
      new T.Vector3(0.57, 0.28, 0.14),
      [0, 0.5, 0.5, 0.5],
    );
  project(
    new T.Vector3(0, 0.237, 0.822),
    new T.Euler(-0.86, 0, 0),
    new T.Vector3(0.255, 0.186, 0.22),
    [0.5, 0.5, 0.5, 0.5],
  );
  project(
    new T.Vector3(0, 0.333, -0.665),
    new T.Euler(-Math.PI / 2, 0, Math.PI),
    new T.Vector3(0.145, 0.22, 0.12),
    [0, 0, 0.5, 0.5],
  );
  project(
    new T.Vector3(0, 0.32, -0.055),
    new T.Euler(-Math.PI / 2, 0, Math.PI),
    new T.Vector3(0.14, 0.14, 0.11),
    [0.5, 0, 0.5, 0.5],
  );
  if (pieces.length) {
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    if (!geometry) throw new Error('Incompatible GP decal geometry');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const decal = new T.Mesh(geometry, material);
    decal.name = 'Conformal GP livery';
    decal.receiveShadow = true;
    root.add(decal);
  }
}

export function riderPanelTexture(colours: RiderColours, torso: boolean) {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = css(colours.secondary);
    for (const x of [0, 512, 990]) c.fillRect(x, 0, 38, 512);
    for (const x of [0, 512]) {
      c.beginPath();
      c.moveTo(x + 30, 418);
      c.lineTo(x + 215, 346);
      c.lineTo(x + 420, 352);
      c.lineTo(x + 493, 440);
      c.lineTo(x + 493, 512);
      c.lineTo(x + 30, 512);
      c.closePath();
      c.fill();
      // Stitched light inserts wrap the shoulder and lower back, not the
      // whole limb. Dual edge stitches remain stationary in the bind UVs.
      c.fillStyle = '#d9ddd6';
      c.fillRect(x + 42, 36, 421, torso ? 38 : 24);
      c.fillStyle = css(colours.secondary);
      c.fillRect(x + 42, 79, 421, 3);
      c.strokeStyle = '#a8aead';
      c.lineWidth = 1.3;
      c.setLineDash([5, 4]);
      for (const y of [32, 80, 441]) {
        c.beginPath();
        c.moveTo(x + 45, y);
        c.lineTo(x + 461, y);
        c.stroke();
      }
      c.setLineDash([]);
      c.strokeStyle = '#e4e6e0';
      if (torso) {
        drawWordmark(c, 'MOTOBOUND', x + 256, 151, 30, { weight: 0.19, slant: 0.13 });
        drawWordmark(c, 'WORKS RACING', x + 256, 195, 13, { weight: 0.14, tracking: 0.2 });
        c.fillStyle = '#d9ddd6';
        c.fillRect(x + 81, 224, 344, 67);
        c.strokeStyle = '#1b262a';
        drawWordmark(c, 'MERIDIAN OIL', x + 253, 258, 28, {
          weight: 0.19,
          width: 0.88,
          slant: 0.1,
        });
        c.strokeStyle = '#e4e6e0';
        drawWordmark(c, 'KESTREL', x + 151, 320, 14, { weight: 0.16, tracking: 0.1 });
        drawWordmark(c, 'VOLTEX', x + 353, 320, 15, { weight: 0.18, slant: 0.15 });
      } else {
        drawWordmark(c, 'WORKS', x + 250, 182, 30, { weight: 0.21, slant: 0.18 });
        drawWordmark(c, 'RACING', x + 250, 220, 15, { weight: 0.15, tracking: 0.3 });
      }
      c.fillStyle = css(colours.secondary);
    }
    if (torso) {
      c.fillStyle = '#23272b';
      c.fillRect(253, 350, 6, 146);
      c.fillStyle = '#8b9296';
      for (let y = 353; y < 492; y += 7) c.fillRect(252, y, 8, 2);
    }
  });
}

/** Paint laid out for helmetShell's azimuth/height UVs. Broad asymmetric
 * chevrons identify an entrant at riding distance; the smooth shell supplies
 * all lighting. This is original artwork, not an extracted racing livery. */
export function helmetLiveryTexture(colours: RiderColours) {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    const polygon = (points: readonly (readonly [number, number])[], colour: string) => {
      c.beginPath();
      points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };
    // Long crown lanes taper into the eye-port shoulders. The rear half has
    // the same panel cadence but different diagonal spacing for orientation.
    for (const x of [0, 512]) {
      polygon(
        [
          [x + 44, 0],
          [x + 162, 0],
          [x + 218, 168],
          [x + 171, 236],
          [x + 110, 202],
          [x + 67, 90],
        ],
        '#e5e9e7',
      );
      polygon(
        [
          [x + 56, 0],
          [x + 141, 0],
          [x + 196, 167],
          [x + 162, 208],
          [x + 123, 185],
          [x + 79, 78],
        ],
        css(colours.secondary),
      );
      polygon(
        [
          [x + 316, 0],
          [x + 407, 0],
          [x + 385, 94],
          [x + 312, 215],
          [x + 291, 169],
        ],
        css(colours.accent),
      );
      polygon(
        [
          [x + 360, 296],
          [x + 487, 216],
          [x + 512, 248],
          [x + 512, 439],
          [x + 292, 456],
          [x + 182, 423],
        ],
        css(colours.secondary),
      );
      polygon(
        [
          [x + 350, 312],
          [x + 501, 241],
          [x + 512, 259],
          [x + 369, 334],
          [x + 200, 441],
          [x + 182, 423],
        ],
        css(colours.accent),
      );
    }
    c.fillStyle = '#e5e9e7';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'italic 900 29px "Saira Variable", sans-serif';
    c.fillText('MB', 256, 187, 68);
    c.font = 'italic 800 40px "Saira Variable", sans-serif';
    c.fillText('MOTOBOUND', 768, 313, 282);
    c.font = '600 15px sans-serif';
    c.fillText('RACING EQUIPMENT', 768, 348, 256);
    // Fine lower edge trim follows the real neck-opening contour.
    c.fillStyle = css(colours.secondary);
    c.fillRect(0, 481, 1024, 31);
    c.fillStyle = css(colours.accent);
    c.fillRect(0, 475, 1024, 5);
  });
}
