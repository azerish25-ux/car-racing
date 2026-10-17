# GP chain integration: expanded geometry and resource ownership

The incoming GP-R1 chain uses 103 roller instances and 206 link-plate instances. Its original rounded boxes contained 300 triangles per plate. The existing CPU budget helpers counted each shared geometry once, so they missed the expanded instance cost. This bounded integration repair preserves the chain path, instance count, materials, sprocket, animation phase and plate bounds while replacing each plate with a rounded extrusion containing 44 triangles.

| Production high-detail model witness               |  Before |   After |
| -------------------------------------------------- | ------: | ------: |
| Entire model, expanded triangles                   | 160,468 | 107,732 |
| Plate triangles per instance                       |     300 |      44 |
| All 206 plates, expanded triangles                 |  61,800 |   9,064 |
| Instanced meshes                                   |       2 |       2 |
| Mesh count                                         |      99 |      99 |
| Instance disposal events after two model disposals |    0, 0 |    1, 1 |
| Geometry disposal events after two model disposals |    2, 2 |    1, 1 |
| Shared material disposals before its owner closes  |       0 |       0 |

The unchanged reference budget is **fewer than 110,000 triangles**. The CPU budget helpers now multiply by `InstancedMesh.count`. The complete chain contributes 13,800 expanded triangles after the repair, including the existing rollers and sprocket. Each new plate retains the old Float32 bounds: approximately 2.8 × 9 × 14 mm. The JSON witnesses retain the exact values.

`BikeModel.dispose()` now emits the two instanced-mesh disposal events and is idempotent. The installed Three renderer uses these events to release the instance attributes; disposing the geometry alone does not release those attributes. Shared bike materials remain owned by their material set.

## Focused validation

```sh
npx vitest run tests/gp-chain-drive.test.ts tests/motogp-reference.test.ts tests/bike-bodies.test.ts
```

**16 tests passed across three files in 6.44 seconds.** The focused cases cover the production chain's bounds and expanded budget, valid unit normals, original motion contracts, the high/mid/far model budgets with expanded instances, and exactly one instance/geometry disposal event after two calls while preserving shared material ownership. Owned ESLint, Prettier and whitespace checks also passed.

- `before.json` and `after.json` are the measured production-construction witnesses, including exact source hashes, geometry counts, bounds and disposal-event observations.
- `validation.json` records the actual focused test result, the five validated file hashes and the final integrated source/build identity.

These are CPU construction and ownership measurements using a stubbed Canvas drawing context. The actual WebGL scene counts and the final visual review are recorded in the parent compatibility evidence. This repair is confined to the GP chain topology, shared model disposal and the two budget helpers; it changes no motocross model geometry or gameplay.
