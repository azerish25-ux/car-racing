def edit(p, pairs):
    s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:80])
        s = s.replace(old, new)
    open(p, 'w').write(s)

edit('src/simulation/vehicles.ts', [
("""<<<<<<< HEAD
  | 'motocross'
  | 'supermoto';
=======
  // Catalogue growth""", """  // Catalogue growth"""),
("""  | 'classic-bike'
  | 'road-bike';
/** Fan-assisted floor""", """  | 'classic-bike'
  | 'road-bike'
  // Off-road motorcycles (WP39).
  | 'motocross'
  | 'supermoto';
/** Fan-assisted floor"""),
("""  z: number;
}
>>>>>>> claude/peaceful-einstein-dedc7t
""", """  z: number;
}
"""),
("""<<<<<<< HEAD
  // Off-road motorcycles (WP39), appended after the catalogue.
  ...DIRT_BIKES,
=======
  ...BIKE_ADDITIONS,
>>>>>>> claude/peaceful-einstein-dedc7t
""", """  ...BIKE_ADDITIONS,
  // Off-road motorcycles (WP39), appended after the catalogue and bikes.
  ...DIRT_BIKES,
"""),
])
