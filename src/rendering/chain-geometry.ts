import * as T from 'three';

/** A taut visual chain: two exact external tangents and circular sprocket wraps.
 * Metres, +Z forward, X along the axle; the front centre is at Z=0 and the
 * rear centre at Z=-arm. Sampling writes into caller-owned scratch storage.
 * This describes the rendered loop, not the simulation's chain tension. */
export class ChainLoop {
  tangentAngle = 0;
  straightLength = 0;
  rearArcLength = 0;
  length = 0;

  constructor(
    private arm: number,
    private readonly rearRadius: number,
    private readonly frontRadius: number,
    private readonly x: number,
  ) {
    this.setArm(arm);
  }

  setArm(arm: number) {
    this.arm = arm;
    this.tangentAngle = Math.asin((this.rearRadius - this.frontRadius) / arm);
    this.straightLength = Math.sqrt(arm * arm - (this.rearRadius - this.frontRadius) ** 2);
    this.rearArcLength = this.rearRadius * (Math.PI + 2 * this.tangentAngle);
    this.length =
      2 * this.straightLength +
      this.rearArcLength +
      this.frontRadius * (Math.PI - 2 * this.tangentAngle);
  }

  sample(distance: number, out: T.Vector3) {
    const s = ((distance % this.length) + this.length) % this.length;
    const a = this.tangentAngle,
      c = Math.cos(a),
      sn = Math.sin(a);
    if (s < this.straightLength) {
      const t = s / this.straightLength;
      out.set(
        this.x,
        c * (this.frontRadius + (this.rearRadius - this.frontRadius) * t),
        this.frontRadius * sn + (-this.arm + (this.rearRadius - this.frontRadius) * sn) * t,
      );
    } else if (s < this.straightLength + this.rearArcLength) {
      const angle = a - (s - this.straightLength) / this.rearRadius;
      out.set(
        this.x,
        this.rearRadius * Math.cos(angle),
        -this.arm + this.rearRadius * Math.sin(angle),
      );
    } else if (s < 2 * this.straightLength + this.rearArcLength) {
      const t = (s - this.straightLength - this.rearArcLength) / this.straightLength;
      out.set(
        this.x,
        -c * (this.rearRadius + (this.frontRadius - this.rearRadius) * t),
        -this.arm +
          this.rearRadius * sn +
          (this.arm + (this.frontRadius - this.rearRadius) * sn) * t,
      );
    } else {
      const angle =
        Math.PI - a - (s - 2 * this.straightLength - this.rearArcLength) / this.frontRadius;
      out.set(this.x, this.frontRadius * Math.cos(angle), this.frontRadius * Math.sin(angle));
    }
    return out;
  }
}

/** Twelve outline vertices retain rounded pin lobes and a narrow waist at
 * 44 triangles per plate. The pin centres lie on Z, thickness on X; flat metal
 * faces retain their own normals. GP and high-detail MX use the same geometry. */
export function chainLinkPlateGeometry(pitch: number) {
  const shape = new T.Shape(),
    radius = 0.0043;
  for (let i = 0; i <= 4; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 4;
    const x = pitch / 2 + radius * Math.cos(angle),
      y = radius * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.lineTo(0, 0.0028);
  for (let i = 0; i <= 4; i++) {
    const angle = Math.PI / 2 + (i * Math.PI) / 4;
    shape.lineTo(-pitch / 2 + radius * Math.cos(angle), radius * Math.sin(angle));
  }
  shape.lineTo(0, -0.0028);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.0028,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.0014);
  geometry.rotateY(Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}
