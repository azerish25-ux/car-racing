import { LOCKED, lsd } from '../differential.ts';
import { defineVehicle } from './builder.ts';
import { combustion, KEYS } from './common.ts';

/** Experimental machines (§10.1 Experimental family, extreme expansion) and
 * the second kart. Each is a concept with one idea taken to its limit; their
 * physics uses the same solver as every other car (the fan floor is the only
 * addition, `VehicleDefinition.fan`). */
export const FAN_CAR_XF2 = defineVehicle({
  id: 'xf2',
  name: 'XF-2 FAN PROTOTYPE',
  classId: 'experimental',
  brief:
    'Fan-assisted downforce prototype: an auxiliary engine drives two fans that evacuate a ' +
    'skirted floor, about 7 kN of suction at any road speed, on a 780 kg closed car with a ' +
    '3.0 L V8 (about 390 kW) and almost no wings (low drag). Intended skill: expert. ' +
    'Strengths: cornering and braking grip that does not wait for speed, low drag on the ' +
    'straights. Weaknesses: suction is lost when the skirts lift (crests, kerbs, a spin), ' +
    'stiff ride, a failure hands the car back its 780 kg of mechanical grip. Targets: 0–100 ' +
    'about 2.8 s, about 310 km/h, 100–0 under 24 m, well over 2 g at 80 km/h.',
  mass: 780,
  frontWeight: 0.42,
  cogHeight: 0.42,
  wheelbase: 2.8,
  trackFront: 1.65,
  trackRear: 1.6,
  width: 2.0,
  height: 1.05,
  overhangFront: 1.0,
  overhangRear: 0.8,
  groundClearance: 0.05,
  wheelRadius: 0.34,
  wheelInertia: 1.7,
  linkCentreHeight: 0.22,
  maxSteer: 0.4,
  finalDrive: 3.9,
  gearRatios: [-2.9, 0, 2.8, 2.1, 1.7, 1.42, 1.22, 1.08],
  idleRPM: 3000,
  shiftRPM: 10700,
  downshiftRPM: 7000,
  limiterRPM: 11000,
  torqueCurve: [
    [4000, 280],
    [6000, 350],
    [8000, 380],
    [9500, 375],
    [10500, 355],
    [11000, 330],
  ],
  engine: combustion(3.0, 700, 0.18),
  brakeTorque: 11000,
  aero: { clA: 1.2, cdA: 0.85, balance: 0.45 },
  fan: { force: 7000, z: -0.1 },
  tireFamily: 'slick',
  tireGrip: 0.9,
  rearGrip: 1.06,
  drivetrain: 'rwd',
  driveline: { rear: lsd(70, 0.4, 0.25) },
  setupKeys: KEYS.closed,
  setupDefaults: { frontSpring: 160000, rearSpring: 170000, frontARB: 30000, rearARB: 24000 },
  elementMass: [3, 4],
  ai: {
    lateralBase: 20.73,
    lateralAero: 0.00329,
    brakingBase: 28.56,
    brakingAero: 0.0019,
    // The fan's share of the bases (fan-on fit less fan-off fit): lost with
    // the floor, so a damaged XF-2's AI plans on its mechanical grip.
    fanBase: { lateral: 7.63, braking: 12.8 },
    lateralMargin: 0.72,
    slowLateralMargin: 0.64,
    brakingMargin: 0.74,
    topSpeed: 88,
  },
  bands: {
    accel0to100: [2.4, 3.4],
    topSpeed: [290, 335],
    braking100Distance: [13, 24],
    lateral80G: [2.0, 3.0],
  },
});
export const ELECTRIC_TIME_ATTACK_XE1 = defineVehicle({
  id: 'xe1',
  name: 'XE-1 ELECTRIC TIME ATTACK',
  classId: 'experimental',
  brief:
    'Electric time-attack prototype: two motors (about 500 kW together, modelled as one ' +
    'equivalent drive at 850 N m, single reduction) through a clutch-pack centre coupling ' +
    'sending 45% forward, 1000 kg with driver, enormous wings and diffuser on wide ' +
    'single-seater-construction slicks. Intended skill: ' +
    'intermediate–expert. Strengths: launches, downforce in medium and fast corners, no ' +
    'gear changes. Weaknesses: drag caps top speed, battery mass, a short single-lap ' +
    'energy budget (fuel-mass proxy). Targets: 0–100 about 2.2 s, about 265 km/h, 100–0 ' +
    'about 22 m, about 2 g at 80 km/h.',
  mass: 1000,
  frontWeight: 0.45,
  cogHeight: 0.34,
  wheelbase: 2.85,
  trackFront: 1.88,
  trackRear: 1.82,
  width: 2.2,
  height: 1.15,
  overhangFront: 1.25,
  overhangRear: 1.0,
  groundClearance: 0.05,
  wheelRadius: 0.35,
  wheelInertia: 1.9,
  linkCentreHeight: 0.22,
  maxSteer: 0.4,
  finalDrive: 6.1,
  gearRatios: [-1.0, 0, 1.0],
  idleRPM: 300,
  shiftRPM: 11900,
  downshiftRPM: 400,
  limiterRPM: 12000,
  torqueCurve: [
    [300, 850],
    [5600, 850],
    [7000, 682],
    [9000, 531],
    [10500, 455],
    [12000, 398],
  ],
  engine: {
    frictionBase: 2,
    frictionPerRad: 0.004,
    inertia: 0.12,
    idleTorque: 100,
    clutchCapacity: 2000,
  },
  brakeTorque: 14000,
  aero: { clA: 7.5, cdA: 1.6, balance: 0.42 },
  tireFamily: 'formula-slick',
  tireGrip: 1.0,
  drivetrain: 'awd',
  driveline: {
    centre: { ...lsd(400, 0.3, 0.3), frontShare: 0.45 },
    front: lsd(100, 0.3, 0.2),
    rear: lsd(100, 0.35, 0.2),
  },
  powertrain: 'electric',
  setupKeys: KEYS.winged,
  elementMass: [6, 8],
  ai: {
    lateralBase: 14.31,
    lateralAero: 0.00533,
    brakingBase: 16.93,
    brakingAero: 0.00695,
    lateralMargin: 0.72,
    slowLateralMargin: 0.64,
    brakingMargin: 0.74,
    topSpeed: 71,
  },
  bands: {
    accel0to100: [1.9, 2.8],
    topSpeed: [245, 280],
    braking100Distance: [16, 28],
    lateral80G: [1.7, 2.6],
  },
});
export const HYDROGEN_XH3 = defineVehicle({
  id: 'xh3',
  name: 'XH-3 HYDROGEN PROTOTYPE',
  classId: 'experimental',
  brief:
    'Hydrogen endurance prototype concept: a fuel-cell stack and buffer battery feeding ' +
    'front and rear motors (about 480 kW, modelled as one equivalent electric drive through ' +
    'a centre coupling sending 35% forward), 1250 kg with the pressure tanks, efficient ' +
    'low-drag endurance aero. Intended skill: intermediate. Strengths: traction, efficient ' +
    'at speed, silent but for compressor and inverter whine. Weaknesses: tank mass, a ' +
    'single reduction gives up acceleration at the top. Known limit: hydrogen is drawn from ' +
    'the shared fuel-mass proxy, and the fuel-cell power curve is a static map. Targets: ' +
    '0–100 about 2.8 s, about 320 km/h, about 1.6 g at 80 km/h.',
  mass: 1250,
  frontWeight: 0.46,
  cogHeight: 0.43,
  wheelbase: 3.15,
  trackFront: 1.7,
  trackRear: 1.66,
  width: 2.0,
  height: 1.12,
  overhangFront: 1.25,
  overhangRear: 0.95,
  groundClearance: 0.055,
  wheelRadius: 0.355,
  wheelInertia: 1.95,
  linkCentreHeight: 0.22,
  maxSteer: 0.36,
  finalDrive: 5.86,
  gearRatios: [-1.0, 0, 1.0],
  idleRPM: 300,
  shiftRPM: 13900,
  downshiftRPM: 400,
  limiterRPM: 14000,
  torqueCurve: [
    [300, 800],
    [5730, 800],
    [8000, 573],
    [10000, 458],
    [12000, 382],
    [14000, 327],
  ],
  engine: {
    frictionBase: 2,
    frictionPerRad: 0.004,
    inertia: 0.13,
    idleTorque: 100,
    clutchCapacity: 1800,
  },
  brakeTorque: 14000,
  aero: { clA: 3.6, cdA: 0.82, balance: 0.45 },
  tireFamily: 'slick',
  tireGrip: 0.92,
  rearGrip: 1.05,
  drivetrain: 'awd',
  driveline: {
    centre: { ...lsd(300, 0.3, 0.3), frontShare: 0.35 },
    front: lsd(100, 0.3, 0.2),
    rear: lsd(150, 0.4, 0.25),
  },
  powertrain: 'electric',
  setupKeys: KEYS.winged,
  elementMass: [5, 6],
  ai: {
    lateralBase: 12.6,
    lateralAero: 0.00292,
    brakingBase: 15.2,
    brakingAero: 0.00282,
    lateralMargin: 0.72,
    slowLateralMargin: 0.64,
    brakingMargin: 0.74,
    topSpeed: 88,
  },
  bands: {
    accel0to100: [2.4, 3.4],
    topSpeed: [300, 335],
    braking100Distance: [20, 34],
    lateral80G: [1.4, 2.1],
  },
});
export const TRACK_HYPERCAR_XT1 = defineVehicle({
  id: 'xt1',
  name: 'XT-1 TRACK HYPERCAR',
  classId: 'experimental',
  brief:
    'Track-only hypercar outside any rule book: 6.5 L naturally aspirated V12 revving to ' +
    '11 100 rpm, about 750 kW, 1120 kg with driver, slicks, a race-car wing and diffuser, ' +
    'seven-speed sequential. Intended skill: expert. Strengths: power everywhere, ' +
    'downforce at speed, a progressive engine. Weaknesses: rear-drive traction on 750 kW, ' +
    'heavier than a prototype, brake heat. Targets: 0–100 about 2.7 s, about 350 km/h, ' +
    'about 1.6 g at 80 km/h.',
  mass: 1120,
  frontWeight: 0.43,
  cogHeight: 0.42,
  wheelbase: 2.75,
  trackFront: 1.72,
  trackRear: 1.66,
  width: 2.07,
  height: 1.1,
  overhangFront: 1.15,
  overhangRear: 0.95,
  groundClearance: 0.06,
  wheelRadius: 0.355,
  wheelInertia: 2.0,
  linkCentreHeight: 0.22,
  maxSteer: 0.42,
  finalDrive: 3.8,
  gearRatios: [-2.9, 0, 3.0, 2.25, 1.8, 1.5, 1.3, 1.15, 1.04],
  idleRPM: 1500,
  shiftRPM: 10800,
  downshiftRPM: 6500,
  limiterRPM: 11100,
  torqueCurve: [
    [4000, 560],
    [6000, 640],
    [8000, 700],
    [9500, 720],
    [10500, 680],
    [11100, 620],
  ],
  engine: combustion(6.5, 1200, 0.3),
  brakeTorque: 15000,
  aero: { clA: 4.0, cdA: 1.15, balance: 0.43 },
  tireFamily: 'slick',
  tireGrip: 0.9,
  rearGrip: 1.14,
  drivetrain: 'rwd',
  driveline: { rear: lsd(100, 0.45, 0.3) },
  setupKeys: KEYS.winged,
  elementMass: [5, 6],
  ai: {
    lateralBase: 12.69,
    lateralAero: 0.00324,
    brakingBase: 15.76,
    brakingAero: 0.0036,
    lateralMargin: 0.7,
    slowLateralMargin: 0.62,
    brakingMargin: 0.72,
    topSpeed: 99,
    lineScale: 0.8,
  },
  bands: {
    accel0to100: [2.3, 3.2],
    topSpeed: [330, 370],
    braking100Distance: [18, 32],
    lateral80G: [1.45, 2.2],
  },
});
/** Kart without a gearbox: the 100 cc engine drives the axle through a
 * centrifugal clutch and one sprocket ratio; brakes on the rear axle only. */
export const DIRECT_KART_DK100 = defineVehicle({
  id: 'dk100',
  name: 'DK-100 DIRECT-DRIVE KART',
  classId: 'kart',
  brief:
    'Direct-drive sprint kart: 100 cc reed-valve two-stroke, about 23 kW at 16 500 rpm, ' +
    'one sprocket ratio and a centrifugal clutch, 155 kg with driver, a rear-axle brake ' +
    'only, harder sprint tyres. Intended skill: novice. Strengths: momentum and line ' +
    'discipline, cornering grip per kilogram. Weaknesses: slow to accelerate (no gears), ' +
    'rear-only brakes lock and slide, the locked axle understeers. Targets: 0–100 about ' +
    '8 s, about 115 km/h, about 2 g at 80 km/h.',
  mass: 155,
  frontWeight: 0.42,
  cogHeight: 0.27,
  wheelbase: 1.04,
  trackFront: 1.1,
  trackRear: 1.36,
  width: 1.38,
  height: 0.6,
  overhangFront: 0.45,
  overhangRear: 0.3,
  groundClearance: 0.03,
  wheelRadius: 0.137,
  wheelInertia: 0.06,
  restLength: 0.08,
  linkCentreHeight: 0.12,
  maxSteer: 0.45,
  inertia: [45, 55, 70],
  finalDrive: 7.8,
  gearRatios: [-1.0, 0, 1.0],
  idleRPM: 3000,
  shiftRPM: 17800,
  downshiftRPM: 3500,
  limiterRPM: 18000,
  torqueCurve: [
    [6000, 6.5],
    [9000, 10],
    [12000, 13],
    [14500, 14.5],
    [16500, 13.2],
    [18000, 11],
  ],
  fuelLoad: 5,
  engine: {
    frictionBase: 0.25,
    frictionPerRad: 0.0008,
    inertia: 0.006,
    idleTorque: 4,
    // Centrifugal clutch: bites from about 8800 rpm and holds the engine near
    // 10 000 rpm until the axle catches up (full lock above 17 600 rpm).
    clutchCapacity: 60,
    engageRPM: 16000,
    clutchCoupling: 0.15,
  },
  brakeTorque: 520,
  aero: { clA: 0, cdA: 0.58, balance: 0.5 },
  tireFamily: 'kart',
  tireGrip: 0.95,
  rearGrip: 1,
  drivetrain: 'rwd',
  driveline: { rear: LOCKED },
  // Brakes act on the rear axle only, so the bias is fixed and not a setting.
  setupKeys: KEYS.fixedChassis.filter((key) => key !== 'brakeBias'),
  setupDefaults: {
    frontSpring: 60000,
    rearSpring: 70000,
    frontARB: 0,
    rearARB: 12000,
    frontRide: 0.065,
    rearRide: 0.075,
    brakeBias: 0,
  },
  setupLimits: { frontARB: [0, 15000], rearARB: [0, 25000] },
  elementMass: [0.8, 0.8],
  ai: {
    lateralBase: 14.86,
    lateralAero: 0,
    brakingBase: 8.58,
    brakingAero: 0,
    lateralMargin: 0.72,
    slowLateralMargin: 0.66,
    brakingMargin: 0.74,
    topSpeed: 33,
    lineScale: 0.75,
    lookahead: [4, 0.32],
  },
  bands: {
    accel0to100: [6.0, 10.5],
    topSpeed: [105, 125],
    braking100Distance: [26, 44],
    lateral80G: [1.6, 2.5],
  },
});
