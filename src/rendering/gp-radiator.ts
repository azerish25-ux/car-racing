import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import { tagWeatherSurface } from './weather-presentation.ts';

/** REF 001/022: a recessed heat exchanger has a fine fin rhythm behind the
 * fork, bounded by formed tanks. These are original metric dimensions within
 * the former 360 × 260 × 40 mm radiator envelope, not recovered source art. */
export const GP_RADIATOR = Object.freeze({
  width: 0.36,
  height: 0.26,
  depth: 0.04,
  finPitch: 0.0046,
  guardPitch: 0.018,
});

/** Keep fine fins and the coarser protective mesh on the actual curved core.
 * Derivatives operate on continuous metre coordinates, before fract(). Each
 * pattern converges to its average coverage when it becomes subpixel; neither
 * extra geometry nor a clock-driven texture is needed on a distant opponent. */
export function installGpRadiatorFinish(material: T.MeshStandardMaterial): boolean {
  return chainShaderHook(material, 'gp-radiator-finish-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec3 gpRadiatorBind; varying vec3 vGpRadiatorBind;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vGpRadiatorBind=gpRadiatorBind;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
      varying vec3 vGpRadiatorBind;
      float gpRadiatorRelief, gpRadiatorFins, gpRadiatorGuard;
      float gpRadiatorLine(float phase, float coverage) {
        float pixel=max(fwidth(phase),.00001);
        float resolved=1.-smoothstep(.20,.65,pixel);
        float distanceToLine=abs(fract(phase+.5)-.5);
        float line=1.-smoothstep(coverage*.5-pixel*.5,coverage*.5+pixel*.5,distanceToLine);
        return mix(coverage,line,resolved);
      }
      `,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
      {
        vec2 p=vGpRadiatorBind.xy;
        gpRadiatorFins=gpRadiatorLine(p.y/${GP_RADIATOR.finPitch.toFixed(6)},.16);
        float channels=gpRadiatorLine(p.x/.032,.055);
        float meshA=gpRadiatorLine((p.x+p.y)/${GP_RADIATOR.guardPitch.toFixed(6)},.07);
        float meshB=gpRadiatorLine((p.x-p.y)/${GP_RADIATOR.guardPitch.toFixed(6)},.07);
        // Union of the crossing wires also has a stable subpixel mean.
        gpRadiatorGuard=meshA+meshB-meshA*meshB;
        float edge=min(.157-abs(p.x),.116-abs(p.y));
        float recess=mix(.68,1.,smoothstep(0.,.025,edge));
        diffuseColor.rgb*=mix(1.,mix(.61,1.45,gpRadiatorFins)*mix(1.,1.18,channels)
          *mix(1.,.37,gpRadiatorGuard)*recess,vGpRadiatorBind.z);
        gpRadiatorRelief=(.00020*gpRadiatorFins+.00065*gpRadiatorGuard+.00012*channels)
          *vGpRadiatorBind.z;
      }
      `,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor=clamp(roughnessFactor+(-.09*gpRadiatorFins+.12*gpRadiatorGuard)*vGpRadiatorBind.z,.45,.86);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
      {
        vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
        vec3 r1=cross(dy,normal),r2=cross(normal,dx);float det=dot(dx,r1);
        vec3 grad=sign(det)*(dFdx(gpRadiatorRelief)*r1+dFdy(gpRadiatorRelief)*r2);
        normal=normalize(max(abs(det),1.e-10)*normal-grad);
      }
      `,
      'fragment',
    );
  });
}

const finishes = new WeakMap<BikeMaterials, T.MeshStandardMaterial>();
function coolingFinish(materials: BikeMaterials): T.MeshStandardMaterial {
  let finish = finishes.get(materials);
  if (finish) return finish;
  finish = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.7,
    roughness: 0.66,
    name: 'GP radiator: formed tanks, recessed fins and filtered protective mesh',
  });
  installGpRadiatorFinish(finish);
  // The core is recessed behind bodywork, so only limited exposed dampness is
  // appropriate. Weather owns the final wet response after the dry finish.
  tagWeatherSurface(finish, 'metal', 0.28);
  materials.list.push(finish);
  finishes.set(materials, finish);
  return finish;
}

/** Modest compound curvature avoids the featureless flat black block. The
 * bind attribute remains in core-local metres if a future rigid batch merges
 * it; the shader's scale cannot change with a mesh's UV packing or placement. */
export function gpRadiatorCore(detail: Exclude<RiderDetail, 'far'>): T.BufferGeometry {
  const columns = detail === 'high' ? 12 : 6,
    rows = detail === 'high' ? 4 : 2,
    positions: number[] = [],
    uvs: number[] = [],
    binding: number[] = [],
    colours: number[] = [],
    indices: number[] = [];
  const finish = new T.Color(0x565e63);
  for (let row = 0; row <= rows; row++) {
    const y = (row / rows - 0.5) * 0.232;
    for (let column = 0; column <= columns; column++) {
      const x = (column / columns - 0.5) * 0.314;
      positions.push(x, y, 0.014 - 0.012 * (x / 0.157) ** 2 - 0.002 * (y / 0.116) ** 2);
      binding.push(x, y, 1);
      colours.push(finish.r, finish.g, finish.b);
      uvs.push(column / columns, row / rows);
    }
  }
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column,
        b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('gpRadiatorBind', new T.Float32BufferAttribute(binding, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** One rigid material batch, 204 triangles on high / 132 on mid. The
 * entrant owns the one shared high/mid finish; the model owns its geometries.
 * Vertex colours and the bind mask separate the dark casing, metal tanks and
 * finned core, including in the windscreen's additional transmission draw.
 * Far LOD allocates neither geometry nor material. No moving rig is changed. */
export function gpRadiator(detail: RiderDetail, materials: BikeMaterials): T.Group {
  const root = new T.Group();
  root.name = 'GP curved radiator and protective mesh';
  if (detail === 'far') return root;
  const parts: T.BufferGeometry[] = [gpRadiatorCore(detail)];
  const solid = (geometry: T.BufferGeometry, colour: T.Color) => {
    const count = geometry.getAttribute('position').count,
      colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set([colour.r, colour.g, colour.b], i * 3);
    geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
    geometry.setAttribute(
      'gpRadiatorBind',
      new T.Float32BufferAttribute(new Float32Array(count * 3), 3),
    );
    parts.push(geometry);
  };
  solid(new T.BoxGeometry(0.33, 0.238, 0.018).translate(0, 0, -0.011), materials.dark.color);
  for (const side of [-1, 1]) {
    solid(
      new T.CylinderGeometry(0.01, 0.01, 0.25, 6)
        .scale(1.12, 1, 1.15)
        .translate(side * 0.167, 0, -0.001),
      materials.steel.color,
    );
    solid(
      new T.BoxGeometry(0.022, 0.026, 0.008).translate(side * 0.168, 0.063, -0.015),
      materials.steel.color,
    );
    solid(
      new T.BoxGeometry(0.318, 0.009, 0.021).translate(0, side * 0.1205, 0.002),
      materials.steel.color,
    );
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  const pack = new T.Mesh(geometry, coolingFinish(materials));
  pack.name = 'Curved radiator core and formed tanks';
  pack.castShadow = pack.receiveShadow = true;
  root.add(pack);
  root.userData.referenceIds = [1, 22];
  return root;
}
