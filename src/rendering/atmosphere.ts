import * as T from 'three';

/**
 * Physically based sky (Hillaire 2020, "A Scalable and Production Ready Sky
 * and Atmosphere Rendering Technique"; Bruneton & Neyret 2008).
 *
 * The atmosphere is a spherical shell of Rayleigh molecules, Mie aerosols and
 * an ozone layer over a 6360 km planet. Light is single-scattered from the sun
 * along every view ray, and the infinite higher scattering orders come from
 * Hillaire's isotropic multiple-scattering LUT (Psi_ms = L_2 / (1 - f_ms)).
 * Everything is evaluated on the CPU, once per haze level and sun direction,
 * into small tables:
 *
 *  - transmittance(r, mu): 128 x 32, Bruneton's horizon-preserving mapping;
 *  - multiple scattering Psi_ms(r, mu_sun): 16 x 16, 64 directions each;
 *  - sky view L(azimuth from the sun, elevation): 96 x 64 for a camera
 *    200 m above the datum, with rows packed quadratically toward the horizon
 *    where the colour changes fastest (elevation = (v^2) * 90 degrees).
 *
 * The sky view is uploaded as a small half-float texture; the visible dome and
 * every PMREM capture sample the same texels, and the CPU uses the very same
 * table for the scene's sun colour, sky irradiance and the haze colour of the
 * aerial perspective. One sun, one sky: lighting, reflections, fog and the
 * background cannot disagree.
 *
 * Units: radiance per unit top-of-atmosphere solar irradiance (white sun, 1 per
 * channel). `ATMOSPHERE.sceneIrradiance` turns it into scene units: the clear
 * 52 degree day sun then reaches the ground at the authored key of 3.9.
 *
 * Cost: about 40-90 ms of CPU per (haze, sun) on first use, cached thereafter
 * (renderers prewarm their lighting's levels behind the loading screen); the
 * shader cost is two bilinear fetches per sky pixel. Deterministic: a pure
 * function of the haze level and sun direction.
 */
export const ATMOSPHERE = Object.freeze({
  bottomRadius: 6360e3,
  topRadius: 6460e3,
  /** Rayleigh scattering at sea level (680, 550, 440 nm), 1/m. */
  rayleighScattering: Object.freeze([5.802e-6, 13.558e-6, 33.1e-6] as const),
  rayleighScaleHeight: 8000,
  /** Mie aerosols at sea level for haze 1, 1/m (Hillaire's reference value,
   * an aerosol optical depth of only 0.005 at 550 nm; real clear days are 6-20
   * times hazier, see `atmosphereHaze`). */
  mieScattering: 3.996e-6,
  mieAbsorption: 0.444e-6,
  /** Angstrom exponent of the aerosol extinction: haze reddens the sun and
   * whitens the low sky more in blue than in red. */
  mieAngstrom: 1.3,
  mieScaleHeight: 1200,
  /** Mie phase asymmetry (Cornette-Shanks). */
  mieG: 0.8,
  /** Ozone absorption peak (tent profile around 25 km, 15 km half-width), 1/m. */
  ozoneAbsorption: Object.freeze([0.65e-6, 1.881e-6, 0.085e-6] as const),
  ozoneCenter: 25000,
  ozoneWidth: 15000,
  /** Diffuse ground albedo seen by the multiple scattering. */
  groundAlbedo: 0.3,
  /** Camera altitude above the datum for the sky view, metres. */
  cameraHeight: 200,
  /** Mean altitude of the cumulus layer that the cloud key light reaches. */
  cloudHeight: 1800,
  /** Solar angular radius, radians (0.2665 degrees). */
  sunAngularRadius: 0.004651,
  /** Top-of-atmosphere solar irradiance in scene units (see header). */
  sceneIrradiance: 4.65,
  transmittanceSize: Object.freeze([128, 32] as const),
  multiScatteringSize: 16,
  skyViewSize: Object.freeze([96, 64] as const),
});

export type Rgb = [number, number, number];
const A = ATMOSPHERE;
const RB = A.bottomRadius,
  RT = A.topRadius,
  H_TOP = Math.sqrt(RT * RT - RB * RB);

/** Relative aerosol extinction at 680, 550 and 440 nm. */
const MIE_SPECTRUM = [680, 550, 440].map((nm) => (nm / 550) ** -A.mieAngstrom);
/** At altitude h: Rayleigh scattering [0..2], extinction [3..5] and Mie
 * scattering [6..8], 1/m, for a haze. */
function medium(h: number, haze: number, out: Float64Array) {
  const rayleigh = Math.exp(-h / A.rayleighScaleHeight),
    mie = Math.exp(-h / A.mieScaleHeight) * haze,
    ozone = Math.max(0, 1 - Math.abs(h - A.ozoneCenter) / A.ozoneWidth);
  for (let k = 0; k < 3; k++) {
    const ms = A.mieScattering * mie * MIE_SPECTRUM[k],
      ma = A.mieAbsorption * mie * MIE_SPECTRUM[k];
    out[k] = A.rayleighScattering[k] * rayleigh;
    out[3 + k] = out[k] + ms + ma + A.ozoneAbsorption[k] * ozone;
    out[6 + k] = ms;
  }
  return out;
}

/** Distance along a ray from radius r with zenith cosine mu to a sphere of
 * radius R (the far intersection), or -1 when it misses. */
function sphereExit(r: number, mu: number, radius: number) {
  const disc = r * r * (mu * mu - 1) + radius * radius;
  return disc < 0 ? -1 : -r * mu + Math.sqrt(disc);
}
/** Distance to the ground, or -1 when the ray does not hit it. */
function groundHit(r: number, mu: number) {
  if (mu >= 0) return -1;
  const disc = r * r * (mu * mu - 1) + RB * RB;
  return disc < 0 ? -1 : -r * mu - Math.sqrt(disc);
}

/** Bruneton's transmittance mapping: (r, mu) -> (u, v) in [0, 1]. */
export function transmittanceUv(r: number, mu: number): [number, number] {
  const rho = Math.sqrt(Math.max(0, r * r - RB * RB));
  const d = Math.max(0, sphereExit(r, mu, RT)),
    dMin = RT - r,
    dMax = rho + H_TOP;
  return [(d - dMin) / Math.max(dMax - dMin, 1e-6), rho / H_TOP];
}
function transmittanceRMu(u: number, v: number): [number, number] {
  const rho = H_TOP * v,
    r = Math.sqrt(rho * rho + RB * RB),
    dMin = RT - r,
    dMax = rho + H_TOP,
    d = dMin + u * (dMax - dMin);
  const mu = d === 0 ? 1 : (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d);
  return [r, Math.min(1, Math.max(-1, mu))];
}

function bilinear(table: Float32Array, w: number, h: number, u: number, v: number, out: Rgb) {
  const x = Math.min(w - 1, Math.max(0, u * (w - 1))),
    y = Math.min(h - 1, Math.max(0, v * (h - 1)));
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(w - 1, x0 + 1),
    y1 = Math.min(h - 1, y0 + 1),
    fx = x - x0,
    fy = y - y0;
  const a = (y0 * w + x0) * 3,
    b = (y0 * w + x1) * 3,
    c = (y1 * w + x0) * 3,
    d = (y1 * w + x1) * 3;
  for (let k = 0; k < 3; k++)
    out[k] =
      (table[a + k] * (1 - fx) + table[b + k] * fx) * (1 - fy) +
      (table[c + k] * (1 - fx) + table[d + k] * fx) * fy;
  return out;
}

/** The transmittance and multiple-scattering tables of one haze level. */
export class AtmosphereMedium {
  readonly transmittance: Float32Array;
  readonly multiScattering: Float32Array;
  private readonly scratch = new Float64Array(9);
  constructor(readonly haze: number) {
    if (!Number.isFinite(haze) || haze <= 0) throw new Error('Invalid atmosphere haze');
    this.transmittance = this.bakeTransmittance();
    this.multiScattering = this.bakeMultiScattering();
  }
  private bakeTransmittance() {
    const [w, h] = A.transmittanceSize,
      table = new Float32Array(w * h * 3),
      m = this.scratch,
      steps = 32;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const [r, mu] = transmittanceRMu(i / (w - 1), j / (h - 1));
        const length = Math.max(0, sphereExit(r, mu, RT)),
          dt = length / steps;
        let o0 = 0,
          o1 = 0,
          o2 = 0;
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) * dt,
            hh = Math.sqrt(r * r + t * t + 2 * r * mu * t) - RB;
          medium(hh, this.haze, m);
          o0 += m[3] * dt;
          o1 += m[4] * dt;
          o2 += m[5] * dt;
        }
        const o = (j * w + i) * 3;
        table[o] = Math.exp(-o0);
        table[o + 1] = Math.exp(-o1);
        table[o + 2] = Math.exp(-o2);
      }
    return table;
  }
  /** Transmittance from radius r toward zenith cosine mu to the top of the
   * atmosphere; 0 when the planet blocks the ray. Allocation-free. */
  sunTransmittance(r: number, mu: number, out: Rgb = [0, 0, 0]) {
    const r2 = r * r,
      horizon = -Math.sqrt(Math.max(0, 1 - (RB * RB) / r2));
    if (mu < horizon) return ((out[0] = out[1] = out[2] = 0), out);
    const rho = Math.sqrt(Math.max(0, r2 - RB * RB)),
      disc = r2 * (mu * mu - 1) + RT * RT,
      d = disc < 0 ? 0 : Math.max(0, -r * mu + Math.sqrt(disc)),
      dMin = RT - r,
      dMax = rho + H_TOP;
    return bilinear(
      this.transmittance,
      A.transmittanceSize[0],
      A.transmittanceSize[1],
      (d - dMin) / Math.max(dMax - dMin, 1e-6),
      rho / H_TOP,
      out,
    );
  }
  private bakeMultiScattering() {
    const n = A.multiScatteringSize,
      table = new Float32Array(n * n * 3),
      m = this.scratch,
      steps = 16,
      // 8 x 8 stratified directions over the sphere (equal-area in cos theta).
      directions: [number, number, number][] = [];
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 8; b++) {
        const cosTheta = 1 - (2 * (a + 0.5)) / 8,
          sinTheta = Math.sqrt(1 - cosTheta * cosTheta),
          phi = (2 * Math.PI * (b + 0.5 + 0.5 * (a % 2))) / 8;
        directions.push([sinTheta * Math.cos(phi), cosTheta, sinTheta * Math.sin(phi)]);
      }
    const sunT: Rgb = [0, 0, 0],
      isotropic = 1 / (4 * Math.PI);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const muSun = (i / (n - 1)) * 2 - 1,
          r = RB + (j / (n - 1)) * (RT - RB) * 0.999 + 1,
          sunX = Math.sqrt(1 - muSun * muSun),
          sunY = muSun;
        let l0 = 0,
          l1 = 0,
          l2 = 0,
          f0 = 0,
          f1 = 0,
          f2 = 0;
        for (let n0 = 0; n0 < directions.length; n0++) {
          const dx = directions[n0][0],
            dy = directions[n0][1],
            dz = directions[n0][2];
          const ground = groundHit(r, dy),
            length = ground >= 0 ? ground : Math.max(0, sphereExit(r, dy, RT)),
            dt = length / steps;
          let th0 = 1,
            th1 = 1,
            th2 = 1;
          for (let s = 0; s < steps; s++) {
            const t = (s + 0.5) * dt;
            // Sample point (planet centre at the origin, start on the y axis).
            const px = dx * t,
              py = r + dy * t,
              pz = dz * t,
              pr = Math.sqrt(px * px + py * py + pz * pz);
            medium(pr - RB, this.haze, m);
            this.sunTransmittance(pr, (px * sunX + py * sunY) / pr, sunT);
            const s0 = m[0] + m[6],
              s1 = m[1] + m[7],
              s2 = m[2] + m[8],
              e0 = Math.max(m[3], 1e-12),
              e1 = Math.max(m[4], 1e-12),
              e2 = Math.max(m[5], 1e-12),
              t0 = Math.exp(-e0 * dt),
              t1 = Math.exp(-e1 * dt),
              t2 = Math.exp(-e2 * dt),
              i0 = (th0 * s0 * (1 - t0)) / e0,
              i1 = (th1 * s1 * (1 - t1)) / e1,
              i2 = (th2 * s2 * (1 - t2)) / e2;
            l0 += i0 * sunT[0] * isotropic;
            l1 += i1 * sunT[1] * isotropic;
            l2 += i2 * sunT[2] * isotropic;
            f0 += i0;
            f1 += i1;
            f2 += i2;
            th0 *= t0;
            th1 *= t1;
            th2 *= t2;
          }
          if (ground >= 0) {
            // Lambertian ground lit by the attenuated sun.
            const px = dx * ground,
              py = r + dy * ground,
              pz = dz * ground,
              pr = Math.sqrt(px * px + py * py + pz * pz),
              mu = (px * sunX + py * sunY) / pr;
            this.sunTransmittance(pr, mu, sunT);
            const lit = (Math.max(0, mu) * A.groundAlbedo) / Math.PI;
            l0 += th0 * sunT[0] * lit;
            l1 += th1 * sunT[1] * lit;
            l2 += th2 * sunT[2] * lit;
          }
        }
        const count = directions.length,
          o = (j * n + i) * 3;
        // Psi_ms = L_2 / (1 - f_ms), both averaged over the sphere.
        table[o] = l0 / count / (1 - Math.min(0.99, f0 / count));
        table[o + 1] = l1 / count / (1 - Math.min(0.99, f1 / count));
        table[o + 2] = l2 / count / (1 - Math.min(0.99, f2 / count));
      }
    return table;
  }
  /** Isotropic multiple-scattering source Psi_ms at (r, mu_sun). */
  multipleScattering(r: number, muSun: number, out: Rgb = [0, 0, 0]) {
    const n = A.multiScatteringSize;
    return bilinear(
      this.multiScattering,
      n,
      n,
      muSun * 0.5 + 0.5,
      Math.min(1, Math.max(0, (r - RB) / (RT - RB))),
      out,
    );
  }
}

/** Rayleigh phase function. */
export function rayleighPhase(cosTheta: number) {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}
/** Cornette-Shanks Mie phase function. */
export function miePhase(cosTheta: number, g = A.mieG) {
  const g2 = g * g,
    k = ((3 / (8 * Math.PI)) * (1 - g2)) / (2 + g2);
  return (k * (1 + cosTheta * cosTheta)) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
}

/** Sky-view row v (0 horizon .. 1 zenith) for an elevation in radians. */
export function skyViewV(elevation: number) {
  return Math.sqrt(Math.min(1, Math.max(0, elevation / (Math.PI / 2))));
}
/** Sky-view column u (0 toward the sun .. 1 away) for an azimuth from the sun. */
export function skyViewU(azimuth: number) {
  return Math.min(1, Math.max(0, Math.abs(azimuth) / Math.PI));
}

/** One sun over one haze level: the sky view and the light it implies. */
export class AtmosphereSky {
  /** RGB radiance per unit TOA irradiance, [row][column] (v rows, u columns). */
  readonly skyView: Float32Array;
  /** Sun transmittance at the camera (the scene's key colour and strength). */
  readonly sunTransmittance: Rgb;
  /** Sun transmittance at the cloud layer (the clouds' key). */
  readonly cloudSunTransmittance: Rgb;
  /** Cosine-weighted mean radiance of the upper hemisphere (sky irradiance / pi). */
  readonly meanRadiance: Rgb;
  /** Mean radiance of the upper hemisphere seen by a cloud (uniform weight). */
  readonly domeRadiance: Rgb;
  private texture: T.DataTexture | null = null;
  constructor(
    readonly medium: AtmosphereMedium,
    readonly sun: T.Vector3,
  ) {
    const s = sun.clone().normalize();
    if (![s.x, s.y, s.z].every(Number.isFinite)) throw new Error('Invalid sun direction');
    this.sun = s;
    const r = RB + A.cameraHeight;
    this.sunTransmittance = medium.sunTransmittance(r, s.y);
    this.cloudSunTransmittance = medium.sunTransmittance(RB + A.cloudHeight, s.y);
    this.skyView = this.bakeSkyView();
    this.meanRadiance = this.hemisphereMean(true);
    this.domeRadiance = this.hemisphereMean(false);
  }
  private bakeSkyView() {
    const [w, h] = A.skyViewSize,
      table = new Float32Array(w * h * 3),
      m = new Float64Array(9),
      sunT: Rgb = [0, 0, 0],
      psi: Rgb = [0, 0, 0],
      r0 = RB + A.cameraHeight,
      sunElevation = Math.asin(Math.min(1, Math.max(-1, this.sun.y))),
      sunX = Math.cos(sunElevation),
      sunY = Math.sin(sunElevation),
      steps = 24;
    for (let j = 0; j < h; j++) {
      const v = j / (h - 1),
        elevation = v * v * (Math.PI / 2),
        cosEl = Math.cos(elevation),
        dy = Math.sin(elevation),
        length = sphereExit(r0, dy, RT);
      for (let i = 0; i < w; i++) {
        const azimuth = (i / (w - 1)) * Math.PI,
          dx = cosEl * Math.cos(azimuth),
          dz = cosEl * Math.sin(azimuth),
          nu = dx * sunX + dy * sunY,
          rayleigh = rayleighPhase(nu),
          mie = miePhase(nu);
        let l0 = 0,
          l1 = 0,
          l2 = 0,
          th0 = 1,
          th1 = 1,
          th2 = 1;
        for (let s = 0; s < steps; s++) {
          // Quadratic sample distribution: dense near the camera.
          const t0 = (s / steps) ** 2 * length,
            t1 = ((s + 1) / steps) ** 2 * length,
            dt = t1 - t0,
            t = t0 + 0.3 * dt;
          const px = dx * t,
            py = r0 + dy * t,
            pz = dz * t,
            pr = Math.sqrt(px * px + py * py + pz * pz);
          medium(pr - RB, this.medium.haze, m);
          const mu = (px * sunX + py * sunY) / pr;
          this.medium.sunTransmittance(pr, mu, sunT);
          this.medium.multipleScattering(pr, mu, psi);
          const r0s = m[0] * rayleigh + m[6] * mie,
            r1s = m[1] * rayleigh + m[7] * mie,
            r2s = m[2] * rayleigh + m[8] * mie,
            e0 = Math.max(m[3], 1e-12),
            e1 = Math.max(m[4], 1e-12),
            e2 = Math.max(m[5], 1e-12),
            q0 = Math.exp(-e0 * dt),
            q1 = Math.exp(-e1 * dt),
            q2 = Math.exp(-e2 * dt);
          l0 += (th0 * (sunT[0] * r0s + psi[0] * (m[0] + m[6])) * (1 - q0)) / e0;
          l1 += (th1 * (sunT[1] * r1s + psi[1] * (m[1] + m[7])) * (1 - q1)) / e1;
          l2 += (th2 * (sunT[2] * r2s + psi[2] * (m[2] + m[8])) * (1 - q2)) / e2;
          th0 *= q0;
          th1 *= q1;
          th2 *= q2;
        }
        const o = (j * w + i) * 3;
        table[o] = l0;
        table[o + 1] = l1;
        table[o + 2] = l2;
      }
    }
    return table;
  }
  /** Sky radiance (per unit TOA irradiance) for a world direction; directions
   * below the horizon return the horizon. */
  radiance(direction: T.Vector3, out: Rgb = [0, 0, 0]) {
    const d = direction,
      length = Math.hypot(d.x, d.y, d.z) || 1,
      y = d.y / length;
    const elevation = Math.asin(Math.min(1, Math.max(0, y)));
    // Azimuth from the sun in the horizontal plane.
    const hx = d.x,
      hz = d.z,
      sx = this.sun.x,
      sz = this.sun.z,
      h1 = Math.hypot(hx, hz),
      h2 = Math.hypot(sx, sz);
    const cosAz = h1 > 1e-9 && h2 > 1e-9 ? (hx * sx + hz * sz) / (h1 * h2) : 1;
    const azimuth = Math.acos(Math.min(1, Math.max(-1, cosAz)));
    const [w, h] = A.skyViewSize;
    return bilinear(this.skyView, w, h, skyViewU(azimuth), skyViewV(elevation), out);
  }
  private hemisphereMean(cosine: boolean): Rgb {
    const [w, h] = A.skyViewSize,
      sum: Rgb = [0, 0, 0];
    let weights = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const elevation = ((i + 0.5) / N) * (Math.PI / 2),
        v = skyViewV(elevation),
        weight = Math.cos(elevation) * (cosine ? Math.sin(elevation) : 1);
      for (let j = 0; j < 2 * N; j++) {
        const u = (j + 0.5) / (2 * N);
        const c = bilinear(this.skyView, w, h, u, v, [0, 0, 0]);
        for (let k = 0; k < 3; k++) sum[k] += c[k] * weight;
        weights += weight;
      }
    }
    return sum.map((c) => c / weights) as Rgb;
  }
  /** The sky view as a linear, half-float RGBA texture (u: azimuth from the
   * sun, v: sqrt(elevation / 90 degrees)). Created once, owned by this sky. */
  get skyViewTexture() {
    if (this.texture) return this.texture;
    const [w, h] = A.skyViewSize,
      data = new Uint16Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 3; k++) data[i * 4 + k] = T.DataUtils.toHalfFloat(this.skyView[i * 3 + k]);
      data[i * 4 + 3] = T.DataUtils.toHalfFloat(1);
    }
    const texture = new T.DataTexture(data, w, h, T.RGBAFormat, T.HalfFloatType);
    texture.colorSpace = T.LinearSRGBColorSpace;
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.wrapS = T.ClampToEdgeWrapping;
    texture.wrapT = T.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.name = 'Atmosphere sky view';
    texture.needsUpdate = true;
    this.texture = texture;
    return texture;
  }
  dispose() {
    this.texture?.dispose();
    this.texture = null;
  }
}

/** Sun-disc limb darkening, I(mu) / I(1) = mu^alpha per channel (power-law
 * fit to Neckel & Labs 1994 at 680, 550 and 440 nm), for mu the cosine of the
 * angle between the disc normal and the line of sight: the limb is dimmer and
 * redder than the centre. */
export const LIMB_DARKENING = Object.freeze({
  alpha: Object.freeze([0.397, 0.503, 0.652] as const),
});
export function limbDarkening(mu: number, out: Rgb = [0, 0, 0]) {
  const m = Math.min(1, Math.max(0, mu));
  for (let k = 0; k < 3; k++) out[k] = Math.pow(m, LIMB_DARKENING.alpha[k]);
  return out;
}

const media = new Map<number, AtmosphereMedium>();
const skies = new Map<string, AtmosphereSky>();
/** Shared, cached medium of a haze (quantized to 1/100). */
export function atmosphereMedium(haze: number) {
  const key = Math.round(haze * 100) / 100;
  let value = media.get(key);
  if (!value) {
    value = new AtmosphereMedium(key);
    if (media.size > 12) media.clear();
    media.set(key, value);
  }
  return value;
}
/** Shared, cached sky of a haze and sun direction. The texture of an evicted
 * sky is disposed: callers hold skies only for the frame that binds them. */
export function atmosphereSky(haze: number, sun: T.Vector3) {
  const medium = atmosphereMedium(haze),
    s = sun.clone().normalize();
  const key = `${medium.haze}:${s.x.toFixed(5)},${s.y.toFixed(5)},${s.z.toFixed(5)}`;
  let value = skies.get(key);
  if (!value) {
    value = new AtmosphereSky(medium, s);
    if (skies.size >= 16) {
      const [oldest] = skies.keys();
      skies.get(oldest)!.dispose();
      skies.delete(oldest);
    }
    skies.set(key, value);
  }
  return value;
}

export function luminance(c: readonly number[]) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
