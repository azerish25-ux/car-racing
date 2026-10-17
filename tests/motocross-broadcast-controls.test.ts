import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUITS, circuitDefinition } from '../src/simulation/circuits.ts';
import { Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { TracksideDirector, tracksideRigs, type CameraRig } from '../src/rendering/trackside.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';

// Historical control captured before the camera-site change, from frozen
// source dc8777face456bed880b57643191beec29101678c5581085a5adc0e8d9140c6f.
// SHA256(JSON.stringify(tracksideRigs(new Track('clear', false, undefined, definition)))).
// These 44 venue signatures cover all 880 original non-MX/SX CameraRig records.
// The fixture is embedded so the regression has no dependency on scratch files.
const ORIGINAL_NON_MX_SIGNATURES = {
  aurel: '2e7146774fbdbfe3b968ca71248204bae1329f08dd33d2b9f056296dc0e1d5c3',
  vellamar: 'ef47691fc49c677f4b6e5b7dbdba21b634896668d088ee30cb7091279516e1b4',
  'parco-reale': 'f605cc663e04a562ec28a02ad334ddb25f4ba07b578e5e7e92aa2399895b5f59',
  ardennes: '3a39607ecce296c25094de4cc6ab625b7b0be99749b4259521aa69ed45ab9303',
  northfield: 'e0d313e3556c00fa78859ca1cb3ac6602ac8522c68f4840d4786d200c97545ba',
  'northfield-classic': '0e813cd9d41bdf8fa0b5c2f5bfbd4a7ec42cf825135d446d2a5f1dfb804e51a0',
  kansai: '7a46cdb0fa968171528047af055da55a435e160a0709296f1ecb1cfd192548f9',
  'kansai-east': 'c0fbf3e5072f8fb286a2b4faf1cab78cade0558cd9e002c9c77fa5920f98b1ab',
  riviera: '3e0894e25fcdb3fc337710603def39ff8ab062d62c6cd05dc4ade6fe377d6468',
  'texas-hill': '46124cb9b2dc7b158141ce5dca69dd2881e708ee2b49c0649352b336a0d2f0a7',
  'neon-city': '30bb269a497e8655d97616cf0980f7c96590a62f471df06f0e56ab815755738a',
  'neon-city-reverse': 'd4632b46f2ad1e309b8fe9b00dcd1de6325cdc6f695321465432298174a9324f',
  'alpine-pass': '771e7311b2d0eca4a36cc4b78ad4756340d5ac8f4b566ecfed2d849b6dcabe73',
  'alpine-pass-reverse': '902f6677633749eb44b1a04be2b25f1d1598b3477e8baa43a38ce2706eb11c62',
  speedbowl: '32e5e50dea32283163a4f60068bac3b970af4dc605ef7fa3bb5089057151d229',
  'speedbowl-infield': 'f686fd0d2ab55c508a1953bbb1c1075a386b523678e68c45b7c42fad931d8b3d',
  'desert-canyon': '99602fcd401755d28f4e2e070b2e5311bbcfec8fde8993da1c738ccbe0759276',
  'desert-canyon-reverse': '8c066a0e052fc80220d802c9b853cceeac3b14e826e5a38ca3347ffbfe70260a',
  'coastal-cliff': '891c70d79dd9cae5f6631a52f9c614b4eda05185622ff2f0c2e7ca1702846a94',
  'coastal-cliff-reverse': '177179d0d11a00d8e1d0a72a2b07f03e50f46726ecaf38047cf9409cf4afa536',
  dockyard: 'dd241f7b257f7cde51a8946078c51fbf68b5d299c82f196df4b7ca62233d3b47',
  'dockyard-reverse': '3f22e5dbfe9a31dde3615b6f9b7f41b4ba54abb090847f5158bd5685232fd6f0',
  'poggio-alto': '329664b920d6ac692b3d0c53ce415e1451f21989a2bd9a37fa928bb7bf6d5bf0',
  'cape-wrenna': 'f11ead5b8859413f1ad3344e4a6bea96c963bdcf105ff5e0503ede9a37a6d4df',
  haarveld: '2cb66a13f217c6bdeeade8b6e52776a5240e50c4a43d931192c16c19f8460320',
  montejaral: '9af9ee31f2975f496b29023e421eb3eddaa2f9b0a4016be5c9cfa11f10a3aec3',
  hochwald: '5de95f30960ca9c9ec01a6b248a3729679d51fbb561af13ba63a080d60331158',
  loirette: 'de7a8b1d3a200e3031b233e16c0feeb3ea3bff3847e800c868cf1e875fc62b4b',
  'loirette-club': '6ea0ff5d90becbfddbc45fc797b22fc5bcf1980063f7e8d9732141ee36fc4a62',
  'serra-verde': '63c97298b2b344bdd0a7267d81ba9879b97880a86a05f4761d8dadc3aa4f6d33',
  'mount-ardlow': '7fbde450de49c95dfb9b1dff6f3bf35072855e40f293533dd83ee26dbf38c3c4',
  'arroyo-oro': 'df146983c2f60e71f6b77f676f0c2faa659975b31a807bbf712f569be5abe988',
  'fiume-verde': '4182423189bf6b562ec3159aea7707bbf1c0aab6ed5dd349564ff610571864bd',
  duinwijk: '121e712bbfa4a57fc133fd0a61ca8eccf84012ac0bd1adfe560ecc9266195e0b',
  'ramla-night': '56d7d4f29eb31a881d37ef638e9c72293c298f2cce472edfb0ec5e9d852a41a0',
  'ramla-outer': '8b9bb2614d04b6d093b56d70d600e88caf8dd7af646a8140e5a9487e787f9125',
  mirvari: '509bc5cf9d49d739c0a83acd142f0b123dee6341a42f950af378d373a437d661',
  'lantern-bay': 'ed4ef1d05895dc3d000d9c0aeef9081b071a64b61115643d01223a2cf7d18fbe',
  'lotus-hill': '84f21037b8ef0d0897d0d00f740f70ccacc6b3102cde66fceda795c4cbfa017f',
  'gantry-point': '43d9731d478b0f7480a04f1d694d143cdd9bb799736a11dad40c018831ef1438',
  'gantry-point-reverse': 'fba45974af5a4dd0adc20f6d639cd6636744bb002a19b3896c0a6d335f0b1b4c',
  'salt-flat': '85a2190172f952d7afd040fcf0e1242bb8ef22247eaaf0975fb8a2ca05ecf78b',
  'kestrel-rx': 'f50b848d2f2fafa5dd269acdc92283634286922ecf8a2d691e193d0d6508ee5b',
  'pinewood-stage': 'ce32e8fdecb411316aeaca06395353cf6161ccc3f62d1c0998cf3fe2be842055',
};

// Original per-id metadata, excluding only the position intentionally relocated.
// Columns: id, centerS, coverageM, baseFov, trackingHz, zoomHz, shot, leadSeconds.
const ORIGINAL_DIRT_METADATA = {
  'valley-ridge-mx': [
    [0, 0, 61.984202998677425, 43, 12, 7, 'grid-finish', 0.1],
    [1, 45.984202998677425, 61.984202998677425, 38, 9, 5, 'straight', 0.16],
    [2, 91.96840599735485, 61.984202998677425, 42, 9, 5, 'straight', 0.16],
    [3, 137.95260899603227, 61.984202998677425, 36, 11, 6, 'corner', 0.08],
    [4, 183.9368119947097, 61.984202998677425, 42, 9, 5, 'straight', 0.16],
    [5, 229.92101499338713, 61.984202998677425, 40, 9, 5, 'straight', 0.16],
    [6, 275.90521799206454, 61.984202998677425, 45, 9, 5, 'straight', 0.16],
    [7, 321.889420990742, 61.984202998677425, 39, 7, 4, 'elevated', 0.12],
    [8, 367.8736239894194, 61.984202998677425, 40, 11, 6, 'corner', 0.08],
    [9, 413.8578269880968, 61.984202998677425, 42, 9, 5, 'straight', 0.16],
    [10, 459.84202998677426, 61.984202998677425, 38, 11, 6, 'corner', 0.08],
    [11, 505.82623298545167, 61.984202998677425, 40, 9, 5, 'straight', 0.16],
    [12, 551.8104359841291, 61.984202998677425, 43, 9, 5, 'straight', 0.16],
    [13, 597.7946389828065, 61.984202998677425, 37, 7, 4, 'elevated', 0.12],
    [14, 643.778841981484, 61.984202998677425, 44, 9, 5, 'straight', 0.16],
    [15, 689.7630449801613, 61.984202998677425, 40, 9, 5, 'straight', 0.16],
    [16, 735.7472479788388, 61.984202998677425, 37, 7, 4, 'elevated', 0.12],
    [17, 781.7314509775163, 61.984202998677425, 42, 9, 5, 'straight', 0.16],
    [18, 827.7156539761936, 61.984202998677425, 40, 11, 6, 'corner', 0.08],
    [19, 873.6998569748711, 61.984202998677425, 42, 7, 4, 'elevated', 0.12],
  ],
  'arena-nord-sx': [
    [0, 0, 46.77459413925926, 43, 12, 7, 'grid-finish', 0.1],
    [1, 30.774594139259257, 46.77459413925926, 38, 9, 5, 'straight', 0.16],
    [2, 61.549188278518514, 46.77459413925926, 42, 9, 5, 'straight', 0.16],
    [3, 92.32378241777778, 46.77459413925926, 36, 11, 6, 'corner', 0.08],
    [4, 123.09837655703703, 46.77459413925926, 42, 9, 5, 'straight', 0.16],
    [5, 153.87297069629628, 46.77459413925926, 40, 9, 5, 'straight', 0.16],
    [6, 184.64756483555556, 46.77459413925926, 45, 9, 5, 'straight', 0.16],
    [7, 215.4221589748148, 46.77459413925926, 39, 7, 4, 'elevated', 0.12],
    [8, 246.19675311407406, 46.77459413925926, 40, 11, 6, 'corner', 0.08],
    [9, 276.9713472533333, 46.77459413925926, 42, 9, 5, 'straight', 0.16],
    [10, 307.74594139259256, 46.77459413925926, 38, 7, 4, 'elevated', 0.12],
    [11, 338.5205355318518, 46.77459413925926, 40, 11, 6, 'corner', 0.08],
    [12, 369.2951296711111, 46.77459413925926, 43, 9, 5, 'straight', 0.16],
    [13, 400.06972381037036, 46.77459413925926, 37, 7, 4, 'elevated', 0.12],
    [14, 430.8443179496296, 46.77459413925926, 44, 9, 5, 'straight', 0.16],
    [15, 461.61891208888886, 46.77459413925926, 40, 9, 5, 'straight', 0.16],
    [16, 492.3935062281481, 46.77459413925926, 37, 7, 4, 'elevated', 0.12],
    [17, 523.1681003674074, 46.77459413925926, 42, 9, 5, 'straight', 0.16],
    [18, 553.9426945066666, 46.77459413925926, 40, 11, 6, 'corner', 0.08],
    [19, 584.7172886459259, 46.77459413925926, 42, 7, 4, 'elevated', 0.12],
  ],
} as const;
const ORIGINAL_PLATFORM_HEIGHTS = [
  5, 4.9, 5, 7, 4, 5, 3.5, 6, 5, 3.5, 6, 5, 4, 7, 3.5, 5, 6, 4, 5, 6,
];

function metadata(rig: CameraRig) {
  return [
    rig.id,
    rig.centerS,
    rig.coverageM,
    rig.baseFov,
    rig.trackingHz,
    rig.zoomHz,
    rig.shot,
    rig.leadSeconds,
  ];
}

describe('replay-camera control preservation outside MX/SX', () => {
  it('retains explicit historical coverage for every other built-in venue', () => {
    const controlIds = Object.values(CIRCUITS)
      .filter((circuit) => !['motocross', 'supercross'].includes(circuit.offroad?.kind ?? ''))
      .map((circuit) => circuit.id)
      .sort();
    expect(Object.keys(ORIGINAL_NON_MX_SIGNATURES).sort()).toEqual(controlIds);
    expect(controlIds).toHaveLength(44);
  });

  it.each(Object.entries(ORIGINAL_NON_MX_SIGNATURES))(
    '%s retains all 20 original camera records exactly',
    (id, signature) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id));
      const rigs = tracksideRigs(track);
      expect(rigs).toHaveLength(20);
      expect(createHash('sha256').update(JSON.stringify(rigs)).digest('hex')).toBe(signature);
    },
  );
});

for (const id of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
  describe(`${id} relocated replay-camera optical contract`, () => {
    let track: Track;
    let director: TracksideDirector;
    let plan: ReturnType<typeof trackInfrastructurePlan>;
    beforeAll(() => {
      // Production constructors only: no simulation steps, camera updates or GPU.
      track = new Track('clear', false, undefined, circuitDefinition(id));
      director = new TracksideDirector(track);
      plan = trackInfrastructurePlan(track);
    });

    it('preserves each original coverage, lens, tracking and shot descriptor', () => {
      expect(director.rigs).toHaveLength(20);
      expect(director.rigs.map(metadata)).toEqual(ORIGINAL_DIRT_METADATA[id]);
      expect(new Set(director.rigs.map((rig) => rig.id)).size).toBe(20);
    });

    it('aligns every physical-camera eye with the replay rig and retains its authored height', () => {
      expect(plan.cameras).toHaveLength(20);
      expect(plan.cameras.map((site) => site.rigId).sort((a, b) => a! - b!)).toEqual(
        Array.from({ length: 20 }, (_, index) => index),
      );
      for (const rig of director.rigs) {
        const site = plan.cameras.find((candidate) => candidate.rigId === rig.id)!;
        expect([site.x, site.cameraY, site.z], `${id} camera ${rig.id}`).toEqual([
          rig.position.x,
          rig.position.y,
          rig.position.z,
        ]);
        expect(rig.position.y - site.y, `${id} platform ${rig.id}`).toBeCloseTo(
          ORIGINAL_PLATFORM_HEIGHTS[rig.id],
          10,
        );
      }
    });

    it('sees every own source center at rider height over the actual production terrain', () => {
      const contact = surfaceSample();
      let sampleCount = 0;
      for (const rig of director.rigs) {
        const target = track.at(rig.centerS, trackPoint());
        const targetY = track.sample(target.x, target.z, contact).height + 1.1;
        const distance = Math.hypot(target.x - rig.position.x, target.z - rig.position.z);
        expect(distance, `${id} camera ${rig.id} target distance`).toBeGreaterThan(1);
        // Independent midpoint grid at <= 0.19 m spacing, offset from the
        // placement search's <= 0.5 m endpoint grid. Query Track.sample directly;
        // do not call the placement helper's terrain or visibility functions.
        const samples = Math.ceil(distance / 0.19);
        for (let index = 0; index < samples; index++) {
          const t = (index + 0.5) / samples;
          const x = rig.position.x + (target.x - rig.position.x) * t;
          const z = rig.position.z + (target.z - rig.position.z) * t;
          const rayY = rig.position.y + (targetY - rig.position.y) * t;
          const clearance = rayY - track.sample(x, z, contact).height;
          expect(
            clearance,
            `${id} camera ${rig.id}, ${distance * t} m along sightline`,
          ).toBeGreaterThanOrEqual(0.2 - 1e-6);
          sampleCount++;
        }
      }
      expect(sampleCount).toBeGreaterThan(1000);
    });
  });
}
