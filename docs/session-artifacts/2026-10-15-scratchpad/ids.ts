const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src';
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
console.log(Object.values(VEHICLES).filter((d: any) => bodySheetFor(d)).map((d: any) => d.id).join(' '));
