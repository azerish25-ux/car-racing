p = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/ui/interface.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


rep("""/** Keep useful slider increments without rounding a valid researched/imported setup. */
export function setupControlStep(key: keyof Setup, value: number): number | 'any' {
  const [min, max] = SETUP_LIMITS[key];
  const preferred = max > 1000 ? 500 : max > 100 ? 1 : max <= 0.01 ? 0.0005 : 0.001;
  const steps = (value - min) / preferred;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? preferred : 'any';
}""", """/** Keep useful slider increments without rounding a valid researched/imported setup. */
export function setupControlStep(key: keyof Setup, value: number): number | 'any' {
  return setupStep(key, value, SETUP_LIMITS[key]);
}""")
rep("""import { DEFAULT_VEHICLE_ID, VEHICLES } from '../simulation/vehicles.ts';""",
    """import {
  DEFAULT_VEHICLE_ID,
  VEHICLES,
  vehicleDefinition,
  type VehicleDefinition,
} from '../simulation/vehicles.ts';
import { setupRows, setupStep } from './setup-page.ts';""")
rep("""  settings(settings: Settings) {
    const descriptions: Record<keyof Setup, string> = {
      frontWing: 'Front wing',
      rearWing: 'Rear wing',
      brakeBias: 'Front brake bias',
      diffPower: 'Differential · power',
      diffCoast: 'Differential · coast',
      frontSpring: 'Front spring · N/m',
      rearSpring: 'Rear spring · N/m',
      frontARB: 'Front anti-roll · N/m',
      rearARB: 'Rear anti-roll · N/m',
      frontRide: 'Front ride height · m',
      rearRide: 'Rear ride height · m',
      frontPressure: 'Front pressure · kPa',
      rearPressure: 'Rear pressure · kPa',
      frontCamber: 'Front camber · rad',
      rearCamber: 'Rear camber · rad',
      frontToe: 'Front toe · rad',
      rearToe: 'Rear toe · rad',
    };
    const setupRows = (Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
      .map((key) => {
        const [min, max] = SETUP_LIMITS[key],
          step = setupControlStep(key, settings.setup[key]);
        return `<label class="range-row">${descriptions[key]}<output>${settings.setup[key]}</output><input name="${key}" data-setup type="range" min="${min}" max="${max}" step="${step}" value="${settings.setup[key]}"></label>`;
      })
      .join('');""", """  /** The machine the MACHINE select would put the player on (its first entry). */
  selectedVehicle(): VehicleDefinition {
    const select = document.getElementById('vehicle') as HTMLSelectElement | null;
    if (!select) return vehicleDefinition(DEFAULT_VEHICLE_ID);
    return vehicleDefinition(machineOptions({ ...DEFAULT_OPTIONS }, select.value).vehicles?.[0]);
  }
  /** Garage & Settings. The vehicle setup section lists only the parameters
   * `vehicle` exposes (a motorcycle's preload, damping, steering damper,
   * gearing and maps; a car's aero and chassis), at the values its session
   * uses; the other machines' values in the shared setup are kept. */
  settings(settings: Settings, vehicle: VehicleDefinition = this.selectedVehicle()) {
    const rows = setupRows(vehicle, settings.setup);
    const setupRowsHtml = rows
      .map(
        (row) =>
          `<label class="range-row">${row.label}<output>${row.value}</output><input name="${row.key}" data-setup type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${row.value}"></label>`,
      )
      .join('');""")
rep("""<section><h3>Vehicle setup</h3><p class="small-note">Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.</p>${setupRows}""",
    """<section><h3>Vehicle setup</h3><p class="small-note" id="setupMachine" data-vehicle="${escapeHtml(vehicle.id)}">${escapeHtml(vehicle.name)} · ${rows.length} parameter${rows.length === 1 ? '' : 's'} this machine exposes. Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.</p>${setupRowsHtml}""")
rep("""      for (const key of Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
        next.setup[key] = Number(value(key));""", """      // Only the machine's own parameters are on the page, shown at the values
      // its session uses; a row the player moved is saved, the rest of the
      // shared setup (other machines' baselines included) is kept as it was.
      for (const row of rows) {
        const chosen = Number(value(row.key));
        if (chosen !== row.value) next.setup[row.key] = chosen;
      }""")
open(p, 'w').write(s)
print('ok')
