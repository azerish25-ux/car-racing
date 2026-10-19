import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { GridPreparationView } from '../src/rendering/grid-preparation.ts';
import { GridPresentationView } from '../src/rendering/grid-presentation-view.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

const heldGrid = (machine: 'mx250' | 'mx450' | 'apx01') =>
  new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 1,
    circuit: machine === 'apx01' ? 'aurel' : 'valley-ridge-mx',
    vehicles: [machine, machine],
  }).makeFrame();

function dispose(root: T.Object3D) {
  root.traverse((object) => {
    if (object instanceof T.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    }
    if (object instanceof T.InstancedMesh) object.dispose();
  });
}

describe('motocross gates keep staff without Formula tyre blankets', () => {
  it('clears blankets and straps on both real MX grids and restores Formula on the same view', () => {
    const formula = heldGrid('apx01'),
      mx250 = heldGrid('mx250'),
      mx450 = heldGrid('mx450'),
      view = new GridPreparationView();
    let formulaMatrices: Float32Array | undefined;
    try {
      for (const frame of [formula, mx250, formula, mx450, formula]) {
        const before = frame.slice(),
          isFormula = frame === formula,
          camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
        expect(frame[H.TIME]).toBe(0);
        view.update(frame, camera);
        expect(view.diagnostics()).toEqual({ blankets: isFormula ? 8 : 0, staff: 4 });
        expect(view.straps.count).toBe(isFormula ? 16 : 0);
        if (isFormula) {
          const matrices = view.blankets.instanceMatrix.array as Float32Array;
          if (formulaMatrices) expect(matrices).toEqual(formulaMatrices);
          else formulaMatrices = matrices.slice();
        }
        expect(frame).toEqual(before);
      }
      // Withdrawing props and backward seeks must not resurrect MX warmers.
      mx450[H.TIME] = 0.4;
      const camera = new T.Vector3().fromArray(mx450, carBase(0) + F.X);
      view.update(mx450, camera);
      expect(view.diagnostics()).toEqual({ blankets: 0, staff: 0 });
      expect(view.straps.count).toBe(0);
      mx450[H.TIME] = 0;
      view.update(mx450, camera);
      expect(view.diagnostics()).toEqual({ blankets: 0, staff: 4 });
    } finally {
      dispose(view.root);
    }
  });

  it('keeps the tick-zero presentation cast while skipping MX blanket-removal rigs and restoring Formula', () => {
    const formula = heldGrid('apx01'),
      mx250 = heldGrid('mx250'),
      mx450 = heldGrid('mx450'),
      view = new GridPresentationView();
    let formulaDiagnostics: ReturnType<GridPresentationView['diagnostics']> | undefined;
    try {
      for (const frame of [formula, mx250, formula, mx450, formula]) {
        const before = frame.slice(),
          isFormula = frame === formula,
          camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
        for (const time of [0, 12, 4, 12]) {
          view.update(frame, camera, time);
          const result = view.diagnostics();
          expect(result.blankets).toBe(isFormula ? 8 : 0);
          expect(result.actors).toBe(isFormula ? 8 : 0);
          expect(result.cast.actors).toBe(4);
          if (isFormula && time === 12) {
            if (formulaDiagnostics) expect(result).toEqual(formulaDiagnostics);
            else formulaDiagnostics = result;
          }
        }
        expect(frame).toEqual(before);
      }
      view.update(mx450, new T.Vector3().fromArray(mx450, carBase(0) + F.X), null);
      expect(view.diagnostics()).toMatchObject({ blankets: 0, actors: 0, cast: { actors: 0 } });
    } finally {
      view.dispose();
      dispose(view.root);
    }
  });
});
