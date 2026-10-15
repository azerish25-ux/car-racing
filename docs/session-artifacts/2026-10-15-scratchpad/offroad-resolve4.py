p='src/rendering/bike.ts'
s=open(p).read()
old="""<<<<<<< HEAD
import { isDirtBike } from '../simulation/offroad/dirt-bikes.ts';
import { DirtBikeModel } from './offroad/dirt-bike-model.ts';
import { mudUniforms } from './offroad/mud.ts';
=======
import { bikeSheetFor } from './bike-sheet.ts';
>>>>>>> claude/peaceful-einstein-dedc7t
"""
new="""import { bikeSheetFor } from './bike-sheet.ts';
import { isDirtBike } from '../simulation/offroad/dirt-bikes.ts';
import { DirtBikeModel } from './offroad/dirt-bike-model.ts';
import { mudUniforms } from './offroad/mud.ts';
"""
assert s.count(old)==1; s=s.replace(old,new)
assert '<<<<<<<' not in s
open(p,'w').write(s)
