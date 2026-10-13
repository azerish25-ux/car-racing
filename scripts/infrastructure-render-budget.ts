import { DRAW_PHASES, type DrawBreakdown } from '../src/rendering/draw-ledger.ts';
import baseline from '../docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json' with { type: 'json' };

export interface InfrastructureRenderSample {
  name: string;
  calls: number;
  triangles: number;
}

/** The direct scene survey and the cockpit compositor are different workloads.
 * Keep the original 1,800-call direct-scene ceiling. For the cockpit, account for
 * every recorded pass and cap the entire frame at 2% above the pinned, unchanged
 * baseline. These are submitted-work limits, not physical-device FPS claims. */
export function requireInfrastructureRenderBudget(
  lighting: 'day' | 'sunset' | 'night',
  sample: InfrastructureRenderSample,
  breakdown?: DrawBreakdown,
) {
  const integer = (value: number, label: string) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${sample.name}: invalid ${label}`);
  };
  integer(sample.calls, 'calls');
  integer(sample.triangles, 'triangles');
  if (sample.calls === 0 || sample.triangles === 0)
    throw new Error(`${sample.name}: empty rendering workload`);
  if (sample.name !== 'normal-cockpit') {
    if (sample.calls >= 1800) throw new Error(`${sample.name}: direct-scene draw budget exceeded`);
    return;
  }
  if (!breakdown) throw new Error('Cockpit draw-phase accounting is required');
  let calls = 0;
  let triangles = 0;
  for (const phase of DRAW_PHASES) {
    const row = breakdown[phase];
    if (!row) throw new Error(`Missing cockpit phase: ${phase}`);
    integer(row.calls, `${phase} calls`);
    integer(row.triangles, `${phase} triangles`);
    calls += row.calls;
    triangles += row.triangles;
  }
  if (calls !== sample.calls || triangles !== sample.triangles)
    throw new Error('Cockpit phase totals do not match the complete frame');
  if (breakdown.composer.calls >= 1800) throw new Error('Cockpit composer draw budget exceeded');
  if (!breakdown.composer.calls || !breakdown.mirrors.calls || !breakdown.shadow.calls)
    throw new Error('Required cockpit compositor, mirrors or shadows are missing');
  const reference = baseline.lighting[lighting];
  if (!reference) throw new Error(`Unknown baseline lighting: ${lighting}`);
  // Integer arithmetic makes the inclusive 2% boundary explicit and testable.
  if (sample.calls * 100 > reference.calls * 102)
    throw new Error(`Complete cockpit draw calls exceed the matched baseline by more than 2% (${lighting}: ${sample.calls} versus ${reference.calls}; limit ${Math.floor(reference.calls * 1.02)})`);
  if (sample.triangles * 100 > reference.triangles * 102)
    throw new Error(`Complete cockpit triangles exceed the matched baseline by more than 2% (${lighting}: ${sample.triangles} versus ${reference.triangles}; limit ${Math.floor(reference.triangles * 1.02)})`);
}
