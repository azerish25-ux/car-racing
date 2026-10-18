/// <reference lib="webworker" />
import { regionStructures, StructureGrid } from '../simulation/open-world/placement.ts';
import { openWorld } from '../simulation/open-world/world.ts';
import { buildTileData } from '../rendering/open-world/tile-data.ts';
import type { FromTileWorker, ToTileWorker, TileRequest } from './open-world-protocol.ts';

/** Terrain streaming worker: builds render tiles (carved heights, normals,
 * layer weights, trees) off the main thread, newest-first, so a fast camera
 * never waits behind tiles it has already left. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const world = openWorld();
const structures = new StructureGrid(regionStructures(world));
const queue: TileRequest[] = [];
let scheduled = false;
function pump() {
  scheduled = false;
  const start = performance.now();
  // A few tiles per turn so cancellations arrive between them.
  while (queue.length && performance.now() - start < 12) {
    const req = queue.pop()!;
    try {
      const data = buildTileData(world, structures, req);
      const message: FromTileWorker = data;
      scope.postMessage(message, [
        data.heights.buffer,
        data.normals.buffer,
        data.splat.buffer,
        data.shade.buffer,
        data.trees.buffer,
        data.cover.buffer,
      ]);
    } catch (error) {
      scope.postMessage({ type: 'error', id: req.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (queue.length && !scheduled) {
    scheduled = true;
    setTimeout(pump, 0);
  }
}
scope.onmessage = (event: MessageEvent<ToTileWorker>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    const i = queue.findIndex((r) => r.id === msg.id);
    if (i >= 0) queue.splice(i, 1);
    return;
  }
  queue.push(msg);
  if (!scheduled) {
    scheduled = true;
    setTimeout(pump, 0);
  }
};
