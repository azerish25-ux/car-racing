import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  CLOUD_SHADOW,
  CLOUD_SHADOW_ANCHOR,
  cloudShadowStrength,
  createCloudShadowUniforms,
  injectCloudShadow,
  setCloudShadow,
} from '../src/rendering/studio/cloud-shadow.ts';
import { SKY_CLOUDS, cloudLayer } from '../src/rendering/studio/sky-clouds.ts';
import { LocalAtmosphere } from '../src/rendering/local-atmosphere.ts';
import { Track } from '../src/simulation/track.ts';
import { SUN_OFFSET } from '../src/rendering/daylight.ts';

describe('cloud shadows from the sky field', () => {
  it('shadows scattered cumulus fully, fades toward a deck and skips night', () => {
    expect(cloudShadowStrength(0, 'day')).toBe(0);
    expect(cloudShadowStrength(0.12, 'day')).toBe(CLOUD_SHADOW.strength);
    expect(cloudShadowStrength(0.3, 'sunset')).toBe(CLOUD_SHADOW.strength);
    expect(cloudShadowStrength(0.7, 'day')).toBeLessThan(CLOUD_SHADOW.strength);
    expect(cloudShadowStrength(1, 'day')).toBe(0);
    expect(cloudShadowStrength(0.3, 'night')).toBe(0);
    expect(() => cloudShadowStrength(NaN, 'day')).toThrow();
  });
  it('writes the layer, sun and wind drift, and casts nothing before the bake', () => {
    const u = createCloudShadowUniforms(),
      field = new T.Texture();
    setCloudShadow(null, 0.3, 'day', SUN_OFFSET, 0.25, u);
    expect(u.apexCloudShadow.value.y).toBe(0);
    setCloudShadow(field, 0.3, 'day', SUN_OFFSET, 0.25, u);
    const layer = cloudLayer(0.3);
    expect(u.apexCloudField.value).toBe(field);
    expect(u.apexCloudShadow.value.x).toBe(layer.threshold);
    expect(u.apexCloudShadow.value.y).toBe(CLOUD_SHADOW.strength);
    expect(u.apexCloudShadow.value.z).toBeCloseTo(
      layer.baseAltitude + layer.thickness * CLOUD_SHADOW.layerHeight,
      9,
    );
    expect(u.apexCloudShadowSun.value.length()).toBeCloseTo(1, 12);
    // A quarter of the three-hour drift turn moves the field by 24 km.
    expect(-u.apexCloudShadowOffset.value.x).toBeCloseTo(0.25 * 10800 * CLOUD_SHADOW.windSpeed, 6);
    // The drift wraps after a whole number of field periods: no jump.
    expect(((10800 * CLOUD_SHADOW.windSpeed) / SKY_CLOUDS.fieldPeriod) % 1).toBeCloseTo(0, 9);
    field.dispose();
  });
  it('dims only the sun (directional light 0) in lit shaders, once', () => {
    const shader = {
      uniforms: {} as Record<string, T.IUniform>,
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    };
    expect(injectCloudShadow(shader)).toBe(true);
    expect(shader.fragmentShader).toContain(
      'directLight.color *= apexCloudShadowAt( geometryPosition );',
    );
    expect(shader.fragmentShader).toContain('#if UNROLLED_LOOP_INDEX == 0');
    expect(shader.fragmentShader.split(CLOUD_SHADOW_ANCHOR)).toHaveLength(2);
    expect(shader.uniforms.apexCloudField).toBeDefined();
    // A custom lighting path without three's directional loop is left alone.
    const custom = { uniforms: {}, fragmentShader: 'void main() {}' };
    expect(injectCloudShadow(custom)).toBe(false);
    expect(custom.fragmentShader).toBe('void main() {}');
  });
  it('is installed with the local atmosphere on circuit materials', () => {
    const atmosphere = new LocalAtmosphere(new Track()),
      material = new T.MeshStandardMaterial();
    atmosphere.installMaterial(material);
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('float apexCloudShadowAt(vec3 viewPosition)');
    expect(shader.fragmentShader.match(/apexCloudShadowAt\( geometryPosition \)/g)).toHaveLength(1);
    expect(material.customProgramCacheKey()).toContain('apex-cloud-shadow-v1');
    material.dispose();
  });
});
