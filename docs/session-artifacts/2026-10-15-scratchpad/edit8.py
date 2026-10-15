import re
p='src/simulation/offroad/profile.ts'
s=open(p).read()
old="""      this.push(deckEnd, landH, o.kind === 'crest' ? 4 : 0.6);
      end = deckEnd + down;
      this.push(end, 0, 1.4);"""
new="""      this.push(deckEnd, landH, o.kind === 'crest' ? 4 : 1.0);
      end = deckEnd + down;
      this.push(end, 0, 2.4);"""
assert old in s; s=s.replace(old,new)
old="""      this.push(gapEnd, landH, 0.45);
      end = gapEnd + down;
      this.push(end, 0, 1.4);"""
new="""      // A rounded knuckle and a long run-out transition at the foot.
      this.push(gapEnd, landH, 1.0);
      end = gapEnd + down;
      this.push(end, 0, 2.4);"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/simulation/offroad/venues.ts'
s=open(p).read()
for a,b in [("gap: 15, landingHeight: 2.4","gap: 15, landingHeight: 2.8"),
            ("gap: 18, landingHeight: 2.1","gap: 18, landingHeight: 2.5"),
            ("gap: 14, landingHeight: 2.3","gap: 14, landingHeight: 2.7"),
            ("gap: 17, landingHeight: 1.8","gap: 17, landingHeight: 2.2"),
            ("gap: 11, landingHeight: 1.7","gap: 11, landingHeight: 2.0"),
            ("gap: 17, landingHeight: 1.9","gap: 17, landingHeight: 2.2")]:
    assert a in s, a; s=s.replace(a,b)
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    this.rutBias = approach(this.rutBias, this.biasTarget, dt * 1.2);
    super.update(dt, track, cars, race);
  }"""
new="""    this.rutBias = approach(this.rutBias, this.biasTarget, dt * 1.2);
    super.update(dt, track, cars, race);
    this.governJump(track);
  }
  /** On the last metres to a lip a rider meters the speed with a firm hand
   * (the general controller's proportional pedal settles below its target)
   * and drives up the face rather than coasting it. */
  private governJump(track: Track) {
    const c = this.rider,
      plan = this.plan,
      input = c.input;
    if (!plan?.clear || !c.riding || c.airborne || input.reverse) return;
    const j = plan.jump,
      run = mod(j.takeoff - c.s, track.length);
    if (run > 28 || run > track.length / 2) return;
    const onFace = run < j.takeoff - j.start + 0.5,
      e = c.aiTarget - c.speed;
    if (onFace) {
      input.throttle = clamp(0.2 + 0.5 * Math.max(0, e), 0, 1);
      input.brake = 0;
    } else {
      input.throttle = clamp(0.25 + 0.9 * e, 0, 1);
      input.brake = clamp(-0.35 * e, 0, 1);
    }
  }"""
assert old in s; s=s.replace(old,new)
old="""    if (onFace) return Math.min(desired, Math.max(lip, c.speed - 0.2));"""
new="""    if (onFace) return Math.min(desired, Math.max(lip, c.speed));"""
assert old in s; s=s.replace(old,new)
s=s.replace("const hold = jumpHoldSpeed(j) + 0.1,","const hold = jumpHoldSpeed(j),")
open(p,'w').write(s)
