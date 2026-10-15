// One-command content validation (WP14): vehicles, circuits, rulesets and
// events, and the festival region (definition, road network, event routes).
// Prints every diagnostic and exits 1 if any definition is invalid.
import { validateContent } from '../src/simulation/content-validation.ts';
import { validateRegion } from '../src/simulation/open-world/region-validation.ts';

const errors = [...validateContent(), ...validateRegion()];
for (const error of errors) console.error(`INVALID  ${error}`);
console.log(errors.length ? `${errors.length} content error(s)` : 'Content valid');
if (errors.length) process.exitCode = 1;
