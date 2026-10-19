import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { OffroadHud } from '../src/ui/offroad-hud.ts';
import { FLAG } from '../src/simulation/marshal.ts';

/** Text/style targets for the production HUD's DOM writes. Layout and browser
 * behavior are covered by the UI Playwright fixture; these tests exercise
 * snapshot transitions and assert the actual displayed labels/metrics, with
 * no private HUD state access, renderer or graphics context. */
class HudElement {
  className = '';
  hidden = false;
  textContent = '';
  innerHTML = '';
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: HudElement[] = [];
  readonly fields: { textContent: string }[] = [];
  readonly properties = new Map<string, string>();
  readonly style = {
    cssText: '',
    getPropertyValue: (name: string) => this.properties.get(name) ?? '',
    setProperty: (name: string, value: string) => this.properties.set(name, value),
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(...elements: HudElement[]) {
    this.children.push(...elements);
  }
  appendChild(element: HudElement) {
    this.append(element);
    return element;
  }
  querySelectorAll() {
    // The readout selects the empty heading spans, main labels and note.
    // Discover those text targets from the production markup, not from a
    // second implementation of the HUD state machine.
    if (!this.fields.length)
      for (const _ of this.innerHTML.matchAll(
        /<(span|strong|b)(?:\s[^>]*)?><\/\1>|<div class="mx-ride-note"><\/div>/g,
      )) {
        void _;
        this.fields.push({ textContent: '' });
      }
    return this.fields;
  }
}

beforeEach(() => vi.stubGlobal('document', { createElement: () => new HudElement() }));
afterEach(() => vi.unstubAllGlobals());

function harness() {
  const container = new HudElement(),
    hud = new OffroadHud(container as unknown as HTMLElement),
    track = rigTrack('valley-ridge-mx'),
    frame = new Float32Array(HEADER + CAR_STRIDE),
    base = carBase(0),
    offroad = base + OFFROAD_BASE;
  const options: SessionOptions = {
    ...DEFAULT_OPTIONS,
    circuit: 'valley-ridge-mx',
    mode: 'practice',
    opponents: 0,
    vehicles: ['mx450'],
  };
  frame[H.CARS] = 1;
  frame[H.PHASE] = 2;
  frame[H.LENGTH] = track.length;
  frame[base + F.S] = 215;
  frame[base + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  return {
    pose(yaw: number, speed = 12) {
      frame[base + F.QY] = Math.sin(yaw / 2);
      frame[base + F.QW] = Math.cos(yaw / 2);
      frame[base + F.VX] = 0;
      frame[base + F.VZ] = speed;
      frame[base + F.SPEED] = speed;
    },
    flags(global: number, local: number = FLAG.GREEN) {
      frame[H.FLAG] = global;
      frame[base + F.LOCAL_FLAG] = local;
    },
    present(
      time: number,
      airborne: boolean,
      airTime: number,
      pitch = 0.1,
      normalSpeed = 2,
      bottom = 0,
    ) {
      frame[H.TIME] = time;
      frame[offroad + O.AIRBORNE] = Number(airborne);
      frame[offroad + O.AIR_TIME] = airTime;
      frame[offroad + O.LANDING_PITCH] = pitch;
      frame[offroad + O.LANDING_SPEED] = normalSpeed;
      frame[offroad + O.BOTTOM] = bottom;
      hud.update(frame, track, options);
      const panel = container.children.find((node) => node.className === 'mx-ride-hud')!;
      expect(panel.hidden).toBe(false);
      return panel.fields.map((field) => field.textContent).join(' | ');
    },
  };
}

describe('motocross HUD flight transitions', () => {
  it('uses final touchdown airtime and keeps it with the last qualifying jump through a tiny hop', () => {
    const h = harness();
    expect(h.present(1, true, 0.72)).toContain('0.72 S');
    // The last airborne snapshot precedes contact; the landing snapshot
    // retains the measured final 0.80 s, not the previously seen 0.72 s.
    const landed = h.present(1.08, false, 0.8);
    expect(landed).toContain('CLEAN LANDING');
    expect(landed).toContain('0.80 S');
    expect(h.present(1.8, true, 0.04)).toContain('0.04 S');
    const afterHop = h.present(1.82, false, 0.06);
    expect(afterHop).toContain('LAST JUMP');
    expect(afterHop).toContain('CLEAN LANDING');
    expect(afterHop).toContain('0.80 S');
    expect(afterHop).not.toContain('0.04 S');
    expect(afterHop).not.toContain('0.06 S');
  });

  it('does not apply a tiny early rebound landing to the previous jump grade', () => {
    const h = harness();
    h.present(1, true, 0.8);
    expect(h.present(1.02, false, 0.82)).toContain('CLEAN LANDING');
    h.present(1.09, true, 0.03);
    // A new, short rebound lands inside the old jump's quarter-second
    // settlement window with its own poor pitch and normal-speed fields.
    const rebound = h.present(1.12, false, 0.06, -0.6, 2.5);
    expect(rebound).toContain('CLEAN LANDING');
    expect(rebound).toContain('0.82 S');
    expect(rebound).not.toContain('NOSE LOW');
  });

  it('still revises a continuous grounded settlement when measured bottoming arrives', () => {
    const h = harness();
    h.present(1, true, 0.8);
    expect(h.present(1.02, false, 0.82)).toContain('CLEAN LANDING');
    const bottomed = h.present(1.18, false, 0.82, 0.1, 2, 0.7);
    expect(bottomed).toContain('HARD LANDING');
    expect(bottomed).toContain('0.82 S');
  });

  it('does not invent a landing when a short backward seek crosses from flight to ground', () => {
    const h = harness();
    expect(h.present(1, true, 0.8)).toContain('IN FLIGHT');
    // A 50 ms rewind is smaller than the former 100 ms reset tolerance.
    // These ground fields describe an earlier landing, not a new touchdown.
    const rewound = h.present(0.95, false, 0.65);
    expect(rewound).not.toContain('LAST JUMP');
    expect(rewound).not.toContain('CLEAN LANDING');
    // A genuine subsequent flight still earns feedback; a paused repeat at
    // the exact same time keeps that feedback instead of resetting it.
    h.present(0.97, true, 0.02);
    const landed = h.present(1.3, false, 0.35);
    expect(landed).toContain('CLEAN LANDING');
    expect(landed).toContain('0.35 S');
    expect(h.present(1.3, false, 0.35)).toBe(landed);
  });

  it('explains whip recovery from the presented pose and only acknowledges it after a clean settlement', () => {
    const h = harness();
    h.pose(0.42);
    const whipping = h.present(1, true, 0.4);
    expect(whipping).toContain('BRING IT BACK');
    expect(whipping).toContain('Release steering to square the wheels');
    h.pose(0.01);
    const contact = h.present(1.4, false, 0.8);
    expect(contact).toContain('CLEAN LANDING');
    expect(contact).not.toContain('WHIP LANDED');
    const settled = h.present(1.68, false, 0.8);
    expect(settled).toContain('WHIP LANDED');
    expect(settled).toContain('1 CLEAN IN A ROW');
    expect(h.present(1.68, false, 0.8)).toBe(settled);
  });

  it('retains a crossed touchdown grade after friction removes its sideways motion', () => {
    const h = harness();
    h.pose(0.45);
    h.present(1, true, 0.5);
    h.pose(0.3);
    expect(h.present(1.3, false, 0.8)).toContain('CROSSED LANDING');
    h.pose(0.01);
    h.present(1.4, false, 0.8);
    const settled = h.present(1.6, false, 0.8);
    expect(settled).toContain('CROSSED LANDING');
    expect(settled).not.toContain('WHIP LANDED');
    expect(settled).not.toContain('CLEAN IN A ROW');
  });

  it('does not reward an early rebound or carry a previous whip through a replay seek', () => {
    const h = harness();
    h.pose(0.42);
    h.present(1, true, 0.5);
    h.pose(0);
    h.present(1.3, false, 0.8);
    h.present(1.4, true, 0.03);
    expect(h.present(1.42, false, 0.05)).not.toContain('WHIP LANDED');
    h.present(0.9, false, 0.4);
    h.present(1, true, 0.1);
    h.present(1.5, false, 0.6);
    const settled = h.present(1.8, false, 0.6);
    expect(settled).toContain('CLEAN LANDING');
    expect(settled).not.toContain('WHIP LANDED');
  });
});

describe('motocross HUD race-control priority', () => {
  it.each([FLAG.YELLOW, FLAG.DOUBLE_YELLOW])(
    'replaces acceleration and gap targets under global caution %s',
    (flag) => {
      const h = harness();
      h.flags(flag);
      const text = h.present(1, false, 0);
      expect(text).toContain('TRACK CAUTION');
      expect(text).toContain('ROLL THE NEXT JUMP');
      expect(text).toContain('no overtaking or jumping');
      expect(text).not.toContain('Build drive');
      expect(text).not.toContain('LIP ~');
    },
  );
  it.each([FLAG.YELLOW, FLAG.DOUBLE_YELLOW])(
    'obeys the player sector flag %s even while the global flag is green',
    (flag) => {
      const h = harness();
      h.flags(FLAG.GREEN, flag);
      expect(h.present(1, false, 0)).toContain('ROLL THE NEXT JUMP');
      h.flags(FLAG.GREEN);
      expect(h.present(1.1, false, 0)).not.toContain('TRACK CAUTION');
    },
  );
  it('does not tell a rider already in flight to roll a jump', () => {
    const h = harness();
    h.flags(FLAG.DOUBLE_YELLOW);
    const text = h.present(1, true, 0.8);
    expect(text).toContain('LAND THEN SLOW DOWN');
    expect(text).toContain('0.80 S');
    expect(text).toContain('Match the downslope');
    expect(text).not.toContain('ROLL THE NEXT JUMP');
  });
  it('does not let landing praise hide a new caution', () => {
    const h = harness();
    h.present(1, true, 0.8);
    expect(h.present(1.02, false, 0.82)).toContain('CLEAN LANDING');
    h.flags(FLAG.DOUBLE_YELLOW);
    const text = h.present(1.1, false, 0.82);
    expect(text).toContain('DOUBLE YELLOW');
    expect(text).not.toContain('CLEAN LANDING');
  });
});
