import * as T from 'three';
import { it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';

it('reports body metrics (temporary)', () => {
  for (const def of Object.values(VEHICLES)) {
    const sheet = bodySheetFor(def);
    if (!sheet) continue;
    const body = buildVehicleBody(2, def, sheet);
    const tri = (root: T.Object3D) => {
      let n = 0,
        meshes = 0,
        draws = 0;
      root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        meshes++;
        draws += Array.isArray(o.material) ? o.geometry.groups.length : 1;
        const g = o.geometry as T.BufferGeometry;
        n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      });
      return `${Math.round(n)}t/${draws}d`;
    };
    const box = new T.Box3().setFromObject(body.lods[0].group);
    console.log(
      def.id.padEnd(6),
      body.lods.map((l) => tri(l.group)).join(' '),
      'proxy',
      tri(body.proxy),
      'box',
      box.min.toArray().map((v) => v.toFixed(2)).join(','),
      '..',
      box.max.toArray().map((v) => v.toFixed(2)).join(','),
      'ground',
      body.frame.ground.toFixed(3),
      'hub',
      body.frame.hubFront.toFixed(3),
      body.frame.hubRear.toFixed(3),
      'halfExt',
      def.halfExtents.join(','),
    );
  }
});
