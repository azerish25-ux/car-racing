/** MotoGP endurance brake temperature response. This is a bounded high-temp
 * fade term, not an invented cold-brake penalty at the start of a race.
 * Around 800 C the friction curve is stable; prolonged >850 C operation
 * degrades peak torque. Cooling naturally restores full available torque.
 * The input is the already-simulated, replay-deterministic disc temperature.
 */
export function gpBrakeEfficiency(temperatureC: number): number {
  if (!Number.isFinite(temperatureC)) return 1;
  const t = Math.min(1, Math.max(0, (temperatureC - 850) / 350));
  const smooth = t * t * (3 - 2 * t);
  return 1 - 0.22 * smooth;
}
