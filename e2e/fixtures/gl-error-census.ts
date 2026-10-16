export interface GlErrorObservation {
  stage: string;
  code: number;
}

/** Drain every sticky error at a phase boundary, not after every draw call.
 * Diagnostic readbacks are synchronous driver round-trips. Keeping them outside
 * the draw loop preserves batching without accepting a previously rejected error.
 */
export function captureGlErrors(
  gl: Pick<WebGL2RenderingContext, 'getError' | 'NO_ERROR' | 'CONTEXT_LOST_WEBGL'>,
  stage: string,
  observations: GlErrorObservation[],
): void {
  for (let i = 0; i < 32; i++) {
    const code = gl.getError();
    if (code === gl.NO_ERROR) return;
    observations.push({ stage, code });
    if (code === gl.CONTEXT_LOST_WEBGL) return;
  }
  throw new Error(`WebGL error state did not drain during ${stage}`);
}
