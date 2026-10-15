import sys
p=sys.argv[1]
s=open(p).read()
a="""import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';"""
b="""import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';
import { kinematicCamber } from '../src/simulation/suspension.ts';"""
assert a in s; s=s.replace(a,b,1)
a="""        camber = side * (i < 2 ? vehicle.setup.frontCamber : vehicle.setup.rearCamber);"""
b="""        // Static camber plus the suspension's camber gain at the actual hub travel.
        axle = i < 2 ? vehicle.dynamics.suspension.front : vehicle.dynamics.suspension.rear,
        camber = kinematicCamber(
          i < 2 ? vehicle.setup.frontCamber : vehicle.setup.rearCamber,
          axle.camberGain,
          vehicle.hub.travel[i],
          side,
        );"""
assert a in s; s=s.replace(a,b,1)
open(p,'w').write(s)
