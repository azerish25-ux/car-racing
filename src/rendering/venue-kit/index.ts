import * as T from 'three';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { buildBarrierChunk } from './barriers.ts';
import { VenueKitContext } from './context.ts';
import { queueGround, type RibbonHost } from './ground.ts';
import { buildScatter } from './scatter.ts';
import {
  buildBoards,
  buildBridges,
  buildFacades,
  buildGantries,
  buildLightTowers,
  buildPaddock,
  buildRockAndDrops,
  buildTunnels,
} from './structures.ts';
import { chunks } from './sweep.ts';
import { FACADE_STREET_LIGHT, FACADE_WINDOWS, facadeStreetUniforms } from './materials.ts';
import { buildMotocrossBoundary, isMotocrossVenue } from '../offroad/mx-boundary.ts';

/** Procedural venue kit (WP30): dresses ANY catalogue CircuitDefinition from
 * its data — verges and run-off where physics reads them, barriers by kind on
 * the collision boundary, a paddock on the venue's own pit side, city
 * frontage, tunnels, bridges at crossings, cuttings, cliffs and quays, light
 * towers, braking boards and scatter — with chunked geometry for culling and
 * distance LOD for small instanced detail. Aurel and Vellamar keep their
 * bespoke dressing; the kit is never built for them. */
export class VenueKit {
  readonly context: VenueKitContext;
  private readonly camera = new T.Vector3();
  private readonly point = trackPoint();
  private nightState: string | null = null;
  constructor(readonly track: Track) {
    this.context = new VenueKitContext(track);
  }
  get root() {
    return this.context.root;
  }
  /** Queue every dressing task into the circuit's cooperative build queue. */
  enqueue(host: RibbonHost) {
    const kit = this.context,
      track = this.track,
      queue = host.construction,
      motocross = isMotocrossVenue(track);
    queueGround(kit, host);
    if (motocross)
      queue.add('MX physical boundary padding', 2, () => kit.add(buildMotocrossBoundary(track)));
    else {
      for (const [a, b] of chunks(0, track.length, 60))
        queue.add('Venue kit barriers', 2, () => buildBarrierChunk(kit, a, b));
      queue.add('Venue kit paddock and pit wall', 2, () => buildPaddock(kit));
    }
    if (kit.meta.dressing.tunnels.length)
      queue.add('Venue kit tunnels', 2, () => buildTunnels(kit));
    if (kit.meta.dressing.crossings.length)
      queue.add('Venue kit bridges', 2, () => buildBridges(kit));
    if (kit.meta.dressing.rock.length || kit.meta.dressing.drops.length)
      queue.add('Venue kit cuttings, cliffs and quays', 2, () => buildRockAndDrops(kit));
    if (kit.meta.dressing.facades.length)
      queue.add('Venue kit city frontage', 3, () => buildFacades(kit));
    if (kit.meta.dressing.gantries.length)
      queue.add('Venue kit crane gantries', 2, () => buildGantries(kit));
    // The SX roof carries its own floodlight banks. Circuit towers and pit
    // buildings can intersect its compact neighboring rhythm lanes.
    if (!motocross && (kit.style.lightTowers || kit.meta.night || kit.meta.dayNight))
      queue.add('Venue kit light towers', 3, () => buildLightTowers(kit));
    if (!motocross) queue.add('Venue kit braking boards', 3, () => buildBoards(kit));
    queue.add('Venue kit scatter', 3, () => buildScatter(kit));
    queue.add('Seal venue kit transforms', 6, () => this.root.sealTransforms());
  }
  /** A city venue: frontage lines the circuit (urban skyglow at night). */
  get urban() {
    return this.context.meta.dressing.facades.length > 0;
  }
  /** Distance LOD and night emission. Cheap: one distance per detail cell.
   * `physical`: the energy-conserving bloom draws the lamp heads' glare, so
   * they carry physical radiance. */
  update(camera: T.Camera, night: boolean, physical = false) {
    camera.getWorldPosition(this.camera);
    for (const cell of this.context.cells)
      cell.object.visible = cell.centre.distanceTo(this.camera) < cell.range;
    const state = `${night}:${physical}`;
    if (state === this.nightState) return;
    this.nightState = state;
    const m = this.context.materials;
    // Windows: FACADE_WINDOWS (log-normal rooms); the street lights the
    // lower storeys (FACADE_STREET_LIGHT).
    for (const f of m.facades) f.emissiveIntensity = night ? FACADE_WINDOWS.emissive : 0;
    facadeStreetUniforms.facadeStreetLight.value = night ? FACADE_STREET_LIGHT.irradiance : 0;
    for (const n of m.neon) n.emissiveIntensity = night ? 4 : 0.5;
    m.lamp.emissiveIntensity = night ? (physical ? 150 : 8) : 0.05;
  }
  /** Planting exclusion: structures, stands and paddock footprints. */
  blocks(x: number, z: number, padding = 0) {
    return this.context.blocks(x, z, padding);
  }
  /** Rain shelter: is (x, z) under a tunnel roof? */
  covers(x: number, z: number) {
    const l = this.track.nearest(x, z, this.point);
    return (
      this.track.isCovered(this.point.s) &&
      Math.abs(l) < this.track.boundaryAt(this.point, l < 0 ? -1 : 1) + 0.5
    );
  }
  diagnostics() {
    let meshes = 0,
      instances = 0;
    this.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) instances += o.count;
      else if (o instanceof T.Mesh) meshes++;
    });
    const meta = this.context.meta;
    return {
      venue: meta.venueName,
      layout: meta.layout,
      theme: meta.theme,
      night: meta.night,
      dayNight: meta.dayNight,
      gantries: meta.dressing.gantries.length,
      meshes,
      instances,
      detailCells: this.context.cells.length,
      visibleDetailCells: this.context.cells.filter((c) => c.object.visible).length,
      tunnels: meta.dressing.tunnels.length,
      bridges: meta.dressing.crossings.length,
      finalArtApproved: false,
    };
  }
}
const kits = new WeakMap<Track, VenueKit>();
/** The kit for a catalogue track (cached per Track); null for Aurel/Vellamar. */
export function venueKitFor(track: Track): VenueKit | null {
  if (!track.circuit.catalogue) return null;
  let kit = kits.get(track);
  if (!kit) kits.set(track, (kit = new VenueKit(track)));
  return kit;
}
