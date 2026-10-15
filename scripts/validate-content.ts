// One-command content validation (WP14): vehicles, circuits, rulesets,
// events and the career ladder built from them. Prints every diagnostic and
// exits 1 if any definition is invalid.
import { validateContent } from '../src/simulation/content-validation.ts';
import { validateCareerContent } from '../src/career/validation.ts';

const errors = [...validateContent(), ...validateCareerContent()];
for (const error of errors) console.error(`INVALID  ${error}`);
console.log(errors.length ? `${errors.length} content error(s)` : 'Content valid');
if (errors.length) process.exitCode = 1;
