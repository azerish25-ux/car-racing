import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE } from '../../simulation/protocol.ts';
import {
  lapClock,
  SteeringDisplayClock,
  steeringReadout,
  tyreTempColour,
} from '../steering-display.ts';

/** Cabin instruments of the procedural catalogue cars (cars loose ends 2).
 * They read exactly the snapshot fields the HUD and the Formula wheel display
 * read (`steeringReadout`), refreshed by the same simulation-time clock
 * (`SteeringDisplayClock`), and are scaled to the machine's own engine (idle,
 * shift and limiter speeds): a race dash (gear, speed, shift lights, rev bar,
 * lap clock, delta, tyre temperatures), a road binnacle (tachometer and
 * speedometer dials with a gear readout), or a compact wheel display. */
export type DisplayKind = 'race' | 'road' | 'wheel';
export interface EngineScale {
  idleRPM: number;
  shiftRPM: number;
  limiterRPM: number;
}
export const SHIFT_LIGHTS = 10;
/** Lit shift lights: the first comes on at 82 % of the shift speed, the last
 * at the shift speed itself. */
export function cabinShiftLights(rpm: number, engine: EngineScale) {
  if (!Number.isFinite(rpm)) return 0;
  const start = engine.shiftRPM * 0.82,
    step = (engine.shiftRPM - start) / (SHIFT_LIGHTS - 1);
  return clamp(Math.floor((rpm - start) / step) + 1, 0, SHIFT_LIGHTS);
}
/** Values on the cabin instruments for one snapshot entrant. */
export function cabinReadout(frame: Float32Array, base: number, engine: EngineScale) {
  const value = steeringReadout(frame, base);
  const span = Math.max(1, engine.limiterRPM - engine.idleRPM);
  return {
    ...value,
    /** Rev-counter share between idle and limiter. */
    revs: clamp((value.rpm - engine.idleRPM) / span, 0, 1),
    lights: cabinShiftLights(value.rpm, engine),
    lapTime: frame[base + F.LAP_TIME],
  };
}
const FONT = '"Saira", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const LIGHT_COLOURS = [
  '#3ddc5a',
  '#3ddc5a',
  '#3ddc5a',
  '#3ddc5a',
  '#ffd21f',
  '#ffd21f',
  '#ffd21f',
  '#ff4a3d',
  '#ff4a3d',
  '#4aa3ff',
];
/** Draw the instruments on a 512 x 256 canvas. */
export function drawCabinDisplay(
  c: CanvasRenderingContext2D,
  frame: Float32Array,
  base: number,
  kind: DisplayKind,
  engine: EngineScale,
) {
  const v = cabinReadout(frame, base, engine);
  c.fillStyle = '#030406';
  c.fillRect(0, 0, 512, 256);
  c.textBaseline = 'middle';
  if (kind === 'road') {
    // Tachometer (left) and speedometer (right), 270-degree sweeps.
    const dial = (cx: number, share: number, label: string, ticks: number, red: number) => {
      c.strokeStyle = '#2a2f36';
      c.lineWidth = 6;
      c.beginPath();
      c.arc(cx, 128, 104, Math.PI * 0.75, Math.PI * 2.25);
      c.stroke();
      for (let i = 0; i <= ticks; i++) {
        const a = Math.PI * 0.75 + (i / ticks) * Math.PI * 1.5;
        c.strokeStyle = i / ticks >= red ? '#ff4a3d' : '#d8dde4';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * 86, 128 + Math.sin(a) * 86);
        c.lineTo(cx + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
        c.stroke();
      }
      const a = Math.PI * 0.75 + clamp(share, 0, 1) * Math.PI * 1.5;
      c.strokeStyle = '#ff6a1f';
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(cx, 128);
      c.lineTo(cx + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
      c.stroke();
      c.fillStyle = '#9aa4ad';
      c.font = `600 18px ${FONT}`;
      c.textAlign = 'center';
      c.fillText(label, cx, 196);
    };
    const red =
      (engine.shiftRPM - engine.idleRPM) / Math.max(1, engine.limiterRPM - engine.idleRPM);
    dial(128, v.revs, 'RPM', 8, red);
    dial(384, v.speed / 320, 'KM/H', 8, 2);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.font = `bold 46px ${FONT}`;
    c.fillText(v.gear, 128, 140);
    c.font = `bold 40px ${FONT}`;
    c.fillText(String(v.speed), 384, 140);
    return;
  }
  // Race dash and wheel display: shift lights across the top.
  for (let i = 0; i < SHIFT_LIGHTS; i++) {
    c.fillStyle = i < v.lights ? LIGHT_COLOURS[i] : '#14171c';
    c.fillRect(24 + i * 47, 8, 40, 18);
  }
  c.textAlign = 'center';
  c.fillStyle = '#ffffff';
  c.font = `bold 120px ${FONT}`;
  c.fillText(v.gear, 256, 128);
  c.textAlign = 'left';
  c.font = `600 34px ${FONT}`;
  c.fillText(String(v.speed), 20, 76);
  c.fillStyle = '#9aa4ad';
  c.font = `600 18px ${FONT}`;
  c.fillText('KM/H', 20, 104);
  c.fillStyle = '#c8ccd4';
  c.font = `600 26px ${FONT}`;
  c.fillText(lapClock(v.lapTime), 20, 146);
  const valid = v.delta !== '—';
  c.fillStyle = valid ? (v.ahead ? '#3ddc5a' : '#ff5a5a') : '#9aa4ad';
  c.font = `bold 26px ${FONT}`;
  c.fillText(valid ? v.delta.replace(/(\.\d\d)\d$/, '$1') : 'DELTA', 20, 182);
  if (kind === 'race') {
    // Tyre surface temperatures (the HUD colour scale) and brake bias.
    c.textAlign = 'center';
    c.font = `bold 20px ${FONT}`;
    for (let i = 0; i < 4; i++) {
      const t = frame[base + WHEEL_BASE + i * WHEEL_STRIDE + W.SURFACE_TEMP];
      c.fillStyle = tyreTempColour(t);
      c.fillRect(372 + (i % 2) * 64, 52 + Math.floor(i / 2) * 42, 58, 36);
      c.fillStyle = '#020305';
      c.fillText(
        Number.isFinite(t) ? String(Math.round(t)) : '--',
        401 + (i % 2) * 64,
        71 + Math.floor(i / 2) * 42,
      );
    }
    c.fillStyle = '#c8ccd4';
    c.font = `600 22px ${FONT}`;
    c.fillText(`BB ${v.brakeBias}`, 436, 160);
  }
  // Rev bar along the bottom.
  c.fillStyle = '#0d1a10';
  c.fillRect(16, 214, 480, 26);
  c.fillStyle = v.lights >= SHIFT_LIGHTS ? '#ff4a3d' : '#39d353';
  c.fillRect(16, 214, 480 * v.revs, 26);
}
/** One car's instrument face: a canvas texture when a document exists (the
 * browser), otherwise a plain dark screen (tests, workers). */
export class CabinDisplay {
  readonly material: T.MeshBasicMaterial;
  private readonly ctx: CanvasRenderingContext2D | null = null;
  private readonly texture: T.CanvasTexture | null = null;
  private readonly clock = new SteeringDisplayClock();
  draws = 0;
  constructor(
    readonly kind: DisplayKind,
    readonly engine: EngineScale,
  ) {
    this.material = new T.MeshBasicMaterial({ color: 0x0b0d10 });
    this.material.name = 'Cabin display';
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#030406';
    ctx.fillRect(0, 0, 512, 256);
    this.ctx = ctx;
    this.texture = new T.CanvasTexture(canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.userData.dynamic = true;
    this.material.map = this.texture;
    this.material.color.setHex(0xffffff);
  }
  /** Redraw when the simulation clock or gear says so; true when redrawn. */
  update(frame: Float32Array, base: number) {
    if (!this.ctx || !this.texture) return false;
    if (!this.clock.due(frame[H.TIME], frame[base + F.GEAR])) return false;
    drawCabinDisplay(this.ctx, frame, base, this.kind, this.engine);
    this.texture.needsUpdate = true;
    this.draws++;
    return true;
  }
  dispose() {
    this.texture?.dispose();
    this.material.dispose();
  }
}
