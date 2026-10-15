# Physics model (simulation version 2)

This is the engineering reference for the vehicle physics behind every car in a session: tyres,
suspension, drivetrain, aerodynamics, ground materials and integration. Every coefficient is an
original engineering calibration. None is a manufacturer data set, a fitted test-rig curve or CFD.
The model stays deterministic: no randomness, no wall clock, fixed iteration counts, and an
allocation-free hot path. It runs inside the existing 120 Hz worker tick with two 240 Hz vehicle
substeps.

`SIMULATION_VERSION` is **2** (`src/core/session-identity.ts`). Lap times can change, so under
decision D8 records, ghosts and boards are split by physics version. Version-1 records stay readable
but compete only with version-1 records. Pre-identity saves still read as version 1. Replays from
version 1 remain presentation replays; deterministic resimulation (flashback) only ever re-runs the
current version.

## Module map

| Module | Responsibility |
|---|---|
| `tyre-force.ts` | Pure-slip curves, slip stiffness, combined-slip weighting, camber, pressure, relaxation |
| `tyre-thermal.ts` | Three-node (surface/carcass/core) thermal network, hot pressure |
| `tire.ts` | Tyre state, peak friction, implicit wheel-spin solve, wear/damage, ground contact terms |
| `suspension.ts` | Massless-hub corners: springs, stops, dampers, bars, tyre radial; kinematics; geometric load transfer |
| `powertrain.ts` | Engine torque map, throttle lag, turbo, friction/pumping; gearbox shift time |
| `differential.ts` | One module: the catalogue driveline (open/LSD/locked axles, AWD centre, `distributeDrive`) and the stick-torque model (open, spool, viscous, clutch-pack LSD, Torsen) |
| `aero.ts`, `aero-map.ts` | Ride-height/pitch map, floor centre of pressure, convective lag, plunge damping, dirty air, slipstream |
| `surface-material.ts` | Ground material table: friction, wetting, slip stiffness, sinkage, compaction, bulldozing, water drag |
| `vehicle-dynamics.ts` | Per-vehicle parameter blocks resolved from a `VehicleDefinition` |
| `vehicle.ts` | Call sites: substep cap, order of operations, force application |

`VehicleDefinition.dynamics` (optional) overrides any block for one vehicle. Without it,
`vehicleDynamics()` picks a package, so a newly added definition is always complete. The blocks are
frozen data, and the resolved object is cached per definition. The packages are:

* **APX-01 (`formula`) and TC-1 (`touring`):** the calibrated packages described below.
* **Catalogue cars and motorcycles** (every `vehicle-catalogue/` sheet names a `tireFamily`; bikes
  have `dynamicsKind: 'bike'`): a neutral package that keeps the behaviour their sheets were fitted
  against. It has:
  * the legacy-reproducing suspension geometry (`defaultSuspension()`);
  * legacy throttle response and 0.09 s shifts;
  * the former aero platform and wake (`NEUTRAL_AERO_DYNAMICS`);
  * a tyre carcass by family: the Formula slick for `formula-slick`, otherwise `FAMILY_CARCASS`.
    That is the closed-wheel carcass at the Formula slick's 2200 N load reference, because
    `tireGrip` is relative to the Formula slick at that load.

  Their power unit (`spec.engine`) and driveline come from the sheet. They share the combined-slip
  law, thermal model, hub suspension, ground materials and integration with everything else.

The vehicle field holding the resolved package is `Vehicle.physics`; `BikeVehicle` uses `dynamics`
for its own two-wheel state.

## 0. Integration

* **Substep cap.** `Vehicle.step(dt)` splits any call longer than `MAX_SUBSTEP = 1/240 s` into equal
  substeps. A 60, 120 or 240 Hz caller therefore integrates identical physics (calibration timestep
  drift is now at most 0.2%; it was up to 5.2% before). The world already steps at 240 Hz, so in-game
  behaviour is unchanged.
* **Rigid body.** As before: semi-implicit Euler for translation; for rotation a kick/drift/kick
  scheme with an implicit midpoint Euler free-body drift (`rigid.ts`).
* **Stiff internal states are implicit or exact:**

| State | Scheme | Property |
|---|---|---|
| Wheel spin ω | backward Euler, bracketed bisection (unchanged) | brake cannot reverse a wheel |
| Hub travel (tyre radial + suspension) | backward Euler, Newton per corner, Gauss–Seidel for the bar | unconditionally stable with a 5 MN/m tyre at 1/30 s |
| Tyre temperatures | backward Euler on a 3×3 tridiagonal M-matrix | conserves heat exactly with losses closed; never overshoots |
| Slip relaxation, intake, turbo, aero lag, sinkage | exact first-order exponential | no overshoot at any step |
| Differential locking | stick torque with road-reaction feedforward, under-relaxed feedback | a locked axle stays synchronized at 60 Hz |

* **Operator splitting order per substep:** controls → engine/clutch → differential → hub solve
  (suspension and tyre radial) → kinematics → tyre solves (forces into the body) → aero (lagged
  heights, plunge damping, floor centre of pressure) → floor/skid contact → jacks → body integration.
  Geometric load transfer uses the previous substep's tread forces (4.2 ms lag).
* **Regression tests at multiple rates** (`tests/integrator-stability.test.ts`):
  * A drop onto springs and tyres never gains energy at 60, 120 or 240 Hz, and settles to the same
    height within 1 mm.
  * Coasting energy falls monotonically.
  * Stopping distance agrees within 1% across rates, and step-steer yaw within 2%.
  * Kerb strikes at 60 Hz stay bounded.
  * Porpoising check (`tests/aero-platform.test.ts`): a heave disturbance at the floor's stall knee
    decays at every rate.

## 1. Tyre

### 1.1 Pure slip

Magic-Formula shape on a normalized slip:

```
F0(σ) = D · sin(C · atan(X − E·(X − atan X))),   X = X0·σ,   X0 = tan(π / 2C)
σx = κ / κ*,   σy = α / α*,   κ* = X0x·Cx·Dx / Kx,   α* = X0y·Cy·Dy / Kα
```

κ is the longitudinal slip ratio, (ωr − v)/max(2.5, |v|). α is the slip angle,
atan2(v_y, hypot(v_x, 3)). Both keep the former low-speed regularization. With E = 0 the peak sits
at σ = 1.

* **Peak force** `D = μ·Fz`, with μ from `peakGrip()`. The factors are:
  * compound μ and tyre-family scale;
  * load sensitivity `(Fz/Fz0)^−0.105`;
  * grip window at the blended temperature `0.3·T_surface + 0.7·T_carcass`;
  * water film penalty and aquaplaning (§5.3);
  * wear `(1 − 0.5·wear)`;
  * dirt, flat spots, blistering/graining and puncture;
  * contact-patch pressure optimum `1 − 0.12·((p − 165)/65)²`;
  * laid rubber and marbles;
  * the ground material's friction and wetting (§5).
* **Slip stiffness is a carcass property.**

  ```
  Kα = kα·Fz·(Fz/Fz0)^−0.12 · (μ/μref)^0.6 · Π(p, wear, T) · k_ground
  Kx = kx·Fz·(μ/μref)^0.6 · Π(p, wear, T) · k_ground
  ```

  * The cornering stiffness saturates with load, so the peak slip angle grows with load.
  * The longitudinal stiffness stays proportional to load (the usual MF result).
  * On lower friction the peak slip is smaller, as the brush model predicts: on ice the peak arrives
    at under half the dry slip.
  * Π combines three factors:
    * pressure, `1 + 0.25·Δp/p0`;
    * wear, `1 + 0.15·wear` (shorter tread blocks are stiffer);
    * cold rubber, `1 + 0.0015·(T_ideal − T_carcass)`.
* **Former shape kept at nominal conditions.** At Fz0, μref, dry asphalt and nominal pressure the
  APX-01 slick reproduces the former pure curves exactly (B = 7.2/10.5, C = 1.28/1.3, E = 0.15). A
  unit test checks this against the former formula.

### 1.2 Combined slip

Magic-Formula 5.2 weighting with C = 1, applied to the normalized slips and bounded by the friction
ellipse:

```
Fy = Gyκ·Fy0(σy),  Gyκ = 1/√(1 + (By·σx)²),  By = by1·k_c/√(1 + (by2·σy)²)
Fx = Gxα·Fx0(σx),  Gxα = 1/√(1 + (Bx·σy)²),  Bx = bx1·k_c/√(1 + (bx2·σx)²)
if (Fx/Dx)² + (Fy/Dy)² > 1: scale both onto the ellipse
```

by1 = bx1 = 0.7 and by2 = bx2 = 0.6, which gives:

* A spinning tyre (κ = 5) keeps less than 15% of its cornering force.
* Drive slip at 30% of the peak slip costs it 2–3%.
* Every force stays inside the ellipse.

`k_c` is the ground coupling (§5). On loose ground part of the lateral resistance is rut-wall
ploughing, which wheelspin does not remove.

Calibration note: an isotropic normalized-slip (brush) combination was implemented first. It
removes about 26% of cornering stiffness at 30% of peak drive slip. That made the field's
path-following AI and the scripted journey driver unstable on wet slicks and loose ground (weaving,
power spins). The MF weighting keeps saturation physics and a moderate interior coupling.

### 1.3 Camber

* **Thrust** is an equivalent slip-angle shift, `α_eff = α − Cγ·γ·s(v)/Kα`. Cγ is 0.35·Fz per rad
  (0.45 on TC-1). The factor `s(v) = smooth(0.3, 3, |v|)` makes it build only while rolling. Because
  it is a shift, the thrust saturates with the lateral force.
* **Patch factor** `1 − kγ·(γ − γopt·ι)²`, where ι = −tanh(2·σy) is the direction of the lateral
  force:
  * the optimum inclination leans into the force (γopt = 0.03 rad Formula, 0.045 TC-1);
  * straight running prefers none;
  * D, κ* and α* are scaled together, so slip stiffness is unchanged.
* **γ is road-relative.** It is the kinematic camber (static plus camber gain, §2) minus the chassis
  roll measured against the contact normal.

### 1.4 Transient slip (relaxation length)

```
dα_r/dt = (|v_x|/σ)·(α_ss − α_r),   integrated exactly: α_r ← α_ss + (α_r − α_ss)·e^(−|v_x|·dt/σ)
σ = σ0·√(Fz/Fz0)·(1 − 0.35·Δp/p0)·(1 − 0.3·wear)·smooth(3, 12, |v_x|)
```

σ0 is 0.32 m on the Formula slick and 0.42 m on the touring slick. Below 3 m/s the lag is removed:
the deflection mode has no damping there, and the regularized slip already acts as a damper.
Longitudinal transients come from the implicit wheel inertia solve, not a second relaxation state.

### 1.5 Pressure

The hot pressure p comes from the core temperature (§1.6). It enters:

* contact-patch grip (§1.1);
* slip stiffness;
* relaxation length;
* radial stiffness, `k_t·(1 + 0.7·Δp/p0)`, which changes the effective ride rate (§2);
* rolling resistance `c_rr·(p0/p)^0.3`;
* aquaplaning onset `V ∝ √p` (§5.3).

The patch length `l = 2·√(2r·(δ + z))` comes from the radial deflection δ and sinkage z. It feeds
sinkage pressure and compaction resistance.

### 1.6 Three-node thermal model

Nodes: tread surface S (9 kJ/K, ×(1 − 0.4·wear)), carcass C (52 kJ/K), and core G (inflation gas
and liner, 7 kJ/K).

```
C_S·dT_S/dt = 0.62·P_slip + 0.4·P_roll − 85(T_S−T_C) − (12+1.25v)(T_S−T_air) − 8(T_S−T_track)
              − w(130+0.6v)(T_S−T_air)
C_C·dT_C/dt = 0.6·P_roll + 85(T_S−T_C) − 30(T_C−T_G) − (4+0.08v)(T_C−T_air)
C_G·dT_G/dt = 30(T_C−T_G) − (2+0.05v)(T_G−T_air) + 0.6(T_disc−T_G)
P_slip = |Fx·v_sx| + |Fy·v_sy|,   P_roll = 0.0012·Fz·|v|,   w = water depth (mm)
p_hot = (p_cold + 101.325)·(T_G + 273.15)/(T_set + 273.15) − 101.325     (absolute-pressure gas law)
```

* The track and water terms act only while the tyre is loaded.
* Brake heat reaches the gas through the rim.
* Rain cools the surface directly.
* The grip window is evaluated at `0.3·T_S + 0.7·T_C`.
* Wear thins the tread, so a worn tyre heats faster.
* Blistering and graining follow the surface and carcass windows, as before.
* The network was calibrated against the former two-node model on an Aurel AI lap: mean surface
  within 1.5 K, carcass within 0.7 K, hot pressure within 1.5 kPa.

## 2. Suspension

Each corner is a **massless hub** between the chassis and the tyre. X is the geometric compression
from the contact query and x the hub travel (+ bump).

```
k_t(p)·(X − x) + c_t·(Ẋ − ẋ) = k_w·x·(1 + ½·prog·x/travel) + k_stop·max(0, x − g)² + D(ẋ) + k_bar·(x − x_other)
D(v) = c_b·v  (bump, v ≤ v_kb),  c_b·v_kb + r_b·c_b·(v − v_kb)  above the knee;  rebound alike
```

* The equation is solved by backward Euler (§0).
* The tyre cannot pull. If the patch would go into tension, the free-hub equation is solved instead.
* Hub extension is limited by a droop strap.

**Setup values are ride values at the contact patch.** Setup springs, anti-roll bars and the
definition's dampers are what a seven-post rig measures (wheel and tyre in series). The module
derives the hardware at the tyre's nominal radial stiffness:

* `k_w = k_r·k_t/(k_t − k_r)`;
* bar rates by the same inversion of `k_r + 2·k_arb`;
* dampers ×1/s² with `s = k_t/(k_t + k_w)`;
* the stop gap ×s.

So static and quasi-static ride heights, roll and pitch reproduce the former model, and existing
setups keep their meaning. Pressure changes then alter the effective rates physically. The former
damping (4800 bump / 6200 rebound N s/m) gains a digressive knee: 0.2/0.25 m/s, with high-speed
ratios 0.55/0.7.

**Kinematics.**

* Camber gain (rad of negative camber per m of bump; Formula 0.3/0.2, TC-1 0.55/0.35) and bump steer
  act on hub travel.
* `kinematicCamber = (γ_static − gain·x)·side` is what the snapshot's W.CAMBER now reports.
* The tyre uses the road-relative value (§1.3).

**Load transfer.** Tread forces still enter the chassis at `VehicleSpec.linkCentreHeight` above the
patch. This is the calibrated correction between the rigid body's reference point (about 0.52 m
above the road) and the effective roll/pitch mass centre. It keeps total load transfer at its
calibrated value and the car sliding rather than rolling over at full lock.

Roll-centre height and side-view anti geometry then split that transfer into:

* an elastic share (springs and bars: body roll and pitch);
* a geometric share that the links put straight into the tyre loads:

```
ΔN_i = −(h_rc/y_i)·Fy_i − tanθ·Fx_i·sign(z_i),   h_rc = h0 + gain·mean axle travel
Σ y_i·ΔN_i = −h_rc·ΣFy   (moment-equivalent: the total transfer is unchanged)
```

* Jacking appears whenever the outer and inner forces differ.
* Formula: roll centres 0.03 m front and 0.06 m rear (dropping 0.3 m per m of squat); anti-dive
  tanθ 0.012 (about 25%), anti-squat 0.022.
* TC-1: roll centres 0.05/0.08 m, front anti-lift 0.015.
* With roll centres, the production car rolls measurably less while its total lateral load transfer
  stays within 10% (unit test).

**Tyre radial stiffness:** 330 kN/m Formula, 260 kN/m TC-1, pressure dependent, with radial damping
350/300 N s/m. W.COMPRESSION and LENGTH keep their former geometric meaning. Hub travel is
`vehicle.hub.travel`; tyre deflection is `tire.deflection`.

## 3. Drivetrain

**Engine** (`powertrain.ts`):

```
T = map(rpm, θ_eff)·(1 − b + b·boost) − c_pump·(1 − θ_eff)·ω − (a + c·ω)         (friction via the clutch)
θ_eff: exact first-order lag, τ_open / τ_close   (Formula 0.02/0.035 s, TC-1 0.045/0.06 s)
boost: τ = spool time building, × dump fraction decaying; target smooth(rpm_lo, rpm_hi, rpm)·θ_eff
```

* The map is the definition's full-load curve times θ^progression, or an explicit rpm × throttle
  table (bilinear).
* Pumping loss is 0.01 N m s on the Formula car and 0.03 on TC-1.
* Crank inertia comes from the block: 0.34 Formula, 0.21 TC-1.
* Turbo lag is available. Neither original car uses it (the Formula car's energy recovery removes
  lag). Four catalogue cars whose briefs name it do (`CatalogueSheet.turbo` on the legacy engine
  block): HF-86 (boost share 0.55, spool 0.8 s), GB-4 (0.5, 0.5 s), RR-4 (0.4, 0.45 s) and PR-3
  (0.4, 0.3 s), dump fraction 0.3–0.35. Their spool thresholds sit below the working range, so the
  steady full-load curve is unchanged and the lag is the transient after a lift.

**Gearbox:**

* Shift time is per definition: Formula 0.06 s (formerly 0.09), TC-1 0.11 s.
* The cut fraction is 1 for a dog box; 0 makes the box seamless, so the clutch stays engaged.

**Differentials** (`differential.ts`, a single module):

* **Catalogue drivelines.** A definition with a `driveline` (open/`lsd()`/locked axles, an AWD
  centre with `frontShare`) runs through `distributeDrive()`. That path is the catalogue's own
  calibrated equal-speed projection, limited by `lockingCapacity()`, and is unchanged by this work.
  It also feeds the AWD carrier speed (`carrierOmega()`) to the clutch.
* **Everything else** runs the stick-torque model below. `fromSpec()` converts a catalogue
  `DifferentialSpec` into it with the same capacity (unit test), so either content form can drive
  either path.

```
first = s·T + L,  second = (1−s)·T − L
open: L = 0      locked: L = β·L_stick      viscous: L = clamp(c·Δω, ±L_max)
clutch LSD: L = clamp(β·L_stick, ±(preload + ramp·|T|)), ramp = power or coast by sign(T)
Torsen: L = clamp(β·L_stick, ±½|T|·(TBR−1)/(TBR+1))
L_stick = (β·Δω + dt·(((1−s)T + R2)/I2 − (sT + R1)/I1)) / (dt·(1/I1 + 1/I2))
```

* R1 and R2 are the road reaction torques predicted from the previous step (−Fx·r), since the tyres
  are solved after the differential.
* β under-relaxes only the speed-difference feedback.
* Setup diffPower/diffCoast scale the locking around the definition's values.
* `resolveDifferential()` also accepts model names ('open', 'locked'/'spool', 'lsd'/'clutch',
  'viscous', 'torsen') and catalogue specs, so another content source can declare one.
* The stick-torque presets are `OPEN_AXLE`, `SPOOL`, `CLUTCH_LSD`, `TORSEN` and `LEGACY_AXLE`. The
  names `OPEN` and `LOCKED` belong to the catalogue specs.
* `drivelineTorques()` composes a stick-torque centre differential (share `split` to the front) with
  the axle differentials for 'rwd', 'fwd' or 'awd'.
* **Defaults kept:** APX-01 and TC-1 use `LEGACY_AXLE`, the former viscous coupling
  (55·setting N m s/rad, capped at 1050 N m). It is reproduced exactly (unit test).

## 4. Aerodynamics

* **Map.** The existing 9×9 front/rear ride-height floor table and pitch responses
  (`aero-map.ts`).
* **Floor centre of pressure** (`AeroDynamics`):

  ```
  z_cp = z0 + k_pitch·(pitch − pitch_ref) + k_h·(h_mean − h_ref)
  ```

  On the Formula car k_pitch is −4 m/rad and k_h −1.5 m/m, bounded to ±1.5 m. It moves forward as
  the nose drops or the floor nears the ground, which gives rake and heave balance sensitivity. The
  floor load is applied there (previously at the mass centre).
* **Convective lag.** The underbody flow sees ride heights lagged by L/V: exact lag, L = 0.5 m
  Formula, 0.4 m TC-1.
* **Plunge damping (porpoising safety).** Each axle station gets `F = −½ρV·S·ż` (S = 3 m² Formula,
  1.2 m² TC-1). Without it, a lag in the floor's stall region adds negative heave damping. Measured:
  a 0.6 m/s heave kick at a 4.5 cm ride on 90 kN/m springs at 270 km/h decays below 10% within 2.5 s
  at 60, 120 and 240 Hz.
* **Wake.**
  * **Dirty air** keeps the existing `wakeOverlap` volume. It reduces front, rear and floor load.
  * **Slipstream** is a separate channel, `slipstreamOverlap`: longer (decay length 70 m) and
    narrower (radius 1.0 + 0.022·d m). It reduces drag only: `aero(..., tow)` gives
    `drag·(1 − 0.16·tow)`.
  * Each leader scales both channels by its body: the TC-1 throws 30% of the Formula car's dirty air
    and tows 1.15× as well.
  * Both channels are exactly zero beyond 100 m, so the world's 101 m proximity cull stays exact
    (property test).
  * `wakeFields()` in `aero.ts` computes both for the world loop.
* **Fan-assisted floor** (`VehicleDefinition.fan`, only the experimental XF-2). An auxiliary
  engine's fans evacuate a skirted floor, so the suction does not scale with V²: `F_fan =
  F·clamp(1 − (h − h_seal)/fade, 0, 1)·floorHealth`, applied at the fan station with the measured
  (not flow-lagged) mean floor clearance, because the skirts leak the moment the floor lifts. XF-2:
  F = 7 kN, h_seal = static clearance + 12 mm, fade 50 mm. It is reported apart from ClA
  (`aero.fanN` in `docs/vehicle-calibration.json`). Every other definition lacks the field, so their
  physics and content hashes are unchanged.
  * The AI envelope separates the fan's share of its base limits (`CapabilityEnvelope.fanBase`):
    the calibration fits the lateral and braking envelopes again with the fan removed, and the
    difference of the bases is the share (`fanEnvelopeShare` in the report; XF-2 7.63 m/s² lateral,
    12.80 m/s² braking). `floorEnvelope` in `ai.ts` scales that share with floor health, as the
    solver scales the suction, so a damaged XF-2 plans its braking on the grip it has left.

## 5. Ground materials

`MATERIALS` (`surface-material.ts`), indexed by surface id. Ids 0–5 are the circuit ids in snapshots;
6–10 are new.

| id | material | μ | wet μ factor | stiffness | fall-off | coupling | rigid c_rr | sink modulus / max | bulldoze (static / v²) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | asphalt | 1 | 1 | 1 | 1 | 1 | 0.015 | — | — |
| 1 | paint | 0.94 | 0.82 | 1 | 1.1 | 1 | 0.015 | — | — |
| 2 | kerb | 0.91 | 0.86 | 0.95 | 1.05 | 1 | 0.015 | — | — |
| 3 | grass | 0.53 | 0.85 | 0.7 | 0.8 | 0.35 | 0.06 | 6 MPa/m, 20 mm | 6 kN/m², 2 |
| 4 | gravel | 0.40 | 0.95 | 0.45 | 0 | 0.25 | 0.115 | 1.5 MPa/m, 80 mm | 18 kN/m², 9 |
| 5 | pit asphalt | 1 | 0.97 | 1 | 1 | 1 | 0.015 | — | — |
| 6 | dirt | 0.68 | 0.70 | 0.6 | 0.4 | 0.5 | 0.04 | 5 MPa/m, 20 mm | 8 kN/m², 3 |
| 7 | mud | 0.42 | 0.85 | 0.4 | 0.3 | 0.3 | 0.08 | 0.6 MPa/m, 120 mm | 22 kN/m², 12 |
| 8 | sand | 0.50 | 1.10 | 0.4 | 0 | 0.25 | 0.09 | 0.8 MPa/m^1.1, 100 mm | 24 kN/m², 11 |
| 9 | snow | 0.30 | 0.80 | 0.5 | 0.5 | 0.5 | 0.03 | 0.4 MPa/m, 60 mm | 5 kN/m², 2 |
| 10 | ice | 0.12 | 0.60 | 0.85 | 1.2 | 1 | 0.01 | — | — |

### 5.1 Friction terms

* **Friction:** `μ_ground = μ·(1 + (wetμ − 1)·w/(w + w_ref))`. Ice and snow lose up to 45% toward
  0 °C (meltwater film).
* **Fall-off:** `C_eff = 1 + (C − 1)·falloff`. Loose ground keeps ploughing force at large slip.
* **Stiffness** scales Kα and Kx, so loose ground needs more slip.
* **Coupling** scales by1 and bx1 (§1.2).
* The circuit's grass and gravel friction and rigid resistance now come from this table
  (`Track.sample`).

### 5.2 Sinkage, compaction and drag

```
sinkage target z* = min(z_max, (Fz / (b·l·k))^(1/n))      (Bekker p = k·zⁿ)
z ← exact lag toward z*, τ = 0.06 + 0.25/(1 + |v|)  (plastic yield; no spring feedback)
c_rr = c_rigid·carcass·(p0/p)^0.3 + z/((n+1)·l)                         (compaction work)
F_drag = z·b·(k_b·min(1,|v|) + k_bv·v²)  +  100·b·depth·v²·(1 − 0.7·planing)   (bulldozing, water displacement)
```

* At nominal load the grass and gravel rolling totals are 0.070 and 0.137 on the APX-01 (whose
  low-loss carcass factor is 0.9), close to the former 0.08 and 0.16. At 20 m/s gravel adds about
  130 N of bulldozing drag per tyre.
* Sinkage lowers the effective ground in the suspension geometry, so a car in gravel sits lower and
  can ground its floor.
* Standing water costs about 4% of wet top speed (heavy-rain AI scenario: 293 → 281 km/h).

### 5.3 Aquaplaning

```
planing = smooth(0.7·tol·g, 3·tol·g + g, depth) · smooth(24·u, 95·u, v)
g = (grooves: 1 − 0.55·wear)·clamp(0.75 + 0.3125·texture_mm, 0.6, 1.25)
u = √(Fz/2200)·√(p/160)
```

* Groove depth is 2.5 mm on intermediates and 4 mm on wets. Worn grooved tyres plane earlier.
* Smooth paint (0.25 mm texture) planes earlier.
* Higher inflation pressure raises the onset speed (the classic V ∝ √p law).
* At nominal conditions this equals the former curve.

### 5.4 Other users

The motorcycle prototype (`bike.ts`) and terrain tiles use the same table:

* friction circle `μ_tyre · materialGrip(material, water, temp)`;
* `TERRAIN_MATERIAL` maps hardpack and loam to dirt, sand to sand, mud to mud.

## 6. Driver-model adaptations

The tyres now saturate physically in combination, so the AI and assists were made relative to the
tyre's actual state instead of the former fixed slip numbers.

* **Peak slip and utilization.** `Tire.peakSlip` is the present peak slip ratio. `Tire.usage` is the
  combined friction-ellipse use.
* **Peak-relative thresholds.** Traction control (0.16), ABS (0.14), AI wheelspin (0.08) and AI lock
  (0.12) are now scaled by `peakSlip/0.25`, so they are unchanged on the dry reference slick.
* **Friction-limit feedback.**
  * The AI eases the throttle when the driven axle passes 0.9 utilization.
  * It eases the brake when the rear passes 0.9.
  * It eases the brake when the steered front passes 0.92 while turning.
* **Grid start and handover.** The lane logic is the former one. In addition, the car's offset
  from its lane where the AI takes it fades with distance travelled:
  `launch ← launch·exp(−v·dt/50 m)`. The AI takes a car at its grid slot, and again after more than
  0.5 s without AI control (a player handing over, a remounted rider). Previously the car aimed
  across the track at full lock from standstill. That spins a car without traction control (the
  journey runs `assist: 'raw'`) and lays a remounting rider over at walking pace. Now there is no
  lateral demand at standstill: a car holds its line and merges over the first 100–150 m. A
  remounted motorcycle covers 340 m in its first 10 s (300 m required) instead of 286 m.
* **Why 50 m.** Two start-sensitive scenario tests bound the length:
  * the mid-field racing-line test needs the opening-lap reshuffle (player within 18 m of one rival
    for ≥ 5 s);
  * the wet-review test needs in-line following from the grid (≥ 3 s behind one car).

  | Start behaviour | Mid-field, test seed | Mid-field, seeds 1–3 | Wet following (geometric) |
  |---|---|---|---|
  | Grid column held | 2.9 s | 2.6–2.7 s | 3.5 s |
  | 12 m fade | 9.7 s | 10.5–10.7 s | 2.0 s |
  | 30 m fade | 4.9 s | 8.3–9.1 s | 9.5 s |
  | **50 m fade** | **8.3 s** | **5.2–8.5 s** | **5.5 s** |

  The mid-field columns of the first two rows were measured before the integration merge.
  Baseline physics with the full-lock start gave 9.5 s (3.4–7.9 s on seeds 1–3). The outcome is not
  monotonic in the length, so these two tests remain sensitive to any change in start behaviour.

## 7. Calibration evidence

`npm run test:vehicles` measures each car at 1/240 s and 1/120 s. The value shown is the 1/240 s
result. Drift is the difference between the two timesteps: baseline / v2.

| Metric | Band | APX-01 baseline | APX-01 v2 | TC-1 baseline | TC-1 v2 |
|---|---|---|---|---|---|
| 0–100 km/h (s) | 2.3–3.2 / 4.8–7.5 | 2.59 | 2.60 | 5.13 (drift 5.2%) | 4.93 (0.0%) |
| Top speed (km/h) | 320–360 / 205–255 | **319.8 (outside)** | 320.6 | 231.9 | 232.3 |
| 100–0 km/h (m) | 15–32 / 26–42 | 18.96 | 19.24 | 28.80 | 28.09 |
| Lateral at 80 km/h (g) | 1.8–3.2 / 1.0–1.45 | 1.97 | 1.95 | 1.30 | 1.33 |
| Lateral fit (base m/s², aero) | — | 15.53, 6.74e-3 | 15.58, 6.38e-3 | 12.72, 1.06e-4 | 13.04, 1.16e-4 |
| Largest timestep drift | — | 1.16% | 0.2% | 5.19% | 0.0% |

The APX-01's top speed was retuned into its band with the slick's carcass rolling-resistance factor
(0.9) and a load-proportional longitudinal stiffness. The AI capability envelopes in
`vehicles.ts` were left unchanged: the fitted limits moved by less than 3%.

**Catalogue cars and motorcycles** (from the integration branch) all stay inside every band at both
timesteps. Relative to that branch's own calibration:

* braking distances are 0.9–1.6% longer;
* lateral limits move by −2.4% to +1.0%;
* 0–100 km/h and top speed change by at most 0.6%;
* the motorcycles are unchanged (their adapter has its own tyre model).

The tightest margins are SK-125 braking (18.67 m against an 18 m floor), DX-8 braking (39.28 m
against 38 m) and APX-01 top speed (320.55 km/h against 320 km/h). A first pass gave the closed-wheel
families the touring carcass's 3300 N load reference. That raised their peak friction by about 4%,
and six cars stopped up to 0.5 m short of their braking floors. `FAMILY_CARCASS` restores the
2200 N reference that `tireGrip` is defined against.

`npm run test:dynamics` (isolated rigs), baseline → v2:

| Rig | Measurement | Baseline | v2 |
|---|---|---|---|
| Braking from 100/200/300 km/h | Stopping distance (m) | 18.8 / 54.9 / 96.4 | 19.1 / 55.6 / 97.2 |
| Skidpad at 15/25/35 m/s | Lateral (g) | 0.289 / 0.792 / 1.52 | same to 0.003 |
| Slalom | Peak yaw | bounded, recovered | bounded, recovered |
| Sausage kerb | Peak vertical (g) | 0.76 | 1.56 |

The kerb strike is harsher in v2 because it now passes through the stiff radial tyre instead of the
damper alone. The bounded-load assertions still hold.

Scenarios (`npm run test:physics`, 4 cars, 320 s) and the AI lap probe:

| Measure | Baseline | v2 |
|---|---|---|
| Clear best laps | 49.4–51.0 s | 49.6–51.3 s |
| Changeable best laps | 51.4–55.0 s | 51.4–55.6 s |
| Rain best laps | 64.7–67.3 s | 66.0–69.2 s |
| Rain top speed | 293 km/h | 281 km/h |
| Wet pits, 10 cars on slicks, serviced | 240.9 s, zero impacts | 240.5 s, zero impacts |
| AI lap: tyre surface temperature (F/R) | 82/93 °C | 81/91 °C |
| AI lap: carcass temperature | 85–87 °C | 85–87 °C |
| AI lap: hot pressure | 154/148 kPa | 153/146 kPa |
| AI lap: single-car best (dry) | 49.84 s | 49.90 s |

## 8. Cost

`node --experimental-transform-types scripts/physics-cost.ts --repeat 3 --seconds 60` runs 20
production cars with production AI for 60 s on Aurel: a 120 Hz tick with two 240 Hz substeps, in the
same order as `Simulation.step`. Baseline and v2 were run interleaved on the same machine while it
was shared with other jobs.

Five interleaved rounds of 60 simulated seconds each:

| Measure | Baseline (median, range) | v2 (median, range) | Change |
|---|---|---|---|
| Process CPU per 120 Hz tick | 3.90 ms (3.85–3.96) | 4.38 ms (4.33–4.40) | **+12%** |
| Wall time per tick | 5.39 ms (4.42–6.09) | 6.14 ms (4.86–6.76) | +14% |
| `Vehicle.step` wall time per tick | 4.51 ms (3.71–5.10) | 5.15 ms (4.11–5.68) | +14% |
| `Vehicle.step` wall time per car-substep | 113 µs | 129 µs | +14% |

The budget is +40%. On an idle machine before any change, the baseline measured 3.58 ms per tick
(76 µs per car-substep). The wall times above are inflated by other jobs, and CPU time is the steady
figure. In a CPU profile, contact queries already in the baseline (BVH raycast and
`Track.nearest`) still dominate at about 37%. The new tyre law, thermal model and hub solve together
take about 10%. The lateral terms of the combined law are cached across the implicit wheel solve's
16 bisection steps, which halves its curve evaluations. No car retired in any run.

After the merge with the integration branch (car catalogue, motorcycles, circuit catalogue), I ran
three interleaved rounds against that branch's tip:

* process CPU per tick: 4.17 ms (4.12–4.18) → 4.69 ms (4.68–4.85), **+12%**;
* `Vehicle.step` per car-substep on the two quieter rounds: 87–89 µs → 99–103 µs, +14%.

The overhead is unchanged by the merge.

## 9. Tests

| File | Covers |
|---|---|
| `tests/tyre-model.test.ts` | Pure-slip equivalence, ellipse bound, combined weighting, load-saturating stiffness, low-μ peak slip, camber thrust/optimum, pressure, wear, relaxation (exact, low-speed fade), gravel contact, aquaplaning dependencies |
| `tests/tyre-thermal.test.ts` | Exact heat conservation, unconditional stability/no overshoot, steady state, layer ordering, rain and speed cooling, brake heat into pressure, absolute gas law, worn tread |
| `tests/suspension.test.ts` | Series ride rates, roll with bars, damper asymmetry/knee continuity, progression, bump stop, implicit stability with a 5 MN/m tyre at 1/30 s, unilateral contact, camber gain sign, road inclination, moment-equivalent geometric transfer, production-car roll vs roll centre |
| `tests/differential.test.ts` | Exact former coupling, torque conservation, LSD capacity and ramps, Torsen bias, locked axle at 60–240 Hz, model names, centre split, rwd/fwd/awd composition, catalogue spec bridge (same capacity) |
| `tests/drivetrain.test.ts` (catalogue) | Catalogue driveline: LSD capacity and ramps, torque conservation and AWD split, split-μ and AWD launches, gravel tyres, front-axle hybrid |
| `tests/powertrain.test.ts` | Exact former torque, throttle lag, turbo spool/dump, torque table, pumping, shift cut vs seamless |
| `tests/surface-material.test.ts` | Ids and former values, friction ordering, wet paint/grass, ice melt, sinkage, compaction, bulldozing, water drag, bike/terrain use, circuit samples |
| `tests/aero-platform.test.ts` | Centre-of-pressure migration, exact lag, plunge damping, slipstream vs wake footprints, exact 101 m cull, channel independence, leader scaling, porpoising-safe heave at 60/120/240 Hz |
| `tests/integrator-stability.test.ts` | Substep equivalence, no energy gain on a drop (both cars), monotone coast energy, rate-independent stop/step-steer, bounded 60 Hz kerb strikes |

One existing expectation changed. `tests/wheel-alignment.test.ts` now computes the recorded camber
with `kinematicCamber(static, gain, hub travel)`, at the same 7-digit tolerance, because the
recorded angle includes camber gain.

## 10. Known limits

* **Massless hubs.** There is no wheel-hop mode (about 20 Hz). Damping is specified at the contact
  patch.
* **Lateral-only relaxation.** There is no longitudinal relaxation state, and no low-speed MF
  damping term (the lag is faded out instead).
* **Calibrated combined slip.** The weighting coefficients are a gameplay-stable calibration, not a
  fitted data set. A locked wheel keeps about 34% of its pure cornering force (a brush tyre would
  keep about 16%).
* **Thermal model limits.** It is lumped: no tread-width temperature distribution. Rolling
  hysteresis heat (0.0012·Fz·v) is an effective coefficient, smaller than the full rolling
  resistance power.
* **Geometry approximations.** The link-centre correction stands in for the rigid body's high
  reference point. Roll-centre migration is linear in heave, with none in roll.
* **Ground deformation.** Sinkage is per tyre and does not persist on the circuit (the terrain tiles
  in `terrain.ts` do persist). Bulldozing and water drag act longitudinally only.
* **Two differential paths.** Catalogue AWD/LSD cars use the catalogue's equal-speed projection
  (`distributeDrive`), which has no road-reaction feedforward. The stick-torque model can evaluate
  the same specs (`fromSpec`), but switching the catalogue to it would need a recalibration pass.
  Turbo boost has no rpm × load map: it follows engine speed and throttle only.
* **Catalogue geometry.** Catalogue cars and motorcycles run the neutral package: no camber gain,
  roll centre or anti-geometry, legacy throttle response, and the former aero platform. They gain the
  tyre, thermal, hub and ground models. Per-car `dynamics` blocks are the next calibration step.
* **AI tuning.** The AI capability envelopes were not refitted. The AI keeps its margins and
  friction-limit feedback.
