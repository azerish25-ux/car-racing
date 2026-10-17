import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../core/math.ts';
import type { OffroadCourse } from '../../simulation/offroad/course.ts';
import { GATE_DROP_SECONDS, gateSlots } from '../../simulation/offroad/session.ts';
import { H } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { materials } from '../materials/index.ts';

/** Gate panel (m): a perforated steel grate hinged at its foot. */
const PANEL = Object.freeze({ height: 0.52, thickness: 0.035, gap: 0.08 });
/**
 * Motocross / supercross start gate (WP41): one hinged steel panel per slot
 * across the start straight, a concrete starter's pad behind the line and
 * end posts. The panels stand while the field is held and fall forward
 * together over GATE_DROP_SECONDS once the session's synchronised release
 * fires (race time from the snapshot), so live play and replays agree. A
 * field larger than the venue's slots widens the gate exactly as the
 * session does (`gateSlots` with the rider count from the snapshot), so
 * every rider has a panel in front of it.
 */
export class StartGate {
  readonly root = new T.Group();
  private readonly panels: T.Group[] = [];
  private body = new T.Group();
  private slots = 0;
  private readonly steel = materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.48 });
  // Galvanised grates on a dark, weathered steel frame.
  private readonly frame = materials.metal({
    kind: 'cast',
    metal: 'steel',
    color: 0x3b3f44,
    roughness: 0.62,
  });
  private readonly pad = materials.concrete({ variant: 'rough', horizontal: 1 });
  constructor(
    private readonly track: Track,
    private readonly course: OffroadCourse,
  ) {
    const gate = course.spec.gate!;
    const p = trackPoint();
    track.at(gate.s, p);
    this.root.name = 'Start gate';
    installScannedMaps(this.pad, 'concrete', libraryAlbedo(this.pad));
    this.root.position.set(p.x, p.y, p.z);
    // Local +Z along the lap, +X along the track normal (lateral).
    this.root.rotation.y = Math.atan2(p.tx, p.tz);
    this.build(gate.slots);
  }
  /** Panels for `riders` slots (at least the venue's own), as the session lays them out. */
  private build(riders: number) {
    const gate = this.course.spec.gate!;
    this.root.remove(this.body);
    const oldGeometry = new Set<T.BufferGeometry>();
    this.body.traverse((o) => {
      if (o instanceof T.Mesh) oldGeometry.add(o.geometry);
    });
    for (const g of oldGeometry) g.dispose();
    this.body = new T.Group();
    this.panels.length = 0;
    const { lateral } = gateSlots(this.track, this.course, riders);
    this.slots = lateral.length;
    const panelWidth = gate.spacing - PANEL.gap;
    // Open welded bars reveal the soil and the front tyre through each
    // panel. The hinge and release timing are still the session's gate.
    const bars: T.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++)
      bars.push(
        new T.BoxGeometry(0.022, PANEL.height, PANEL.thickness).translate(
          (i / 8 - 0.5) * (panelWidth - 0.022),
          PANEL.height / 2,
          0,
        ),
      );
    for (const y of [0.02, PANEL.height * 0.46, PANEL.height - 0.02])
      bars.push(new T.BoxGeometry(panelWidth, 0.024, PANEL.thickness).translate(0, y, 0));
    const grate = mergeGeometries(bars, false)!;
    for (const g of bars) g.dispose();
    const bar = new T.BoxGeometry(panelWidth, 0.05, 0.05);
    for (const l of lateral) {
      const hinge = new T.Group();
      hinge.position.set(l, 0.02, 0.06);
      const panel = new T.Mesh(grate, this.steel);
      panel.castShadow = panel.receiveShadow = true;
      const top = new T.Mesh(bar, this.frame);
      top.position.y = PANEL.height;
      hinge.add(panel, top);
      this.body.add(hinge);
      this.panels.push(hinge);
    }
    // The hinge beam across the whole gate and its end posts.
    const span = (lateral.length + 1) * gate.spacing;
    const beam = new T.Mesh(new T.BoxGeometry(span, 0.08, 0.12), this.frame);
    beam.position.set(0, 0.04, 0.06);
    beam.castShadow = beam.receiveShadow = true;
    this.body.add(beam);
    for (const side of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.14, 1.1, 0.14), this.frame);
      post.position.set((side * span) / 2, 0.55, 0.06);
      post.castShadow = post.receiveShadow = true;
      this.body.add(post);
    }
    // Starter's pad (riders' side): concrete, flush with the dirt.
    const slab = new T.Mesh(new T.BoxGeometry(span, 0.12, 2.6), this.pad);
    slab.position.set(0, -0.05, -1.4);
    slab.receiveShadow = true;
    this.body.add(slab);
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
  }
  /** Panel count (the venue's slots, or the larger field it was widened for). */
  get panelCount() {
    return this.panels.length;
  }
  /** Panel angle from the snapshot: standing until the release, then falling. */
  update(frame: Float32Array) {
    const riders = Math.round(frame[H.CARS]);
    if (riders > this.slots) this.build(riders);
    const phase = frame[H.PHASE],
      t = frame[H.RACE_TIME];
    const drop = phase < PHASE.RACING ? 0 : clamp(t / GATE_DROP_SECONDS, 0, 1);
    // Falls forward (away from the riders) onto the track.
    const angle = (Math.PI / 2) * drop * drop;
    for (const panel of this.panels) panel.rotation.x = angle;
  }
  dispose() {
    const geometry = new Set<T.BufferGeometry>();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) geometry.add(o.geometry);
    });
    for (const g of geometry) g.dispose();
    this.steel.dispose();
    this.frame.dispose();
    this.pad.dispose();
    this.root.clear();
  }
}
