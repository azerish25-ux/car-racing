const W = '/home/user/Experiment-3/.claude/worktrees/wf_79603d95-dab-1/src';
const { liveRegistry } = await import(`${W}/career/registry.ts`);
const { disciplineEvents, tierVehicles, disciplineTiers } = await import(`${W}/career/ladder.ts`);
const { newCareer } = await import(`${W}/career/save.ts`);
const { buyVehicle, setActive, startChampionship, settleRace } = await import(`${W}/career/economy.ts`);
const reg = liveRegistry();
const tiers = disciplineTiers(reg, 'circuit-cars');
for (const t of tiers) console.log(t.id, tierVehicles(reg, t).map((v: any) => v.id + ':' + v.classId).join(','));
