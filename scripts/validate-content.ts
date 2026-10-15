// One-command content validation (WP14): vehicles, circuits, rulesets,
// events, the career ladder built from them and the festival region
// (definition, road network, event routes). Prints every diagnostic and
// exits 1 if any definition is invalid.
import { validateContent } from '../src/simulation/content-validation.ts';
import { validateCareerContent } from '../src/career/validation.ts';
import { validateRegion } from '../src/simulation/open-world/region-validation.ts';
import { auditShipment, readRegister, validateRegister } from './assets/register.ts';
import { thirdPartyManifest } from '../src/rendering/assets/third-party.ts';

// Third-party assets: register rules (licences, pinned sources, no brands) and
// the shipped tree against its manifest (sizes; hashes run in the unit tests).
const root = process.cwd();
const thirdParty = [
  ...validateRegister(readRegister(root)),
  ...auditShipment(root, thirdPartyManifest, false).errors,
].map((e) => `third-party ${e}`);
const errors = [...validateContent(), ...validateCareerContent(), ...validateRegion(), ...thirdParty];
for (const error of errors) console.error(`INVALID  ${error}`);
console.log(errors.length ? `${errors.length} content error(s)` : 'Content valid');
if (errors.length) process.exitCode = 1;
