import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import review from '../docs/production/motocross-reference-review-20261017.json';

describe('motocross image-by-image implementation ledger', () => {
  it('retains all 100 numbered, distinct, traceable images without substituting claims of parity', () => {
    expect(review.references).toHaveLength(100);
    expect(review.references.map((r) => r.number)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect(new Set(review.references.map((r) => r.sha256)).size).toBe(100);
    for (const entry of review.references) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.review.observation.length).toBeGreaterThan(25);
      expect(entry.decision.length).toBeGreaterThan(25);
    }
    expect(review.limits.join(' ')).toContain('not a claim');
  });
  it('links only existing production code and tests, and distinguishes context-only references', () => {
    for (const feature of Object.values(review.newFeatures))
      for (const path of [...feature.files, ...feature.tests])
        expect(existsSync(path), path).toBe(true);
    for (const entry of review.references) {
      for (const path of entry.retainedBaselineFiles) expect(existsSync(path), path).toBe(true);
      for (const key of entry.newFeatureKeys) expect(key in review.newFeatures).toBe(true);
      if (entry.newFeatureKeys.length === 0)
        expect(entry.status).toBe('context-only-no-new-pictured-mode-or-map');
    }
  });
});
