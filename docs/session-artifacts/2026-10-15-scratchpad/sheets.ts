import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src/simulation/vehicles.ts';
import { bodySheetFor } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src/rendering/vehicle-bodies/frame.ts';
const r = (x: number) => x.toFixed(2);
for (const v of Object.values(VEHICLES)) {
  const s = bodySheetFor(v);
  if (!s) continue;
  const f = bodyFrame(v);
  const base = `${v.id.padEnd(6)} ${v.classId.padEnd(18)} wb ${r(f.wheelbase)} fa ${r(f.frontAxle)} ra ${r(f.rearAxle)} ground ${r(f.ground)} he ${v.halfExtents.map(r).join(',')}`;
  if (s.kind === 'closed')
    console.log(
      base,
      `${s.style}${s.open ? '/open' : ''} floor ${s.floor} cowl ${s.cowl} belt ${s.belt} roof ${s.roof} deck ${s.deck} bonnet ${s.bonnet} cabin ${s.cabin.join(',')} rw ${s.roofWidth} w ${s.width} ovh ${s.overhang.join(',')}`,
    );
  else if (s.kind === 'open-wheel')
    console.log(base, `${s.kind} ${s.era} tub ${s.tub.join(',')} cockpit ${s.cockpit} halo ${s.halo}`);
  else if (s.kind === 'buggy') console.log(base, `buggy roof ${s.roof} cockpit ${s.cockpit}`);
  else console.log(base, `kart ${s.nose ?? ''}`);
}
