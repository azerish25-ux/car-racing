import { precipitationLighting } from './precipitation-light.ts';
import * as T from 'three';
import { markAll, markItems } from './attribute-ranges.ts';

/** Bounded, velocity-aligned rain, independent of the GPU's point-size limit.
 * Arrays are views of Effects' existing pool; this owns no extra particle state.
 * Exposure is a presentation constant, never render-dt or a simulation input. */
export class RainStreaks {
  readonly geometry = new T.InstancedBufferGeometry();
  readonly material: T.ShaderMaterial;
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  private viewport = new T.Vector4();
  constructor(positions: Float32Array, velocities: Float32Array, opacity: Float32Array) {
    if (
      !opacity.length ||
      positions.length !== opacity.length * 3 ||
      velocities.length !== positions.length
    )
      throw new Error('Rain instance arrays must have matching nonzero lengths');
    this.geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute(
      'center',
      new T.InstancedBufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'velocity',
      new T.InstancedBufferAttribute(velocities, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'opacity',
      new T.InstancedBufferAttribute(opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.instanceCount = opacity.length;
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      lights: true,
      uniforms: {
        ...T.UniformsUtils.clone(T.UniformsLib.lights),
        ...T.UniformsUtils.clone(T.UniformsLib.fog),
        viewportSize: { value: new T.Vector2(1, 1) },
        nearPlane: { value: 0.1 },
      },
      vertexShader: `
        attribute vec3 center;
        attribute vec3 velocity;
        attribute float opacity;
        uniform vec2 viewportSize;
        uniform float nearPlane;
        varying vec2 vUv;
        varying float vOpacity;
        varying vec3 vRainLight;
        #include <common>
        #include <lights_pars_begin>
        #include <fog_pars_vertex>
        ${precipitationLighting}
        void main() {
          vUv = position.xy;
          vOpacity = opacity;
          vRainLight = vec3(0.);
          vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
          #include <fog_vertex>
          // No screen-filling streaks from particles crossing/behind the near plane.
          if (opacity <= 0.0 || mvPosition.z > -max(0.15, nearPlane * 1.5)) {
            vOpacity = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vRainLight = vec3(.66,.76,.85)*precipitationEnergy(mvPosition.xyz);
          vec4 clip = projectionMatrix * mvPosition;
          vec4 motion = projectionMatrix * modelViewMatrix * vec4(velocity, 0.0);
          // Derivative of perspective division: includes a velocity along view Z.
          vec2 screenMotion = (motion.xy * clip.w - clip.xy * motion.w)
            / max(0.0001, clip.w * clip.w) * viewportSize * 0.5 * 0.024;
          float extent = length(screenMotion);
          vec2 along = extent > 0.001 ? screenMotion / extent : vec2(0.0, -1.0);
          vec2 across = vec2(along.y, -along.x);
          float halfLength = clamp(extent * 0.5, 1.0, 24.0);
          float halfWidth = clamp(0.006 * projectionMatrix[1][1]
            * viewportSize.y / max(0.1, -mvPosition.z), 0.55, 1.6);
          vec2 offset = across * position.x * halfWidth + along * position.y * halfLength;
          clip.xy += offset * 2.0 / viewportSize * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying float vOpacity;
        varying vec3 vRainLight;
        #include <fog_pars_fragment>
        void main() {
          float edge = 1.0 - smoothstep(0.12, 1.0, abs(vUv.x));
          float taper = 1.0 - smoothstep(0.35, 1.0, abs(vUv.y));
          float alpha = vOpacity * edge * taper;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vRainLight, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // The quad's position is only a template corner. Haze follows the actual
    // drop centre, just as lighting and depth already do.
    this.material.userData.localWeatherPosition = 'center';
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.name = 'Velocity-aligned rain streaks';
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      // Use the actual viewport, including mirrors, cube faces and composer targets.
      renderer.getCurrentViewport(this.viewport);
      this.material.uniforms.viewportSize.value.set(
        Math.max(1, this.viewport.z),
        Math.max(1, this.viewport.w),
      );
      this.material.uniforms.nearPlane.value = 'near' in camera ? camera.near : 0.1;
    };
  }
  /** Draw pool items `0..count - 1`. Items past the last live particle are
   * transparent (culled in the vertex stage), so this changes no pixel; an
   * empty pool submits no draw at all. */
  drawUpTo(count: number) {
    this.geometry.instanceCount = count;
  }
  /** Upload pool items `first..last` (inclusive); the whole pool by default. */
  upload(first = 0, last = this.geometry.instanceCount - 1) {
    for (const name of ['center', 'velocity', 'opacity'])
      markItems(this.geometry.getAttribute(name) as T.BufferAttribute, first, last);
  }
  clear() {
    // Effects zeroes the shared opacity view; upload even on a paused seek.
    markAll(this.geometry.getAttribute('opacity') as T.BufferAttribute);
  }
}
