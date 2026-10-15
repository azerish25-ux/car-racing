import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, type Setup } from '../src/simulation/config.ts';
import { setupFor, VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { SETUP_EFFECTS } from '../src/career/economy.ts';
import {
  applySetupScreen,
  setupHint,
  setupMachine,
  setupRange,
  setupScreenKeys,
  setupScreenValues,
  setupSectionHtml,
  setupStep,
} from '../src/ui/setup-screen.ts';

const inputs = (html: string) =>
  [
    ...html.matchAll(
      /<input name="(\w+)" data-setup type="range" min="([^"]+)" max="([^"]+)" step="([^"]+)" value="([^"]+)"/g,
    ),
  ].map((m) => ({ key: m[1] as keyof Setup, min: +m[2], max: +m[3], step: m[4], value: +m[5] }));
/** A machine with its own baseline for an exposed key. */
const withBaseline = Object.values(VEHICLES).find((d) =>
  d.setupKeys.some(
    (k) => d.setupDefaults?.[k] !== undefined && d.setupDefaults[k] !== DEFAULT_SETUP[k],
  ),
) as VehicleDefinition;

describe('cars loose ends: per-car setup screen', () => {
  it('lists only the active machine setup keys, in its own limits, with plain-language hints', () => {
    for (const def of Object.values(VEHICLES)) {
      const html = setupSectionHtml(def, DEFAULT_SETUP);
      const rows = inputs(html);
      expect(
        rows.map((r) => r.key),
        def.id,
      ).toEqual(setupScreenKeys(def));
      expect(new Set(rows.map((r) => r.key)), def.id).toEqual(new Set(def.setupKeys));
      expect(html).toContain(`data-setup-machine="${def.id}"`);
      const shown = setupScreenValues(def, DEFAULT_SETUP);
      for (const row of rows) {
        const [min, max] = setupRange(def, row.key);
        expect([row.min, row.max], `${def.id} ${row.key}`).toEqual([min, max]);
        expect(row.value, `${def.id} ${row.key}`).toBe(shown[row.key]);
        expect(row.value).toBeGreaterThanOrEqual(min);
        expect(row.value).toBeLessThanOrEqual(max);
        expect(row.step).toBe(String(setupStep(def, row.key, row.value)));
        // The career garage's effect text, both directions.
        expect(html).toContain(SETUP_EFFECTS[row.key].up);
        expect(html).toContain(SETUP_EFFECTS[row.key].down);
        expect(setupHint(row.key).text).toContain(SETUP_EFFECTS[row.key].up);
      }
    }
    expect(setupScreenKeys(VEHICLES.apx01)).toHaveLength(Object.keys(DEFAULT_SETUP).length);
    expect(setupScreenKeys(VEHICLES.rh3)).not.toContain('rearWing');
    expect(setupScreenKeys(VEHICLES.rh3).length).toBeLessThan(Object.keys(DEFAULT_SETUP).length);
    expect(setupScreenKeys(VEHICLES.gpr1)).toEqual(['brakeBias']);
    expect(setupSectionHtml(VEHICLES.rh3, DEFAULT_SETUP)).toContain('are fixed by the machine');
  });
  it('starts from what the machine runs and writes back only the parameters the player moved', () => {
    expect(withBaseline).toBeDefined();
    const def = withBaseline,
      shown = setupScreenValues(def, DEFAULT_SETUP);
    expect(shown).toEqual(setupFor(def, DEFAULT_SETUP, DEFAULT_SETUP));
    // Untouched (and slider float noise): the saved setup is kept exactly, so
    // the machine's own baseline never leaks into the shared setup.
    expect(applySetupScreen(def, DEFAULT_SETUP, (k) => shown[k])).toEqual(DEFAULT_SETUP);
    expect(applySetupScreen(def, DEFAULT_SETUP, (k) => shown[k] * (1 + 1e-12))).toEqual(
      DEFAULT_SETUP,
    );
    // A moved parameter is written; parameters the machine does not expose
    // are never read back, whatever the form holds.
    const key = def.setupKeys[0],
      [min, max] = setupRange(def, key),
      moved = min + (max - min) * 0.25;
    const next = applySetupScreen(def, DEFAULT_SETUP, (k) => (k === key ? moved : shown[k] + 1));
    for (const k of Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
      if (k === key) expect(next[k]).toBeCloseTo(moved, 9);
      else if (!def.setupKeys.includes(k)) expect(next[k]).toBe(DEFAULT_SETUP[k]);
    // Non-finite input is ignored.
    expect(applySetupScreen(def, DEFAULT_SETUP, () => Number.NaN)).toEqual(DEFAULT_SETUP);
  });
  it('resolves the machine: a session entry, a MACHINE menu choice, a mixed grid entry', () => {
    expect(setupMachine('gt8f').id).toBe('gt8f');
    expect(setupMachine(null, 'rh3').id).toBe('rh3');
    expect(setupMachine(undefined, 'mixed', DEFAULT_OPTIONS).id).toBe('tc1');
    expect(setupMachine(undefined, 'multiclass', DEFAULT_OPTIONS).id).toBe('hy9');
    expect(setupMachine(undefined, 'bikes', DEFAULT_OPTIONS).id).toBe('gpr1');
    expect(setupMachine('no-such-car', null).id).toBe('apx01');
    expect(setupMachine(null, null).id).toBe('apx01');
  });
});
