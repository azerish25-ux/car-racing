const W = process.argv[2];
const { LicenceAttempt, LICENCE_TESTS } = await import(`${W}/career/licences.ts`);
const course = { length: 4000, marker: 0, gate: 0, gateSpeed: 40, corner: 2000, window: 45, paceSpeed: 20, lineAt: () => 0, landingPitch: 0, cornerName: 'T8' };
const a = new LicenceAttempt(LICENCE_TESTS.cornering, course);
let out = null, t = 0;
// Driving from s=500 to s=2200 at 30 m/s. Track limits exceeded at s=600-700 (turn 2), lap invalid afterwards.
for (let s = 500; s <= 2200 && !out; s += 1) {
  t += 1 / 30;
  const lapValid = s < 600; // invalidated at turn 2, long before the scored corner
  out = a.observe({ t, s, laps: 0, speed: 30, lateral: 0.1, brake: 0, lapValid, lastLapValid: true, lastLap: 0, sideslip: 0, pitch: 0, airborne: false, lean: null });
}
console.log(out);
