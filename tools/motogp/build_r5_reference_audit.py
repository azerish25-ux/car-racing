"""Reproduce the R5 reference ledger from the supplied originals and retained observations.
The 100-image visual review was performed during R5; this command verifies bytes,
not images by sight. It cannot certify that every depicted scene is implemented.
"""
from pathlib import Path
import json, hashlib, collections, zipfile, argparse
p = argparse.ArgumentParser()
p.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
options = p.parse_args()
root = options.root.resolve()
archive = zipfile.ZipFile(root/'reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip')
def image_bytes(relative):
    matches = [n for n in archive.namelist() if n.endswith('/'+relative) or n == relative]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one original image: {relative}')
    return archive.read(matches[0])
prior=json.loads((root/'docs/motogp-reference-r2.json').read_text())['references']
# Each set is a reviewed visual cue, not a claim that an entire depicted scene ships.
body={1,3,4,6,18,19,20,21,22,27,28,29,39,49,50,51,52,55,56,58,59,60,65,67,70,71,73,75,79,80,85,87,88,92,94,98,99}
rider={2,4,6,11,15,16,18,19,25,27,28,29,35,37,39,49,50,51,52,54,56,57,58,59,60,65,67,70,71,73,74,75,76,77,78,79,80,85,87,88,92,95,98,99}
tyre={1,2,3,6,10,18,19,20,21,22,27,28,29,34,35,37,38,49,50,55,56,58,59,60,61,67,70,71,73,75,79,80,85,87,92,96,98,99}
rain={10,17,34,35,36,37,38,61,62,64,70,72,86,96}
crowd={14,15,16,27,28,29,31,32,33,44,45,50,51,52,53,55,56,62,63,64,67,72,74,75,79,80,82,85,86,89,90,92,94,98,99}
physics={2,15,19,25,27,28,35,37,39,44,45,56,59,60,67,70,85,98}
links={
 'bodywork':['tools/motogp/build_gp_bodywork.py','src/rendering/gp-bodywork.ts','src/rendering/bike-livery.ts','src/rendering/gp-appearance.ts'],
 'rider':['src/rendering/gp-rider-gear.ts','src/rendering/rider.ts'],
 'tyres':['src/rendering/gp-tyre-finish.ts','src/rendering/bike.ts'],
 'wet-composition':['src/rendering/weather-presentation.ts','tests/gp-wet-finish-order.test.ts'],
 'spectators':['scripts/lib/human-sculpt.ts','src/rendering/crowd.ts','src/rendering/human-kit.json','src/rendering/crowd-wardrobe.ts','src/rendering/crowd-impostor.ts'],
 'braking-context':['src/simulation/bike.ts','src/simulation/bike-vehicle.ts','tests/gp-engine-braking.test.ts']}
rows=[]
for old in prior:
 i=old['number'];data=image_bytes(old['file']);sha=hashlib.sha256(data).hexdigest();assert sha==old['sha256'],old['file']
 tags=[k for k,subset in [('bodywork',body),('rider',rider),('tyres',tyre),('wet-composition',rain),('spectators',crowd),('braking-context',physics)] if i in subset]
 visual=[tag for tag in tags if tag!='braking-context']
 row={'number':i,'file':old['file'],'sha256':sha,'review':'Individually inspected as a labelled 10-image sheet at useful resolution; original observation checked against the image. No OCR used.',
      'observation':old['observations'][0],'r5_links':tags,'implementation_files':sorted({p for tag in tags for p in links[tag]}),
      'r5_disposition':'partially-transferred' if visual else 'reviewed-context-only',
      'limit':'Only the listed visual cues are transferred to original assets. The photographed scene, licensed teams, faces, venues, and menu content are not rebuilt. No coefficient is measured from a screenshot.'}
 rows.append(row)
assert sorted(r['number'] for r in rows) == list(range(1, 101))
record={'revision':'MotoGP R5 composite, rider, spectators and tyre/weather response','originalR5Baseline':'ede738ec800445cd513083d01b05e99b6568a23f','integrationBaseline':'5b31aef72d14f4bd35e567f126aac0a0bc327d9f','runtimeEquivalentRemoteHead':'8060d6fca6b5d5e7b215b82bc8e3fb89f8c9e45f','image_count':100,'verified_sha256_payloads':100,'visually_reviewed':100,'review_sheets':10,'status_counts':dict(collections.Counter(r['r5_disposition'] for r in rows)),'references':rows}
(root/'docs/motogp-reference-r5.json').write_text(json.dumps(record,indent=2)+'\n')
md=['# MotoGP R5 — all 100 supplied reference images','',
 'All 100 original JPEG payloads were individually hash-checked and inspected in ten labelled sheets. This ledger identifies the original file, visible cue and the precise scope transferred to the game. **Reviewing an image does not mean recreating its entire scene.**',
 '', 'Original R5 baseline: `ede738ec800445cd513083d01b05e99b6568a23f`. Refined integration baseline: `5b31aef72d14f4bd35e567f126aac0a0bc327d9f`, with runtime source equivalent to the subsequently inspected `8060d6fc`. Concurrent shared-chain, motocross and Festival files are preserved. Original reference pixels are not runtime textures, models or UI assets. Press conferences, human likenesses, training interiors, store marketing, split-screen and unrelated off-road scenes remain context where listed.','','| Ref | Original file / SHA-256 | Visible cue | R5 scope |','|---:|---|---|---|']
for row in rows:
 tags=', '.join(row['r5_links']) or 'Reviewed only; no new implementation claim'
 md.append(f"| {row['number']:03} | `{row['file']}`<br>`{row['sha256']}` | {row['observation'].replace('|','/')} | {tags}; **{row['r5_disposition']}** |")
md+=['','## Implementation links','']
for tag,paths in links.items():md.append(f"**{tag}:** "+', '.join(f'`{p}`' for p in paths)+'.')
md+=['','## Acceptance boundary','',
'Original model and circuit WebGL fixtures, finite-geometry tests, cockpit clearances, deterministic tyre/weather state, and simulation regressions are the relevant checks. They do not establish whole-scene PS5 fidelity or consumer-hardware frame rates. Native Blender source contains the original bodywork; road rider and spectator changes use the retained procedural geometry authoring and runtime paths. Braking screenshots motivate rider-control context only; physics comes from the existing simulation, not inferred screen measurements.','']
(root/'docs/MOTOGP_R5_REFERENCE_REVIEW.md').write_text('\n'.join(md))
print(json.dumps({'referencePayloadsVerified': len(rows), 'statusCounts': record['status_counts']}))
