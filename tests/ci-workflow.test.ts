import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = (name: string) => {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start < 0) throw new Error(`Missing required CI job: ${name}`);
  return workflow.slice(start + header.length).split(/\n {2}[a-z][a-z-]*:\n/)[0];
};

describe('independent CI diagnostics with strict release gates', () => {
  it('builds separately while the unfiltered unit suite remains required', () => {
    const build = job('validate'),
      unit = job('unit-tests');
    expect(build).toContain('npm run lint && npm run validate:content && npm run build');
    expect(build).not.toMatch(/npm (?:test|run check)/);
    expect(unit).toMatch(/scripts\/source-stability\.ts -- npm test(?:\n|$)/);
    expect(unit).not.toMatch(/continue-on-error|--exclude|--testNamePattern|--passWithNoTests/);
    expect(build).not.toMatch(/needs:/);
    expect(unit).not.toMatch(/needs:/);
  });

  it('runs both browser gates on the exact build, independently of unit results', () => {
    for (const name of ['browser', 'wet-presentation']) {
      const browser = job(name);
      expect(browser).toContain('needs: validate');
      expect(browser).toContain('name: apex-formula-web');
      expect(browser).not.toContain('needs: unit-tests');
    }
  });

  it('cannot publish unless the unit suite and every other required job succeed', () => {
    const publish = job('publish');
    expect(publish).toContain(
      'needs: [validate, unit-tests, scenarios, browser, wet-presentation]',
    );
    expect(publish).toContain('success() &&');
    expect(publish.split('    steps:')[0]).not.toContain('continue-on-error');
  });
});
