const root = '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src';
const { DEFAULT_OPTIONS } = await import(`${root}/simulation/config.ts`);
const { Simulation } = await import(`${root}/simulation/world.ts`);
const { contentHash, vehicleHash } = await import(`${root}/core/session-identity.ts`);
const { FORMULA_APX01, TOURING_TC1 } = await import(`${root}/simulation/vehicles.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  opponents: 3,
  vehicles: ['apx01', 'tc1', 'apx01', 'tc1'],
  ruleset: 'open-exhibition',
});
sim.autoPlayer = true;
for (let i = 0; i < 120 * 40; i++) sim.step(1 / 120);
const frame = sim.makeFrame();
sim.writeFrame(frame);
console.log('frame', contentHash(Array.from(frame).join(',')));
console.log('hashes', vehicleHash(FORMULA_APX01), vehicleHash(TOURING_TC1));
