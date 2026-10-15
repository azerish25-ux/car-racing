import sys
p = sys.argv[1]
s = open(p).read()


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:90], s.count(old))
    s = s.replace(old, new)


rep("""import { FestivalRenderer } from '../rendering/open-world/festival-renderer.ts';""", """import { FestivalRenderer } from '../rendering/open-world/festival-renderer.ts';
import { FestivalRiders } from '../rendering/festival-riders.ts';
import { TrafficCars } from '../rendering/traffic-cars.ts';""")
rep("""import { FestivalControls } from './festival-controls.ts';""", """import { FestivalControls } from './festival-controls.ts';
import { FESTIVAL_SAVE_KEY, validateFestivalSave, type FestivalSave } from './festival-save.ts';""")
start = s.index("export interface FestivalSave {")
end = s.index("export interface FestivalStartOptions {")
s = s[:start] + s[end:]
rep("""export interface FestivalStartOptions {
  vehicle?: string;
  weather?: WeatherPreset;
  assist?: Assist;
  seed?: number;
}
export const FESTIVAL_SAVE_KEY = 'festival:v1';
export function validateFestivalSave(value: unknown): FestivalSave | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<FestivalSave>;
  if (v.version !== 1 || !Array.isArray(v.discovered) || typeof v.vehicle !== 'string') return null;
  return {
    version: 1,
    discovered: v.discovered.filter((d): d is string => typeof d === 'string').slice(0, 256),
    best: v.best && typeof v.best === 'object' ? v.best : {},
    vehicle: v.vehicle,
  };
}
""", """export interface FestivalStartOptions {
  vehicle?: string;
  weather?: WeatherPreset;
  assist?: Assist;
  seed?: number;
  /** Session identity for result run ids (the career pays each run once). */
  session?: string;
  /** Fast-travel to this discovered event once the region has streamed in
   * (a career start). */
  travel?: string;
}
export { FESTIVAL_SAVE_KEY, validateFestivalSave, type FestivalSave };
""")
rep("""  private status: FestivalStatus | null = null;""", """  private status: FestivalStatus | null = null;
  /** Ambient traffic blocks paired with `previous`/`current`. */
  private trafficPrevious: Float32Array | null = null;
  private trafficCurrent: Float32Array | null = null;
  private traffic: TrafficCars | null = null;
  private riders: FestivalRiders | null = null;""")
rep("""    this.save = save ?? { version: 1, discovered: [], best: {}, vehicle: festivalDefaultVehicle() };""", """    this.save = save ?? { version: 1, discovered: [], best: {}, vehicle: festivalDefaultVehicle(), traffic: true };""")
rep("""    for (const id of this.save.discovered) renderer.discovered.add(id);""", """    for (const id of this.save.discovered) renderer.discovered.add(id);
    // Ambient traffic (instanced) and motorcycles (the bike presentation)
    // share the festival scene; both are posed before each draw.
    this.traffic = new TrafficCars();
    this.riders = new FestivalRiders();
    renderer.scene.add(this.traffic.root, this.riders.root);""")
rep("""    // A road machine chosen in the MACHINE menu wins over the festival save;
    // the Formula default (and bikes) fall back to the saved festival car.""", """    // A road machine chosen in the MACHINE menu (a car or a road motorcycle)
    // wins over the festival save; the Formula default falls back to the
    // saved festival machine.""")
rep("""      autopilot: (on) => {
        this.command({ type: 'autopilot', value: on });
        this.setPaused(false);
      },
    });""", """      autopilot: (on) => {
        this.command({ type: 'autopilot', value: on });
        this.setPaused(false);
      },
      traffic: (on) => {
        this.save.traffic = on;
        this.command({ type: 'traffic', value: on });
        void this.persist();
        this.openMenu();
      },
    });""")
rep("""          autopilot: status?.autopilot ?? false,
          inEvent: !!status?.event,""", """          autopilot: status?.autopilot ?? false,
          inEvent: !!status?.event,
          traffic: status?.traffic.enabled ?? this.save.traffic !== false,""")
rep("""        seed: options.seed ?? 73021,
        discovered: this.save.discovered,
      },
    });""", """        seed: options.seed ?? 73021,
        discovered: this.save.discovered,
        session: options.session,
        traffic: this.save.traffic !== false,
      },
    });""")
rep("""    await host.audio?.start().catch(() => undefined);
    host.loaded();
    this.post({ type: 'pause', value: false });
  }""", """    await host.audio?.start().catch(() => undefined);
    host.loaded();
    this.post({ type: 'pause', value: false });
    // A career start goes straight to its event (discovered: the card opens
    // on arrival, a skill challenge starts at its entry gate).
    if (options.travel && this.save.discovered.includes(options.travel)) await this.travel(options.travel);
  }""")
rep("""        this.previous = this.current ?? frame;
        this.current = frame;""", """        this.previous = this.current ?? frame;
        this.current = frame;
        this.trafficPrevious = this.trafficCurrent;
        this.trafficCurrent = msg.traffic ? new Float32Array(msg.traffic) : null;""")
rep("""    const span = Math.max(8, (b[H.TIME] - a[H.TIME]) * 1000),
      alpha = Math.min(1, Math.max(0, (performance.now() - this.receivedAt) / span));
    renderer.draw(a, b, alpha, Math.min(0.08, wall));""", """    const span = Math.max(8, (b[H.TIME] - a[H.TIME]) * 1000),
      alpha = Math.min(1, Math.max(0, (performance.now() - this.receivedAt) / span));
    // Posed before the draw, from the same interpolation as the cars.
    this.riders?.update(a, b, alpha, renderer.camera, this.host.quality);
    this.traffic?.update(this.trafficPrevious, this.trafficCurrent, alpha, renderer.night, b[H.TIME]);
    renderer.draw(a, b, alpha, Math.min(0.08, wall));""")
rep("""    this.renderer?.dispose();
    this.hud?.dispose();
    this.renderer = null;
    this.hud = null;""", """    this.traffic?.dispose();
    this.traffic = null;
    this.riders?.root.removeFromParent();
    this.riders = null;
    this.renderer?.dispose();
    this.hud?.dispose();
    this.renderer = null;
    this.hud = null;""")
open(p, 'w').write(s)
print('ok')
