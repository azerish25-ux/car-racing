import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { WeatherPresentation, tagWeatherSurface } from '../src/rendering/weather-presentation.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import {
  installKerbFinish,
  installRunoffFinish,
} from '../src/rendering/studio/kerb-runoff-finish.ts';
import { installGpTyreFinish } from '../src/rendering/gp-tyre-finish.ts';

const shaderFor = (material: T.Material) => {
  const shader = {
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
    uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
  };
  material.onBeforeCompile(
    shader as Parameters<T.Material['onBeforeCompile']>[0],
    {} as T.WebGLRenderer,
  );
  return shader.fragmentShader;
};
describe('GP rain reference: composed final surface response', () => {
  it.each(['kerb', 'runoff', 'tyre'] as const)(
    '%s cannot overwrite its snapshot-driven dampness with a later dry finish',
    (kind) => {
      const m = new T.MeshStandardMaterial();
      if (kind === 'kerb') {
        installCircuitFinish(m, 'kerb');
        installKerbFinish(m);
      } else if (kind === 'runoff') {
        installCircuitFinish(m, 'paint');
        installRunoffFinish(m);
      } else {
        tagWeatherSurface(m, 'rubber');
        installGpTyreFinish(m);
      }
      const weather = new WeatherPresentation();
      weather.installMaterial(m);
      const glsl = shaderFor(m);
      const dry = glsl.indexOf(
        kind === 'kerb'
          ? 'roughnessFactor = mix( 0.8200'
          : kind === 'runoff'
            ? 'roughnessFactor = int( vRunoffStyle'
            : 'roughnessFactor=mix(roughnessFactor,gpTyreRoughness',
      );
      const wet = glsl.indexOf('roughnessFactor = mix(roughnessFactor, min(roughnessFactor,');
      expect(dry).toBeGreaterThan(0);
      expect(wet).toBeGreaterThan(dry);
      expect(wet).toBeLessThan(glsl.indexOf('#include <lights_physical_fragment>'));
      expect(glsl.indexOf('diffuseColor.rgb *= 1.-surfaceWet')).toBeGreaterThan(
        glsl.indexOf('#include <normal_fragment_maps>'),
      );
      weather.dispose();
      m.dispose();
    },
  );
  it('installs only once and keeps the standard exposure and no-road double wetting rule', () => {
    const m = tagWeatherSurface(new T.MeshStandardMaterial(), 'kerb', 0.7),
      weather = new WeatherPresentation();
    weather.installMaterial(m);
    const key = m.customProgramCacheKey(),
      hook = m.onBeforeCompile;
    weather.installMaterial(m);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.customProgramCacheKey()).toBe(key);
    const glsl = shaderFor(m);
    expect(glsl.match(/uniform vec4 aurelSurfaceWeather;/g)).toHaveLength(1);
    expect(glsl).toContain('* 0.700000 *');
    weather.dispose();
    m.dispose();
  });
});
