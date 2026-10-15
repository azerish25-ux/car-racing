p='src/rendering/bike.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old[:70]
    s=s.replace(old,new,1)
rep("""  F,
  H,
  R,
  RACE_BASE,""","""  F,
  H,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,""")
rep("""import { Rider, type RiderDetail } from './rider.ts';""","""import { Rider, type RiderDetail } from './rider.ts';
import { isDirtBike } from '../simulation/offroad/dirt-bikes.ts';
import { DirtBikeModel } from './offroad/dirt-bike-model.ts';
import { mudUniforms } from './offroad/mud.ts';""")
rep("""  compoundColour: number;
  riding: boolean;
}
interface Entry {
  definition: VehicleDefinition;
  materials: BikeMaterials;
  levels: BikeModel[];
  level: number;
}""","""  compoundColour: number;
  riding: boolean;
  /** Off-road (WP41, snapshot O block): standing 0..1, foot dab -1..1, body
   * fore/aft, mud coat 0..1 and the soil wetness it came from. */
  standing?: number;
  dab?: number;
  body?: number;
  mud?: number;
  mudWet?: number;
}
interface Entry {
  definition: VehicleDefinition;
  materials: BikeMaterials;
  levels: (BikeModel | DirtBikeModel)[];
  level: number;
}""")
rep("""    const materials = new BikeMaterials(id);
    const levels = (['high', 'mid', 'far'] as const).map(
      (detail) => new BikeModel(definition, id, detail, materials, detail === 'high'),
    );""","""    const materials = new BikeMaterials(id);
    // Off-road machines (WP41) have their own model; one mud coat per entrant.
    const mud = mudUniforms();
    const levels = (['high', 'mid', 'far'] as const).map((detail) =>
      isDirtBike(definition)
        ? new DirtBikeModel(definition, id, detail, materials, mud)
        : new BikeModel(definition, id, detail, materials, detail === 'high'),
    );""")
rep("""  private pose(model: BikeModel, a: Float32Array, b: Float32Array, t: number, id: number) {""","""  private pose(
    model: BikeModel | DirtBikeModel,
    a: Float32Array,
    b: Float32Array,
    t: number,
    id: number,
  ) {""")
rep("""    const state = BIKE_STATES[Math.round(b[k + B.STATE])] ?? 'riding';
    v.riding = state === 'riding';
    model.pose(v);""","""    const state = BIKE_STATES[Math.round(b[k + B.STATE])] ?? 'riding';
    v.riding = state === 'riding';
    const ob = o + OFFROAD_BASE;
    v.standing = lerp(ob + O.STANDING);
    v.dab = lerp(ob + O.DAB);
    v.body = lerp(ob + O.BODY);
    v.mud = b[ob + O.MUD];
    v.mudWet = b[ob + O.MOISTURE];
    model.pose(v);""")
open(p,'w').write(s)
