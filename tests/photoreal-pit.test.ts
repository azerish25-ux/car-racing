import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { crewRoleColour, crewTeamColour } from '../src/rendering/crew-geometry.ts';
import { CREW_NEAR_FADE, installNearFade } from '../src/rendering/crew-suit.ts';
import { CHASE, CHASE_PIT } from '../src/rendering/renderer.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

const luminance = (c: T.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('pit box presentation', () => {
  it('codes the crew kit by role with a little per-person variation', () => {
    const team = crewTeamColour(3);
    const gun = crewRoleColour(3, 'gun', 0),
      jack = crewRoleColour(3, 'rear-jack', 0),
      release = crewRoleColour(3, 'release', 0);
    expect(crewRoleColour(3, 'gun', 0)).toBe(gun);
    expect(luminance(jack)).toBeLessThan(luminance(gun));
    expect(release.getHex()).not.toBe(gun.getHex());
    // Fabric lots differ person to person, within +-5 %.
    const people = [0, 1, 2, 3, 4, 5].map((i) => luminance(crewRoleColour(3, 'gun', i)));
    expect(new Set(people.map((v) => v.toFixed(5))).size).toBeGreaterThan(2);
    for (const v of people) {
      expect(v / luminance(team)).toBeGreaterThan(0.94);
      expect(v / luminance(team)).toBeLessThan(1.06);
    }
    // Helmets follow the role less than the suits and carry no fabric jitter.
    const helmet = crewRoleColour(3, 'rear-jack', 0, true);
    expect(luminance(helmet)).toBeGreaterThan(luminance(jack) * 0.95);
    // The shared team colour is never mutated.
    expect(crewTeamColour(3).getHex()).toBe(team.getHex());
  });
  it('dissolves the nearest crew fabric instead of filling the lens', () => {
    const m = new T.MeshStandardMaterial();
    expect(installNearFade(m)).toBe(true);
    expect(installNearFade(m)).toBe(false);
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as unknown as StudioShader;
    m.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain(`if (crewNear < ${CREW_NEAR_FADE.from.toFixed(2)})`);
    expect(shader.fragmentShader).toContain('discard;');
    expect(CREW_NEAR_FADE.from).toBeCloseTo(1.2, 6);
    m.dispose();
  });
  it('raises the chase rig into a three-quarter view over the crew in the box', () => {
    expect(CHASE_PIT.height).toBeGreaterThan(2 * CHASE.height - 0.1);
    expect(CHASE_PIT.distance).toBeGreaterThan(CHASE.distance + 2);
    expect(CHASE_PIT.yawDeg).toBeGreaterThanOrEqual(15);
    expect(CHASE_PIT.yawDeg).toBeLessThanOrEqual(20);
    // The gaze is pitched 12-15 degrees down onto the car.
    const yaw = (CHASE_PIT.yawDeg * Math.PI) / 180;
    const pitch =
      (Math.atan2(
        CHASE_PIT.height - CHASE_PIT.lookLift,
        CHASE_PIT.distance * Math.cos(yaw) + CHASE_PIT.lookAhead,
      ) *
        180) /
      Math.PI;
    expect(pitch).toBeGreaterThan(12);
    expect(pitch).toBeLessThan(15);
  });
});
