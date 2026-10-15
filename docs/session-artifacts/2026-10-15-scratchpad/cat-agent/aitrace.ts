const root = '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src';
const { DEFAULT_OPTIONS } = await import(`${root}/simulation/config.ts`);
const { Simulation } = await import(`${root}/simulation/world.ts`);
const id = process.argv[2] ?? 'gt8f';
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 100);
const every = Number(process.argv[5] ?? 0.5);
const circuit = process.argv[6] ?? 'aurel';
const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'practice', opponents: 0, vehicles: [id] });
if (process.argv[7]) {
  const { Vehicle } = await import(`${root}/simulation/vehicle.ts`);
  const { AIDriver } = await import(`${root}/simulation/ai.ts`);
  const patch = JSON.parse(process.argv[7]);
  const base = sim.cars[0].definition;
  const def = { ...base, ...patch, setupDefaults: { ...base.setupDefaults, ...patch.setupDefaults }, ai: { ...base.ai, ...patch.ai }, spec: { ...base.spec, ...patch.spec } };
  const old = sim.cars[0];
  const car = new Vehicle(0, DEFAULT_OPTIONS.compound, DEFAULT_OPTIONS.setup, DEFAULT_OPTIONS.assist, def);
  car.place(sim.track, old.s, old.lateral);
  sim.cars[0] = car;
  (sim as unknown as { ai: unknown[] }).ai[0] = new AIDriver(car, 0.92, DEFAULT_OPTIONS.seed);
}
sim.autoPlayer = true;
let next = from;
for (let i = 0; i < 120 * to; i++) {
  sim.step(1 / 120);
  const t = i / 120;
  if (t < next) continue;
  next += every;
  const c = sim.cars[0];
  const yaw = c.body.omega.y;
  console.log(
    t.toFixed(1),
    's',
    c.s.toFixed(0),
    'v',
    (c.speed * 3.6).toFixed(0),
    'lat',
    c.lateral.toFixed(1),
    'in',
    `st ${c.input.steer.toFixed(2)} th ${c.input.throttle.toFixed(2)} br ${c.input.brake.toFixed(2)}`,
    'g',
    c.gear,
    'yaw',
    yaw.toFixed(2),
    'aiT',
    (c.aiTarget * 3.6).toFixed(0),
    'slipA',
    c.tires.map((x) => x.angle.toFixed(2)).join(','),
    'slip',
    c.tires.map((x) => x.slip.toFixed(2)).join(','),
    'surf',
    c.contacts.map((x) => x.surface).join(''),
  );
}
