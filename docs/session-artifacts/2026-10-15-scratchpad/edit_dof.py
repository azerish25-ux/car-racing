p='src/rendering/trackside.ts'
s=open(p).read()
old="""  dofBelow: 20,
  // Broadcast-mild (qa-signoff review of shots/qa-signoff-medium/70-pit-tv):
  // 0.0013 / 0.011 turned the held pit-stop TV shot into a miniature with the
  // pit wall and boards unreadable; a long lens softens, it does not smear.
  aperture: 0.0006,
  maxblur: 0.006,
});"""
new="""  dofBelow: 20,
});
// The lens itself is a broadcast camera's thin lens (studio/subject-focus.ts
// BROADCAST_LENS): a depth-proportional blur reached 10 m either side of focus
// made every held broadcast shot a tilt-shift miniature (photoreal review).
"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/studio/subject-focus.ts'
s=open(p).read()
old=s[s.index("import type * as T from 'three';"):s.index("/** Focus the pass on `subject`")]
new="""import type * as T from 'three';
import { SHOWROOM } from '../menu-preview.ts';
import { TELEPHOTO } from '../trackside.ts';
import { REPLAY_LENS, thinLensScale } from '../ultra/replay-lens.ts';
import type { DepthOfFieldPass } from './dof-pass.ts';

/**
 * Depth of field on the subject car outside photo mode (D29 showroom, D30
 * broadcast telephoto): the menu's showroom lens, or a trackside lens tighter
 * than `TELEPHOTO.dofBelow` degrees. Photo mode keeps its own lens settings.
 *
 * The trackside lens is a real broadcast camera's: a thin lens on a 2/3-inch
 * B4 gate (5.4 mm high) at f/4. Its circle of confusion grows with the
 * distance ratio to the focus (`thinLensScale`), so a 60-150 m pack keeps
 * almost the whole frame sharp, as on television, with a little softening of
 * the near catch fence; a close pit-lane shot still separates. The pass skips
 * pixels under half a pixel of blur, so this is cheaper than the old
 * depth-proportional blur on every preset.
 */
export interface SubjectLens {
  aperture: number;
  maxblur: number;
  /** Thin-lens model (gate height, f-number): lensK from the camera's fov. */
  thinLens?: Readonly<{ fNumber: number; sensorHeight: number }>;
}
export const BROADCAST_LENS: SubjectLens = Object.freeze({
  aperture: 0,
  maxblur: 0.004,
  thinLens: Object.freeze({ fNumber: 4, sensorHeight: 0.0054 }),
});
export function subjectLens(
  menu: boolean,
  photo: boolean,
  camera: string,
  fov: number,
): SubjectLens | null {
  if (photo) return null;
  if (menu) return SHOWROOM;
  return camera === 'trackside' && fov < TELEPHOTO.dofBelow ? BROADCAST_LENS : null;
}

"""
s=s.replace(old,new)
old="""  camera.updateMatrixWorld();
  const uniforms = pass.materialBokeh.uniforms;
  uniforms.focus.value = -scratch.copy(subject).applyMatrix4(camera.matrixWorldInverse).z;
  uniforms.aperture.value = lens.aperture;
  uniforms.maxblur.value = lens.maxblur;
  pass.enabled = true;"""
new="""  camera.updateMatrixWorld();
  const uniforms = pass.materialBokeh.uniforms;
  const depth = -scratch.copy(subject).applyMatrix4(camera.matrixWorldInverse).z;
  uniforms.aperture.value = lens.aperture;
  uniforms.maxblur.value = lens.maxblur;
  if (lens.thinLens) {
    if (!uniforms.lensK) throw new Error('Thin-lens subject focus needs a thin-lens pass');
    const focus = Math.max(REPLAY_LENS.minFocus, depth);
    uniforms.focus.value = focus;
    uniforms.lensK.value = thinLensScale(
      camera.fov,
      focus,
      lens.thinLens.fNumber,
      lens.thinLens.sensorHeight,
    );
  } else uniforms.focus.value = depth;
  pass.enabled = true;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/renderer.ts'
s=open(p).read()
old="""  private photoFocus: DepthOfFieldPass | null = null;"""
new="""  private photoFocus: DepthOfFieldPass | null = null;
  /** Trackside broadcast telephoto: a thin-lens pass (studio/subject-focus.ts). */
  private broadcastFocus: DepthOfFieldPass | null = null;"""
assert old in s; s=s.replace(old,new)
old="""      if (lens) {
        this.photoFocus ??= new DepthOfFieldPass(
          this.camera,
          { focus: 10, ...lens },
          this.scenePass.target.depthTexture!,
        );
        if (!this.composer.passes.includes(this.photoFocus))
          this.composer.insertPass(this.photoFocus, 1);
        focusOnSubject(
          this.photoFocus,
          this.camera,
          pregame ? this.gridFocus : this.target,
          lens,
          this.temporary,
        );
      } else if (this.photoFocus && !this.photo?.depthOfField) this.photoFocus.enabled = false;"""
new="""      if (lens?.thinLens) {
        this.broadcastFocus ??= new DepthOfFieldPass(
          this.camera,
          { focus: 10, aperture: 0, maxblur: lens.maxblur },
          this.scenePass.target.depthTexture!,
          { thinLens: true },
        );
        if (!this.composer.passes.includes(this.broadcastFocus))
          this.composer.insertPass(this.broadcastFocus, 1);
        focusOnSubject(this.broadcastFocus, this.camera, this.target, lens, this.temporary);
        if (this.photoFocus && !this.photo?.depthOfField) this.photoFocus.enabled = false;
      } else if (lens) {
        this.photoFocus ??= new DepthOfFieldPass(
          this.camera,
          { focus: 10, ...lens },
          this.scenePass.target.depthTexture!,
        );
        if (!this.composer.passes.includes(this.photoFocus))
          this.composer.insertPass(this.photoFocus, 1);
        focusOnSubject(
          this.photoFocus,
          this.camera,
          pregame ? this.gridFocus : this.target,
          lens,
          this.temporary,
        );
      } else if (this.photoFocus && !this.photo?.depthOfField) this.photoFocus.enabled = false;
      if (this.broadcastFocus && !lens?.thinLens) this.broadcastFocus.enabled = false;"""
assert old in s; s=s.replace(old,new)
old="""        otherDof: !!this.photoFocus?.enabled,"""
new="""        otherDof: !!this.photoFocus?.enabled || !!this.broadcastFocus?.enabled,"""
assert old in s; s=s.replace(old,new)
old="""    this.photoFocus?.dispose();"""
new="""    this.photoFocus?.dispose();
    this.broadcastFocus?.dispose();"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='tests/replay-photo.test.ts'
s=open(p).read()
old="""    expect(subjectLens(false, false, 'trackside', 15)).toBe(TELEPHOTO);"""
new="""    expect(subjectLens(false, false, 'trackside', 15)).toBe(BROADCAST_LENS);"""
assert old in s; s=s.replace(old,new)
s=s.replace("import { subjectLens } from '../src/rendering/studio/subject-focus.ts';","import { BROADCAST_LENS, subjectLens } from '../src/rendering/studio/subject-focus.ts';")
open(p,'w').write(s)
