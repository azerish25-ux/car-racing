p = 'src/simulation/offroad/formats.ts'
s = open(p).read()
pairs = [
    ("""  cars: Object.freeze(['rallycross', 'rally', 'offroad'] as const),""",
     """  // Historic rally cars run on gravel tyres and take the stages too.
  cars: Object.freeze(['rallycross', 'rally', 'offroad', 'historic-rally'] as const),"""),
    ("""    'RALLYCROSS HEAT · JOKER',
    ['rallycross', 'rally', 'offroad'],""",
     """    'RALLYCROSS HEAT · JOKER',
    OFFROAD_CLASSES.cars,"""),
    ("""  'rally-stage': ruleset('rally-stage', 'RALLY SPECIAL STAGE', ['rally', 'rallycross', 'offroad'], {""",
     """  'rally-stage': ruleset('rally-stage', 'RALLY SPECIAL STAGE', OFFROAD_CLASSES.cars, {"""),
]
for a, b in pairs:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
open(p, 'w').write(s)
