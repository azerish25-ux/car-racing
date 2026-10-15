import { Vec3 } from '../core/math.ts';
import { RigidBody } from './rigid.ts';
import { SURFACE, surfaceSample, type Track } from './track.ts';

/** Original reduced compliant floor calibration, not measured skid material
 * data. The four supports share the prior total stiffness/damping; unlike a CG
 * spring, the actual footprint supports pitch/roll and reacts to local kerbs.
 * Distances: m; stiffness: N/m; damping: N s/m; friction: dimensionless.
 */
export const SKID_CONTACT = Object.freeze({
  height: -0.43,
  halfWidth: 0.55,
  front: 1.45,
  rear: -1.45,
  stiffness: 1_100_000,
  damping: 14_000,
  friction: 0.06,
  probeLift: 1,
  probeLength: 3,
  wearWorkJ: 100_000_000,
});
export const SKID_POINTS = [
  [-SKID_CONTACT.halfWidth, SKID_CONTACT.height, SKID_CONTACT.front],
  [SKID_CONTACT.halfWidth, SKID_CONTACT.height, SKID_CONTACT.front],
  [-SKID_CONTACT.halfWidth, SKID_CONTACT.height, SKID_CONTACT.rear],
  [SKID_CONTACT.halfWidth, SKID_CONTACT.height, SKID_CONTACT.rear],
] as const;

/** Per-vehicle, allocation-free unilateral contact solve. Forces are accumulated
 * at surface points; no chassis pose/velocity override. Work is dissipated watts,
 * not a cosmetic collision flag. The spark anchor is the actual strongest hard
 * contact, not an interpolated point in the empty space between two contacts.
 */
export class SkidContact {
  contacts = 0;
  normalLoad = 0;
  slidingPower = 0;
  dampingPower = 0;
  sparkPower = 0;
  slidingWorkJ = 0;
  totalWorkJ = 0;
  sparkWorkJ = 0;
  surface = SURFACE.ASPHALT as number;
  readonly point = new Vec3();
  readonly normal = new Vec3(0, 1, 0);
  readonly velocity = new Vec3();
  private local = new Vec3();
  private pad = new Vec3();
  private origin = new Vec3();
  private down = new Vec3(0, -1, 0);
  private contact = new Vec3();
  private speed = new Vec3();
  private tangent = new Vec3();
  private force = new Vec3();
  private lever = new Vec3();
  private cross = new Vec3();
  private inertia = new Vec3();
  private sample = surfaceSample();
  /** Pad positions in body coordinates; the Formula floor by default. A
   * catalogue vehicle supplies its own floor plane and footprint. */
  constructor(private readonly points: readonly (readonly number[])[] = SKID_POINTS) {}

  apply(body: RigidBody, track: Pick<Track, 'cast'>, dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(body.mass) || body.mass <= 0)
      throw new Error('Invalid skid-contact timestep or mass');
    this.contacts = this.normalLoad = this.slidingPower = this.dampingPower = this.sparkPower = 0;
    let strongestSpark = 0;
    for (const coordinates of this.points) {
      this.local.set(coordinates[0], coordinates[1], coordinates[2]);
      body.orientation.rotate(this.local, this.pad).add(body.position);
      this.origin.copy(this.pad);
      this.origin.y += SKID_CONTACT.probeLift;
      const distance = track.cast(this.origin, this.down, SKID_CONTACT.probeLength, this.sample);
      if (distance === Infinity) continue;
      if (!Number.isFinite(distance) || distance < 0 || !this.sample.normal.finite())
        throw new Error('Invalid skid surface query');
      const n = this.sample.normal;
      if (Math.abs(n.length() - 1) > 1e-5 || n.y <= 0)
        throw new Error('Invalid skid surface normal');
      this.contact.copy(this.origin).addScaled(this.down, distance);
      const penetration = (this.contact.y - this.pad.y) * n.y;
      if (penetration <= 0) continue;
      body.pointVelocity(this.contact, this.speed);
      const vn = this.speed.dot(n);
      const spring = (SKID_CONTACT.stiffness * penetration) / this.points.length;
      const damping = SKID_CONTACT.damping / this.points.length;
      const load = Math.max(0, spring - damping * vn);
      if (load === 0) continue; // No attractive force while a pad separates.
      this.tangent.copy(this.speed).addScaled(n, -vn);
      const slidingSpeed = this.tangent.length();
      let friction = 0;
      if (slidingSpeed > 1e-9) {
        this.tangent.scale(1 / slidingSpeed);
        this.lever.copy(this.contact).sub(body.position);
        this.cross.cross(this.lever, this.tangent);
        body.inverseInertia(this.cross, this.inertia);
        const inverseMass = 1 / body.mass + this.cross.dot(this.inertia);
        // All four friction requests see the same pre-integration velocity.
        // Dividing the stop impulse by the number of pads conservatively bounds
        // their combined work (including rotational coupling); no reversal at rest.
        friction = Math.min(
          SKID_CONTACT.friction * load,
          slidingSpeed / (this.points.length * dt * inverseMass),
        );
      }
      this.force.copy(n).scale(load).addScaled(this.tangent, -friction);
      if (!this.force.finite()) throw new Error('Non-finite skid contact force');
      body.apply(this.force, this.contact);
      this.contacts++;
      this.normalLoad += load;
      const slideWork = friction * slidingSpeed;
      this.slidingPower += slideWork;
      this.dampingPower += damping * vn * vn;
      const hard = this.sample.surface !== SURFACE.GRASS && this.sample.surface !== SURFACE.GRAVEL;
      if (hard) this.sparkPower += slideWork;
      // Strict > gives stable pad identity at equal loads. Soft ground cannot
      // displace the actual hard-surface spark anchor in a mixed contact.
      const score = hard ? slideWork : 0;
      if (score > strongestSpark) {
        strongestSpark = score;
        this.point.copy(this.contact);
        this.normal.copy(n);
        this.velocity.copy(this.speed);
        this.surface = this.sample.surface;
      }
    }
    this.slidingWorkJ += this.slidingPower * dt;
    this.sparkWorkJ += this.sparkPower * dt;
    const dissipatedPower = this.slidingPower + this.dampingPower;
    this.totalWorkJ += dissipatedPower * dt;
    return dissipatedPower;
  }
}
