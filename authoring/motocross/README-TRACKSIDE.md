# MOTOBOUND motocross trackside models

Six original metre-scale models are constructed synchronously by
`src/rendering/offroad/mx-trackside-models.ts` and installed in the existing
`MxCourseDressing` by `mx-trackside-furniture.ts`. The old cone-based outdoor
canopies are replaced, not drawn underneath the new ones.

| Model            | Authored details                                                         | Near / course triangles |
| ---------------- | ------------------------------------------------------------------------ | ----------------------- |
| Service canopy   | Sewn sagging roof panels, hems, telescoping legs, scissor frame, ballast | 3560 / 1696             |
| Tool trolley     | Six drawers, pulls, worktop, sockets, ratchet, casters, handle           | 4796 / 1700             |
| Pressure washer  | Frame, wheels, motor fins, pump, tank, hose coil, stowed lance           | 4204 / 1568             |
| Water tank       | Rounded vessel, welded cage, pallet, filler, spigot and valve            | 3088 / 1360             |
| Marshal platform | Braced deck, rails, open access ladder, shade roof, stowed flags         | 3568 / 1064             |
| Speaker stack    | Two cabinets, recessed drivers and horn, open grilles, handles, cable    | 4568 / 1560             |

## Runtime integration

Valley Ridge MX has 26 model instances: four service bays and six marshal posts.
Arena Nord SX has 12: two equipment bays and four marshal posts, without indoor
canopies. The complete kit is merged into five material batches per venue:
102272 added triangles outdoors and 47584 indoors. Runtime currently uses the
near variant; the smaller course variant is available for export, not automatic
runtime LOD switching.

Placement reserves full model envelopes outside every racing-lane segment and
physical boundary. It excludes stands, camera supports, other service sites and
indoor seating, rejects steep or uneven sites, and follows existing terrain.
Disposal is owned by the course dressing. No extra lights, network assets,
textures, timers or physics changes are introduced. Equipment and rolled flags
are scenery, not new service interactions or active marshal signals.

## Editable Blender and GLB exports

The runtime model source is authoritative. Export the exact part buffers, then
create welded editable Blender meshes with corner UVs, colours and split normals:

```sh
node --experimental-transform-types scripts/export-mx-trackside.ts /tmp/mx-trackside
blender -b --factory-startup --python authoring/motocross/export_trackside_blender.py -- /tmp/mx-trackside
node scripts/verify-mx-trackside-glb.mjs /tmp/mx-trackside
```

This creates `MOTOBOUND_MX_Trackside_Models.blend`, twelve GLBs, the source JSON,
checksums and verification receipts. Blender edits do not automatically propagate
back to the TypeScript generator. Native outputs are distributed in the separate
model kit; this commit contains the integrated runtime and reproducible exporters.
No commercial mesh, reference photograph, logo or external texture is embedded.

## Validation recorded on 2026-10-18

The local runtime baseline was `6a1c7218842c6c3ff11fe55fc633d0d554365fa9` plus
this change. The concurrent Solvane commit `d459ef0085be045700d0777db99f64a3bf15f277`
changes no file in this delivery and is preserved during publication.

- 23 tests passed across the new model suite and the existing motocross
  environment and venue-integration suites. Checks cover determinism, ownership,
  normals, both variants, full vertex envelopes, an independent dense lane survey,
  ground contact, unchanged terrain and exactly-once resource disposal.
- Lint, content validation, TypeScript and Vite production build passed.
- One Playwright test rendered all six actual production models on WebGL2/Mesa
  with no GL or console errors. Each model used at most five material draws.
  Its six PNG attachments are isolated studio inspections, not race screenshots.
- All twelve Blender 5.2.2 GLBs passed source-buffer comparison: position error
  below 20 micrometres, normal direction within 0.3 degrees, colour error below
  0.005. The saved Blender file reopened with 733 mesh objects and twelve variants.

The full regression run was interrupted by a runtime reset and is not claimed
as passed. Local checks predate the independent Solvane R3 integration; complete
combined-main CI and target-device performance remain unverified. No release,
photorealism-parity or hardware frame-rate approval is asserted.

```sh
npx vitest run tests/mx-trackside-models.test.ts tests/motocross-environment.test.ts tests/motocross-venue-integration.test.ts
npx playwright test e2e/47-motocross-trackside-models.spec.ts --config playwright.motocross.config.ts
```
