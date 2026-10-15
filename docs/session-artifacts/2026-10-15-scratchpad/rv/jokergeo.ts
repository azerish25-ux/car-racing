const W = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src';
const { circuitDefinition } = await import(W + '/simulation/circuits.ts');
const { offroadCourse, } = await import(W + '/simulation/offroad/venues.ts');
const { relief } = await import(W + '/simulation/offroad/course.ts');
const { Track, trackPoint } = await import(W + '/simulation/track.ts');
const { mod } = await import(W + '/core/math.ts');
const def = circuitDefinition('kestrel-rx');
const track = new Track('clear', false, undefined, def);
const course = offroadCourse(def);
const j = course.spec.joker, L = track.length;
const line = mod(j.from + mod(j.to - j.from, L) / 2, L);
const p = track.at(line, trackPoint());
console.log('line s', line.toFixed(1), 'L', L.toFixed(1), 'width', p.width, 'curv', p.curvature.toFixed(4), 'jokerCentre', course.jokerCentre(line));
for (const lat of [-7, -7.8, -8.0, -8.4, -8.5, -9, -13]) {
  const r = course.relief(line, lat, p, relief());
  console.log('lat', lat, 'onJoker', course.onJoker(line, lat), 'legalWidth', course.legalWidth(p.width, line, lat).toFixed(2), 'islandH', r.h.toFixed(3), 'soil', course.soilAt(line, lat, p.width).soil);
}
// Joker centre along its span
for (let d = 0; d <= mod(j.to - j.from, L); d += 10) console.log('into', d, 'centre', course.jokerCentre(j.from + d)?.toFixed(2));
