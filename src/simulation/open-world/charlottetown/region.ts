import raw from './data.json' with { type: 'json' };
import type { RegionDefinition, XZ } from '../region-data.ts';
import type { StreetSurvey } from '../survey.ts';

/** The checked-in dataset is reproducible with scripts/import-charlottetown.py.
 * No Google imagery is used. OSM geometry is not a survey-grade certification. */
export const CHARLOTTETOWN_SURVEY = raw as unknown as StreetSurvey;
export const CHARLOTTETOWN_ROUTE: readonly XZ[] = CHARLOTTETOWN_SURVEY.route;
export const CHARLOTTETOWN_STATIONS = CHARLOTTETOWN_SURVEY.stations;
export const CHARLOTTETOWN_SOURCE = Object.freeze(raw.source);
export const CHARLOTTETOWN_EVENT = 'charlottetown-campus-run';
const route = CHARLOTTETOWN_ROUTE;
const start = route[0],
  next = route[1];
// Sparse interior anchors constrain every named street without repeatedly
// snapping metre-rounded source points to alternating edges at junctions.
const anchors = [0, 5, 20, 38, 47, 56, 61].map((i) => route[i]);
export const CHARLOTTETOWN: RegionDefinition = {
  id: 'charlottetown',
  name: 'Charlottetown · Campus Route',
  version: 1,
  seed: 0xc4a710,
  half: 1152,
  mapHalf: 1152,
  seaLevel: -30,
  // Unmeasured ground is a deliberately restrained local plane, not fictitious mountains.
  urbanPlane: { height: 12, slopeX: 0, slopeZ: 0.003 },
  junctionSnap: 0.8,
  coast: [
    [-30000, -30000],
    [30000, -30000],
  ],
  peaks: [],
  valley: {
    name: 'Outside mapped corridor',
    points: [
      [-25000, -25000, -40],
      [25000, -25000, -40],
    ],
    width: 1,
    channel: 0,
    channelDepth: 0,
  },
  flats: [
    {
      kind: 'town',
      name: 'Charlottetown',
      x0: -30000,
      z0: -30000,
      x1: 30000,
      z1: 30000,
      blend: 10,
      height: 12,
      slopeZ: 0,
    },
  ],
  forests: [],
  towns: [],
  landmarks: [],
  overpasses: [],
  survey: CHARLOTTETOWN_SURVEY,
  attribution: '© OpenStreetMap contributors · ODbL · Façades and elevation estimated',
  spawn: { x: start[0], z: start[1], heading: Math.atan2(next[0] - start[0], next[1] - start[1]) },
  roads: raw.roads.map((road) => ({
    id: road.id,
    name: road.name,
    roadClass: 'town',
    points: road.points.map(([x, z]): XZ => [x, z]),
    interpolation: 'linear',
    section: {
      halfWidth: road.halfWidth,
      shoulder: 1.8,
      step: 3,
      maxBank: 0,
      crown: 0.014,
      markings:
        road.name === 'Maloney Drive' ? 'none' : road.oneway === 'yes' ? 'centre' : 'double-yellow',
    },
  })),
  events: [
    {
      id: CHARLOTTETOWN_EVENT,
      name: 'Maloney → Holland College',
      kind: 'sprint',
      waypoints: anchors,
      rivals: 0,
      finishBuffer: 1,
      startOffset: 0.5,
      blurb:
        'The mapped 1.706 km campus route: Maloney Drive, Queen Street, Kent Street and Weymouth Street. Solo point-to-point run; no invented closing road. Formula, GP motorcycle and road-car physics supported.',
    },
    {
      id: 'charlottetown-return',
      name: 'Holland College → Maloney',
      kind: 'sprint',
      waypoints: [...anchors].reverse(),
      rivals: 0,
      finishBuffer: 1,
      startOffset: 0.5,
      blurb:
        'Reverse-direction virtual closed-road time trial. This is a game event, not a real-world traffic itinerary.',
    },
    {
      id: 'charlottetown-queen-sprint',
      name: 'Queen Street Sprint',
      kind: 'road-race',
      waypoints: [route[13], route[24], route[38]],
      rivals: 3,
      blurb:
        'A short same-class sprint down Queen Street. Brake for the Kent Street finish; the campus run remains available without unlocks.',
    },
    {
      id: 'charlottetown-kent-flow',
      name: 'Kent Street Flow',
      kind: 'drift-zone',
      waypoints: [route[43], route[50], route[56]],
      stars: [120, 400, 850],
      blurb:
        'A road-car skill zone on the mapped Kent Street alignment. Build a clean, controlled chain without wall contact.',
    },
  ],
};
