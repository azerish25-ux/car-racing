import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { OffroadCourse } from '../../simulation/offroad/course.ts';
import { GATE_DROP_SECONDS, gateSlots } from '../../simulation/offroad/session.ts';
import { H } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { materials } from '../materials/index.ts';

/** Gate panel (m): a perforated steel grate hinged at its foot. */
const PANEL = Object.freeze({ height: 0.52, thickness: 0.035, gap: 0.08 });
/**
 * Motocross / supercross start gate (WP41): one hinged steel panel per slot
 * across the start straight, a concrete starter's pad behind the line and
 * end posts. The panels stand while the field is held and fall forward
 * together over GATE_DROP_SECONDS once the session's synchronised release
 * fires (race time from the snapshot), so live play and replays agree.
 */
export class StartGate {
  readonly root = new T.Group();
  private readonly panels: T.Group[] = [];
  constructor(track: Track, course: OffroadCourse) {
    const gate = course.spec.gate!;
    const p = trackPoint();
    track.at(gate.s, p);
    this.root.name = 'Start gate';
    this.root.position.set(p.x, p.y, p.z);
    // Local +Z along the lap, +X along the track normal (lateral).
    this.root.rotation.y = Math.atan2(p.tx, p.tz);
    // Galvanised grates on a dark, weathered steel frame.
    const steel = materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.48 });
    const frame = materials.metal({
      kind: 'cast',
      metal: 'steel',
      color: 0x3b3f44,
      roughness: 0.62,
    });
    const pad = materials.concrete({ variant: 'rough', horizontal: 1 });
    const { lateral } = gateSlots(track, course, gate.slots);
    const panelWidth = gate.spacing - PANEL.gap;
    const grate = new T.BoxGeometry(panelWidth, PANEL.height, PANEL.thickness);
    grate.translate(0, PANEL.height / 2, 0);
    const bar = new T.BoxGeometry(panelWidth, 0.05, 0.05);
    for (const l of lateral) {
      const hinge = new T.Group();
      hinge.position.set(l, 0.02, 0.06);
      const panel = new T.Mesh(grate, steel);
      panel.castShadow = panel.receiveShadow = true;
      const top = new T.Mesh(bar, frame);
      top.position.y = PANEL.height;
      hinge.add(panel, top);
      this.root.add(hinge);
      this.panels.push(hinge);
    }
    // The hinge beam across the whole gate and its end posts.
    const span = (lateral.length + 1) * gate.spacing;
    const beam = new T.Mesh(new T.BoxGeometry(span, 0.08, 0.12), frame);
    beam.position.set(0, 0.04, 0.06);
    beam.castShadow = beam.receiveShadow = true;
    this.root.add(beam);
    for (const side of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.14, 1.1, 0.14), frame);
      post.position.set((side * span) / 2, 0.55, 0.06);
      post.castShadow = post.receiveShadow = true;
      this.root.add(post);
    }
    // Starter's pad (riders' side): concrete, flush with the dirt.
    const slab = new T.Mesh(new T.BoxGeometry(span, 0.12, 2.6), pad);
    slab.position.set(0, -0.05, -1.4);
    slab.receiveShadow = true;
    this.root.add(slab);
    this.root.updateMatrixWorld(true);
  }
  /** Panel angle from the snapshot: standing until the release, then falling. */
  update(frame: Float32Array) {
    const phase = frame[H.PHASE],
      t = frame[H.RACE_TIME];
    const drop = phase < PHASE.RACING ? 0 : clamp(t / GATE_DROP_SECONDS, 0, 1);
    // Falls forward (away from the riders) onto the track.
    const angle = (Math.PI / 2) * drop * drop;
    for (const panel of this.panels) panel.rotation.x = angle;
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
  }
}
