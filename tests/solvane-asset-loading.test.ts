import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { SolvaneDetails, SOLVANE_DETAILS } from '../src/rendering/open-world/solvane-details.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';

const world = openWorld();
const structures = regionStructures(world);

it('fetches and parses the native kit on the application origin, not the host models', async () => {
  const data = new Uint8Array(await readFile('public/models/solvane/detail-kit.glb'));
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const page = 'https://example.invalid/e2e/fixtures/horizon-session.html';
    const requested = new URL(String(input), page);
    // Exercise the actual Vitest/Vite development base ('/'), not a mocked URL
    // builder. assetUrl('/models/...') produced a protocol-relative hostname.
    expect(requested.origin).toBe(new URL(page).origin);
    expect(requested.pathname).toBe('/models/solvane/detail-kit.glb');
    return new Response(data, {
      headers: {
        'content-type': 'model/gltf-binary',
        'content-length': String(SOLVANE_DETAILS.bytes),
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  let kit: SolvaneDetails | undefined;
  try {
    kit = await SolvaneDetails.load(world, structures, () => false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(kit.stats.loaded).toBe(true);
    expect(kit.stats.boats).toBe(3);
    expect(kit.stats.frontage).toBeGreaterThan(400);
  } finally {
    kit?.dispose();
    vi.unstubAllGlobals();
  }
});

it('does not fetch an already-cancelled detail load', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  try {
    await expect(SolvaneDetails.load(world, structures, () => true)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
