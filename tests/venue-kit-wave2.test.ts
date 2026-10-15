import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { venueKitSuite } from './venue-kit-suite.ts';

// Every layout appended after wave 1; dressing families new in wave 2: the
// container terminal (crane gantries, night), island cliffs and a day-night
// endurance venue.
venueKitSuite('Catalogue wave 2 venue kit', CATALOGUE_CIRCUIT_IDS.slice(20), [
  'gantry-point',
  'cape-wrenna',
  'loirette-club',
]);
