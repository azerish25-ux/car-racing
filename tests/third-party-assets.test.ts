import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jpegImageSpans } from '../scripts/assets/hdri.ts';
import {
  auditShipment,
  forbiddenNameIn,
  readRegister,
  sha256,
  validateRegister,
} from '../scripts/assets/register.ts';
import { brandWordIn } from '../scripts/assets/brands.ts';
import { ALLOWED_LICENCES, LICENCE_INFO } from '../src/rendering/assets/licences.ts';
import { creditLines, thirdPartyManifest } from '../src/rendering/assets/third-party.ts';
import { creditsHtml } from '../src/ui/credits.ts';

const ROOT = process.cwd();
const manifest = thirdPartyManifest;
const register = readRegister(ROOT);
const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('third-party asset register and shipment', () => {
  it('the source register follows the licence, pinning and naming rules', () => {
    expect(validateRegister(register)).toEqual([]);
  });

  it('every shipped file is in the manifest with matching size and SHA-256, within budget', () => {
    const audit = auditShipment(ROOT, manifest);
    expect(audit.errors).toEqual([]);
    expect(audit.totalBytes).toBeLessThanOrEqual(150 * 1024 * 1024);
    expect(manifest.budgetBytes).toBe(150 * 1024 * 1024);
    console.info(
      `third-party assets: ${manifest.assets.length} entries, ${(audit.totalBytes / 1048576).toFixed(2)} MB of ${(manifest.budgetBytes / 1048576).toFixed(0)} MB`,
    );
  });

  it('the manifest is the build of the current register', () => {
    expect(manifest.assets.map((a) => a.id)).toEqual(register.sources.map((s) => s.id));
    for (const source of register.sources) {
      const asset = manifest.assets.find((a) => a.id === source.id)!;
      expect(asset.kind).toBe(source.kind);
      expect(asset.licence).toBe(source.licence);
      expect(asset.author).toBe(source.author);
      expect(asset.attribution).toBe(source.attribution);
      expect(asset.sourceUrl).toBe(source.files[0].url);
    }
  });

  it('ships only allowed licences; CC-BY and MIT entries carry an attribution naming the author', () => {
    for (const asset of manifest.assets) {
      expect(ALLOWED_LICENCES).toContain(asset.licence);
      if (LICENCE_INFO[asset.licence].attribution) {
        expect(asset.attribution.length).toBeGreaterThan(asset.author.length);
        expect(asset.attribution).toContain(asset.author);
      }
    }
  });

  it('carries no brand or protected real-world names', () => {
    expect(brandWordIn('A Vespa by the cafe')).toBe('vespa');
    expect(brandWordIn('Versveldpas')).toBeNull();
    for (const asset of manifest.assets)
      for (const text of [
        asset.id,
        asset.title,
        asset.author,
        asset.attribution,
        ...asset.files.map((f) => f.path),
      ])
        expect(forbiddenNameIn(text), text).toBeNull();
  });

  it('serves the KTX2 transcoder exactly as three ships it', () => {
    for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm'])
      expect(sha256(readFileSync(join(ROOT, 'public/assets/basis', name)))).toBe(
        sha256(readFileSync(join(ROOT, 'node_modules/three/examples/jsm/libs/basis', name))),
      );
  });

  it('every sky is an Ultra HDR JPEG pair (4k and 2k) with a half-size gain map at the recorded offset', () => {
    const skies = manifest.assets.filter((a) => a.kind === 'hdri');
    expect(skies.length).toBeGreaterThanOrEqual(8);
    for (const sky of skies) {
      expect(sky.files.map((f) => f.role).sort()).toEqual(['2k', '4k']);
      for (const file of sky.files) {
        expect(file.format).toBe('ultrahdr');
        expect(file.width).toBe(2 * file.height!);
        expect(file.gainMap!.width * 2).toBe(file.width);
        expect(file.gainMap!.height * 2).toBe(file.height);
        expect(file.gainMap!.gainMax).toBeCloseTo(Math.log2(1 + sky.hdri!.clamp), 6);
        const spans = jpegImageSpans(new Uint8Array(readFileSync(join(ROOT, 'public', file.path))));
        expect(spans.length).toBe(2);
        expect(spans[1].start).toBe(file.gainMap!.offset);
        expect(spans[1].end).toBe(file.bytes);
      }
      const info = sky.hdri!;
      // Shipped radiance is normalised to a unit dome.
      expect(luminance(info.domeMean)).toBeCloseTo(1, 2);
      expect(Math.abs(info.sunAzimuth)).toBeLessThanOrEqual(180);
      expect(Math.abs(info.sunElevation)).toBeLessThanOrEqual(90);
      expect(info.rmsStops).toBeLessThan(0.15);
    }
  });

  it('texture sets ship KTX2 (when built with toktx) and WebP for colour, normal and ORM', () => {
    for (const set of manifest.assets.filter((a) => a.kind === 'texture')) {
      const roles = new Set(set.files.map((f) => f.role));
      expect([...roles].sort()).toEqual(['color', 'normal', 'orm']);
      for (const role of roles)
        expect(set.files.some((f) => f.role === role && f.format === 'webp')).toBe(true);
      expect(set.files.find((f) => f.role === 'color')!.colorSpace).toBe('srgb');
      expect(set.texture!.normalConvention).toBe('gl');
    }
  });

  it('the credits view lists every shipped asset with its attribution and licence', () => {
    const lines = creditLines();
    expect(lines.map((l) => l.id).sort()).toEqual(manifest.assets.map((a) => a.id).sort());
    const html = creditsHtml(lines);
    for (const line of lines) {
      expect(html).toContain(line.title.replace(/"/g, '&#34;'));
      expect(html).toContain(line.attribution.replace(/"/g, '&#34;'));
      expect(html).toContain(line.licenceName);
    }
    expect(html).toContain('data-action="modalClose"');
    expect(html).toContain('role="region"');
    const credits = readFileSync(join(ROOT, 'public/assets/third-party/CREDITS.txt'), 'utf8');
    for (const asset of manifest.assets) expect(credits).toContain(asset.attribution);
  });
});
