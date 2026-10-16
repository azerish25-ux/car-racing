import { expect, it } from 'vitest';
import { captureGlErrors, type GlErrorObservation } from '../e2e/fixtures/gl-error-census.ts';

it('retains every pending error and stage, including errors from earlier draws', () => {
  const errors = [1281, 1282, 1285, 0];
  const observations: GlErrorObservation[] = [];
  captureGlErrors(
    { getError: () => errors.shift()!, NO_ERROR: 0 as const, CONTEXT_LOST_WEBGL: 37442 },
    'complete-cockpit-frame',
    observations,
  );
  expect(observations).toEqual(
    [1281, 1282, 1285].map((code) => ({ stage: 'complete-cockpit-frame', code })),
  );
  expect(errors).toEqual([]);
});
it('a clean phase costs one diagnostic read, independently of its draw count', () => {
  let reads = 0;
  const observations: GlErrorObservation[] = [];
  const gl = {
    getError: () => {
      reads++;
      return 0;
    },
    NO_ERROR: 0 as const,
    CONTEXT_LOST_WEBGL: 37442 as const,
  };
  captureGlErrors(gl, 'construction', observations);
  captureGlErrors(gl, 'complete-cockpit-frame', observations);
  expect(reads).toBe(2);
  expect(observations).toEqual([]);
});
it('context loss remains explicit and a broken driver cannot make diagnostics loop forever', () => {
  const observations: GlErrorObservation[] = [];
  captureGlErrors(
    { getError: () => 37442, NO_ERROR: 0 as const, CONTEXT_LOST_WEBGL: 37442 },
    'capture',
    observations,
  );
  expect(observations).toEqual([{ stage: 'capture', code: 37442 }]);
  expect(() =>
    captureGlErrors(
      { getError: () => 1282, NO_ERROR: 0 as const, CONTEXT_LOST_WEBGL: 37442 },
      'broken',
      [],
    ),
  ).toThrow('WebGL error state did not drain');
});
