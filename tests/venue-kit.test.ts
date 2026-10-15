import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { venueKitSuite } from './venue-kit-suite.ts';

// Wave-1 layouts; one venue per dressing family: street+tunnel,
// flyover+docks, mountain, oval.
venueKitSuite('WP30 procedural venue kit', CATALOGUE_CIRCUIT_IDS.slice(0, 20), [
  'riviera',
  'dockyard',
  'alpine-pass',
  'speedbowl',
]);
