import { expect, it } from 'vitest';
import {
  classifyDelivery,
  transportFailure,
  type DeliveryRun,
} from '../scripts/delivery-status.ts';
const sha = 'a'.repeat(40);
function run(overrides: Partial<DeliveryRun> = {}): DeliveryRun {
  return {
    id: 1,
    path: '.github/workflows/ci.yml',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-16T00:00:00Z',
    ...overrides,
  };
}
it('a failed browser pipeline does not become a failed Git push', () => {
  expect(classifyDelivery('at-main-head', sha, [run({ conclusion: 'failure' })], [])).toMatchObject(
    {
      source: 'at-main-head',
      validation: 'failed',
      publication: 'blocked-by-validation',
    },
  );
});
it('does not accept another commit or an unrelated green workflow as validation', () => {
  expect(
    classifyDelivery(
      'at-main-head',
      sha,
      [run({ head_sha: 'b'.repeat(40) }), run({ path: '.github/workflows/reference-pack.yml' })],
      [],
    ).validation,
  ).toBe('not-triggered');
});
it('preserves pending and untriggered states rather than treating them as success', () => {
  expect(classifyDelivery('at-main-head', sha, [], []).validation).toBe('not-triggered');
  expect(
    classifyDelivery('at-main-head', sha, [run({ status: 'in_progress', conclusion: null })], [])
      .validation,
  ).toBe('running');
});
it('uses the latest exact-commit validation rather than cherry-picking an older green run', () => {
  expect(
    classifyDelivery(
      'included-in-newer-main',
      sha,
      [run(), run({ id: 2, created_at: '2026-10-16T01:00:00Z', conclusion: 'failure' })],
      [],
    ).validation,
  ).toBe('failed');
});
it('expired, absent and uninspected release artifacts do not prove publication', () => {
  for (const artifacts of [
    [],
    [{ name: 'apex-formula-release', expired: true }],
    [{ name: 'apex-formula-web', expired: false }],
  ])
    expect(classifyDelivery('at-main-head', sha, [run()], artifacts).publication).toBe(
      'no-current-release-artifact',
    );
  expect(classifyDelivery('at-main-head', sha, [run()], null).publication).toBe('not-inspected');
});
it('a gated release artifact does not prove the CDN is live', () => {
  expect(
    classifyDelivery(
      'at-main-head',
      sha,
      [run()],
      [{ name: 'apex-formula-release', expired: false }],
    ),
  ).toMatchObject({
    validation: 'passed',
    publication: 'release-artifact-present',
    liveDeployment: 'not-verified',
  });
});
it('classifies transport failures without leaking credential-bearing messages', () => {
  const cause = { code: 'ENOTFOUND', message: 'https://user:DO_NOT_PRINT@github.com' };
  const explanation = transportFailure(new Error('fetch failed', { cause }));
  expect(explanation).toContain('DNS resolution failed');
  expect(explanation).not.toContain('DO_NOT_PRINT');
  expect(transportFailure(new Error('HTTP 403 token=DO_NOT_PRINT'))).not.toContain('DO_NOT_PRINT');
  expect(transportFailure(new Error('ECONNRESET'))).toContain('Read the remote branch head');
});
