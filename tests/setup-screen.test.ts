import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, type Setup } from '../src/simulation/config.ts';
import { setupFor, VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { SETUP_EFFECTS } from '../src/career/economy.ts';
import {
  applySetupScreen,
  setupContext,
  setupHint,
  setupMachine,
  setupRange,
  setupReservedValue,
  setupSaveNote,
  setupSavedValue,
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
  it('never lets the shared-default sentinel swallow a value the player chose', () => {
    // setupFor reads a saved value equal to DEFAULT_SETUP as "run the
    // machine's own baseline": choosing exactly that value on a machine with
    // its own baseline used to save, then show and run the baseline again.
    let pairs = 0;
    for (const def of Object.values(VEHICLES))
      for (const key of setupScreenKeys(def)) {
        const reserved = setupReservedValue(def, key),
          [min, max] = setupRange(def, key);
        if (reserved === null) {
          expect(setupSavedValue(def, key, DEFAULT_SETUP[key], 0)).toBe(DEFAULT_SETUP[key]);
          continue;
        }
        expect(reserved).toBe(DEFAULT_SETUP[key]);
        if (reserved < min || reserved > max) continue;
        pairs++;
        const shown = setupScreenValues(def, DEFAULT_SETUP);
        expect(shown[key], `${def.id} ${key}`).not.toBe(reserved);
        const next = applySetupScreen(def, DEFAULT_SETUP, (k) => (k === key ? reserved : shown[k]));
        const after = setupScreenValues(def, next)[key];
        // Saved as a neighbour of the chosen value, inside the slider range,
        // and both the reopened screen and the simulation's setup agree on it.
        expect(after, `${def.id} ${key}`).not.toBe(shown[key]);
        expect(after, `${def.id} ${key}`).not.toBe(reserved);
        expect(after).toBeGreaterThanOrEqual(min);
        expect(after).toBeLessThanOrEqual(max);
        expect(Math.abs(after - reserved)).toBeLessThanOrEqual(500);
        expect(setupFor(def, next, DEFAULT_SETUP)[key]).toBe(after);
        expect(next[key]).toBe(after);
        // The row says why, before the save.
        expect(setupSaveNote(def, key, reserved, shown[key]), `${def.id} ${key}`).toContain(
          String(after),
        );
        expect(setupSaveNote(def, key, after, shown[key])).toBe('');
      }
    expect(pairs).toBeGreaterThanOrEqual(40);
    // The reported cases: rl2 front anti-roll 26000 (baseline 18000), moved up.
    const rl2 = VEHICLES.rl2,
      rl2Shown = setupScreenValues(rl2, DEFAULT_SETUP);
    expect(rl2Shown.frontARB).toBe(18000);
    expect(DEFAULT_SETUP.frontARB).toBe(26000);
    const rl2Next = applySetupScreen(rl2, DEFAULT_SETUP, (k) =>
      k === 'frontARB' ? 26000 : rl2Shown[k],
    );
    expect(setupScreenValues(rl2, rl2Next).frontARB).toBe(26500);
    // Coming down from above, it lands one step below.
    const high = { ...DEFAULT_SETUP, frontARB: 30000 };
    expect(
      setupScreenValues(
        rl2,
        applySetupScreen(rl2, high, (k) =>
          k === 'frontARB' ? 26000 : setupScreenValues(rl2, high)[k],
        ),
      ).frontARB,
    ).toBe(25500);
    // The kart's brake bias: 0.56 is the shared default, its baseline 0.48.
    const kart = VEHICLES.sk125,
      kartShown = setupScreenValues(kart, DEFAULT_SETUP);
    const kartNext = applySetupScreen(kart, DEFAULT_SETUP, (k) =>
      k === 'brakeBias' ? DEFAULT_SETUP.brakeBias : kartShown[k],
    );
    expect(setupScreenValues(kart, kartNext).brakeBias).not.toBe(kartShown.brakeBias);
    expect(setupScreenValues(kart, kartNext).brakeBias).toBeCloseTo(
      DEFAULT_SETUP.brakeBias + 0.001,
      9,
    );
  });
  it('resolves the session machine without a vehicle list, and a career preset read-only', () => {
    // A Formula-only session (championship, default options) lists no vehicles:
    // the screen edits the Formula car, never the paddock's last MACHINE choice.
    expect(DEFAULT_OPTIONS.vehicles).toBeUndefined();
    const formula = setupContext(true, DEFAULT_OPTIONS.vehicles, null);
    expect(formula).toEqual({ machine: 'apx01', preset: null });
    expect(setupMachine(formula.machine, 'gt8f', DEFAULT_OPTIONS).id).toBe('apx01');
    expect(setupContext(true, ['gt8f', 'tc1'], null).machine).toBe('gt8f');
    // Outside a session the MACHINE menu decides.
    expect(setupContext(false, ['gt8f'], { ...DEFAULT_SETUP })).toEqual({
      machine: null,
      preset: null,
    });
    expect(setupMachine(setupContext(false, undefined, null).machine, 'gt8f').id).toBe('gt8f');
    // A career session racing a garage preset shows the preset it runs.
    const gt = VEHICLES.gt8f,
      key = setupScreenKeys(gt).find((k) => k === 'frontSpring') ?? setupScreenKeys(gt)[0],
      [min, max] = setupRange(gt, key);
    const preset = { ...DEFAULT_SETUP, [key]: min + (max - min) * 0.75 };
    const context = setupContext(true, ['gt8f'], preset);
    expect(context.preset).toBe(preset);
    const html = setupSectionHtml(gt, DEFAULT_SETUP, context.preset);
    const rows = inputs(html);
    expect(rows.find((r) => r.key === key)!.value).toBe(setupFor(gt, preset, DEFAULT_SETUP)[key]);
    expect(rows.find((r) => r.key === key)!.value).not.toBe(
      setupScreenValues(gt, DEFAULT_SETUP)[key],
    );
    expect(html).toContain('data-setup-preset');
    expect(html).toContain('career garage');
    expect(html).not.toContain('take effect at the next session start');
    expect(html.match(/<input [^>]*data-setup[^>]*>/g)!.every((i) => / disabled/.test(i))).toBe(
      true,
    );
    // Its save writes nothing back into the GARAGE & SETTINGS setup.
    expect(
      applySetupScreen(gt, DEFAULT_SETUP, (k) => (k === key ? max : min), context.preset),
    ).toEqual(DEFAULT_SETUP);
    // Without a preset the section stays editable.
    const editable = setupSectionHtml(gt, DEFAULT_SETUP, null);
    expect(editable).not.toContain(' disabled');
    expect(editable).toContain('take effect at the next session start');
  });
  it('keeps each hint out of its slider label so it is described once, not named', () => {
    const def = VEHICLES.apx01,
      html = setupSectionHtml(def, DEFAULT_SETUP);
    const labels = [...html.matchAll(/<label class="range-row">([\s\S]*?)<\/label>/g)];
    expect(labels).toHaveLength(setupScreenKeys(def).length);
    for (const [, inner] of labels) {
      expect(inner).not.toContain('setup-hint');
      expect(inner).not.toContain('▲');
      expect(inner).not.toContain('▼');
    }
    for (const key of setupScreenKeys(def)) {
      expect(html).toContain(`aria-describedby="hint-${key} note-${key}"`);
      expect(html).toContain(`<small class="setup-hint" id="hint-${key}">`);
      expect(html).toContain(`<small class="setup-note" id="note-${key}" aria-live="polite">`);
    }
    // The glyphs are hidden from assistive technology; words stand in for them.
    expect(html).not.toMatch(/(?<!aria-hidden="true">)[▲▼]/);
    expect(html).toContain('<span class="visually-hidden">Higher:</span>');
    expect(html).toContain('<span class="visually-hidden">Lower:</span>');
  });
});
