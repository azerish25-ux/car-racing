p='/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1/scripts/validate-content.ts'
s=open(p).read()
old="""import { validateRegion } from '../src/simulation/open-world/region-validation.ts';

const errors = [...validateContent(), ...validateCareerContent(), ...validateRegion()];"""
new="""import { validateRegion } from '../src/simulation/open-world/region-validation.ts';
import { auditShipment, readRegister, validateRegister } from './assets/register.ts';
import { thirdPartyManifest } from '../src/rendering/assets/third-party.ts';

// Third-party assets: register rules (licences, pinned sources, no brands) and
// the shipped tree against its manifest (sizes; hashes run in the unit tests).
const root = process.cwd();
const thirdParty = [
  ...validateRegister(readRegister(root)),
  ...auditShipment(root, thirdPartyManifest, false).errors,
].map((e) => `third-party ${e}`);
const errors = [...validateContent(), ...validateCareerContent(), ...validateRegion(), ...thirdParty];"""
assert old in s; s=s.replace(old,new)
s=s.replace("""// Prints every diagnostic and
// exits 1 if any definition is invalid.""","""// Prints every diagnostic and
// exits 1 if any definition is invalid.""")
open(p,'w').write(s)
