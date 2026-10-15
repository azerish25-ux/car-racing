import { CIRCUITS } from '../src/simulation/circuits.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
const lo = Number(process.argv[2] ?? 540),
  hi = Number(process.argv[3] ?? 620);
for (const id of ['valley-ridge-mx', 'arena-nord-sx']) {
  const c = offroadCourse(CIRCUITS[id as 'valley-ridge-mx'])!;
  console.log(id, 'length', (c as any).length, 'rough', JSON.stringify(c.rough));
  for (const j of c.jumps)
    console.log(
      j.name, j.kind, 'start', j.start.toFixed(1), 'lip', j.takeoff.toFixed(1), 'h', j.lipHeight,
      'land', j.landing.toFixed(1), 'll', j.landingLength.toFixed(1), 'lh', j.landingHeight.toFixed(2),
      'end', j.end.toFixed(1), 'rollEnd', j.rollEnd.toFixed(1), j.forgiving,
    );
  const knots = (c as any).profile?.knots;
  if (knots)
    console.log(
      knots
        .filter((k: any) => k.s > lo && k.s < hi)
        .map((k: any) => `${k.s.toFixed(1)}:${k.h.toFixed(2)}:${k.r.toFixed(2)}`)
        .join(' '),
    );
}
