// One-command content validation (WP14): vehicles, circuits, rulesets and
// events. Prints every diagnostic and exits 1 if any definition is invalid.
import { validateContent } from '../src/simulation/content-validation.ts';

const errors = validateContent();
for (const error of errors) console.error(`INVALID  ${error}`);
console.log(errors.length ? `${errors.length} content error(s)` : 'Content valid');
if (errors.length) process.exitCode = 1;
