import { it } from 'vitest';
import { liveRegistry, disciplineStatus, vehicleDiscipline, DISCIPLINE_IDS, snapshotChannels } from '../../../../../home/user/Experiment-3/.claude/worktrees/wf_79603d95-dab-1/src/career/registry.ts';
import { disciplineTiers, tierVehicles, loanerVehicle, vehiclePrice } from '../../../../../home/user/Experiment-3/.claude/worktrees/wf_79603d95-dab-1/src/career/ladder.ts';
it('dump', () => {
  const r = liveRegistry();
  for (const v of r.vehicles) console.log('V', v.id, v.classId, v.dynamicsKind, (v as any).family, vehicleDiscipline(v), vehiclePrice(r, v));
  for (const x of r.rulesets) console.log('R', x.id, x.sessions.join(','), x.allowedClasses.join(','));
  for (const v of r.venues) console.log('C', v.id, v.surface, v.venueKind, JSON.stringify(v.catalogue ?? null)?.slice(0,120), v.bikeSafe, v.jumps?.length);
  for (const d of DISCIPLINE_IDS) { const s = disciplineStatus(r, d); console.log('D', d, s.state, s.reasons.join(' | '), s.venues.length, loanerVehicle(r, d)?.id); for (const t of disciplineTiers(r, d)) console.log('  T', t.id, tierVehicles(r, t).map(v=>v.id).join(',')); }
  console.log('CH', snapshotChannels().join(','));
});
