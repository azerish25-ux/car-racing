import os
ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
p = ROOT + 'src/simulation/open-world/route-path.ts'
s = open(p).read()
a = s.index("/** Shortest legal path between two network positions")
b = s.index("/** Plan a route through ordered waypoints")
new = '''/** Shortest legal path between two network positions. Dijkstra over
 * directed edge states (no U-turn at a junction, only at a dead end), with
 * deterministic tie-breaks; `departDir` forces the direction of travel away
 * from `a` (no U-turn after a waypoint) unless only a U-turn reaches `b`. */
function shortest(network: RoadNetwork, a: Position, b: Position, departDir: 0 | 1 | -1) {
  const edges = network.edges,
    states = edges.length * 2,
    state = (edge: number, dir: 1 | -1) => edge * 2 + (dir > 0 ? 0 : 1),
    dist = new Float64Array(states).fill(Infinity),
    prev = new Int32Array(states).fill(-1),
    done = new Uint8Array(states);
  const ea = edges[a.edge],
    eb = edges[b.edge];
  const penalty = (dir: 1 | -1) => (departDir !== 0 && dir !== departDir ? U_TURN : 0);
  // A state's cost is the distance travelled to the END of that directed
  // edge. Starting states: the rest of a's edge in either direction.
  dist[state(a.edge, 1)] = ea.length - a.s + penalty(1);
  dist[state(a.edge, -1)] = a.s + penalty(-1);
  const options: { cost: number; legs: RouteLeg[] }[] = [];
  if (a.edge === b.edge) {
    const dir: 1 | -1 = b.s >= a.s ? 1 : -1;
    options.push({ cost: Math.abs(b.s - a.s) + penalty(dir), legs: [{ edge: a.edge, dir, from: a.s, to: b.s }] });
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < states; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    const edge = edges[u >> 1],
      dir: 1 | -1 = u & 1 ? -1 : 1,
      end = dir > 0 ? edge.to : edge.from,
      deadEnd = network.nodes[end].edges.length === 1;
    for (const next of network.leaving(end)) {
      // No U-turn back along the same edge except at a dead end (or on a
      // loop edge that leaves and returns to one node).
      if (next.edge === edge && next.dir === -dir && !deadEnd && edge.from !== edge.to) continue;
      const v = state(next.edge.index, next.dir),
        cost = dist[u] + next.edge.length;
      if (cost < dist[v] - 1e-9) {
        dist[v] = cost;
        prev[v] = u;
      }
    }
  }
  // Arrive on b's edge from either end: the cheapest state ending at the
  // node b's edge starts from in that direction (not b's own reverse).
  for (const dir of [1, -1] as const) {
    const startNode = dir > 0 ? eb.from : eb.to;
    let best = -1;
    for (let u = 0; u < states; u++) {
      if (dist[u] === Infinity) continue;
      const e = edges[u >> 1],
        d: 1 | -1 = u & 1 ? -1 : 1;
      if ((d > 0 ? e.to : e.from) !== startNode) continue;
      if (e === eb && d === -dir && network.nodes[startNode].edges.length > 1 && eb.from !== eb.to) continue;
      if (best < 0 || dist[u] < dist[best]) best = u;
    }
    if (best < 0) continue;
    const legs: RouteLeg[] = [];
    let u = best;
    while (u >= 0) {
      const e = edges[u >> 1],
        d: 1 | -1 = u & 1 ? -1 : 1;
      if (prev[u] < 0) legs.unshift({ edge: e.index, dir: d, from: a.s, to: d > 0 ? e.length : 0 });
      else legs.unshift({ edge: e.index, dir: d, from: d > 0 ? 0 : e.length, to: d > 0 ? e.length : 0 });
      u = prev[u];
    }
    legs.push({ edge: b.edge, dir, from: dir > 0 ? 0 : eb.length, to: b.s });
    options.push({ cost: dist[best] + (dir > 0 ? b.s : eb.length - b.s), legs });
  }
  options.sort((x, y) => x.cost - y.cost);
  if (!options.length) throw new Error('No route between waypoints');
  // Drop zero-length pieces (a waypoint exactly on a node).
  return options[0].legs.filter((l) => Math.abs(l.to - l.from) > 0.05);
}

'''
s = s[:a] + new + s[b:]
old = """      if (k === legs - 1 && this.closed) points.push({ x: this.x[0], y: this.y[0], z: this.z[0] });"""
assert old in s
s = s.replace(old, """      if (k === legs - 1 && this.closed) {
        const end = points[points.length - 1];
        if (Math.hypot(end.x - this.x[0], end.y - this.y[0], end.z - this.z[0]) > 0.05)
          points.push({ x: this.x[0], y: this.y[0], z: this.z[0] });
      }""")
open(p, 'w').write(s)

p = ROOT + 'src/simulation/open-world/region-data.ts'
s = open(p).read()
old = """        [900, -2600],
        [1700, -2600],
        [1700, -2200],
        [800, -2200],"""
assert old in s
s = s.replace(old, """        [1000, -2600],
        [1700, -2500],
        [1500, -2200],
        [800, -2300],""")
open(p, 'w').write(s)
print('patched')
