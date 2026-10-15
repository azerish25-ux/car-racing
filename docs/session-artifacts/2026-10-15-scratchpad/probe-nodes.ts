const W = process.argv[2] ?? '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const world = openWorld();
const net = world.network;
for (const n of net.nodes) if (n.edges.length) console.log(n.index, n.x.toFixed(1), n.z.toFixed(1), n.edges.map((e: number) => net.edges[e].id).join(','));
console.log(JSON.stringify(net.stats()));
