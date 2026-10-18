"""Serialize the 100 observations recorded during the 17 October visual review.

This script does not inspect images or certify visual parity. --reference-dir
optionally rechecks the actual original JPG hashes; omitting it reproduces the
already-reviewed ledger from its pinned supplied-metadata manifest.
"""
import json,hashlib,argparse
from pathlib import Path
r=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--reference-dir',type=Path)
args=parser.parse_args()
source=args.reference_dir
old={int(x['number']):x for x in json.loads((r/'docs/production/motocross-reference-map.json').read_text())['references']}
features={
 'A':{'name':'Blender-authored anatomical clothing and collar','files':['authoring/motocross/build_kit.py','src/rendering/offroad/authored-kit.ts','src/rendering/rider.ts'],'tests':['tests/motocross-authored-kit.test.ts','e2e/42-motocross-bike.spec.ts']},
 'B':{'name':'Bounded soft canvas pads with stitched graphics, weave and wear','files':['authoring/motocross/build_kit.py','src/rendering/offroad/mx-padding.ts','src/rendering/offroad/mx-boundary.ts','src/rendering/offroad/mx-course-dressing.ts'],'tests':['tests/motocross-authored-kit.test.ts','tests/motocross-environment.test.ts','tests/motocross-venue-integration.test.ts']},
 'C':{'name':'Seated crowd/chairs and connected roof/service-gallery architecture','files':['src/rendering/offroad/stadium.ts'],'tests':['tests/motocross-authored-kit.test.ts','tests/motocross-environment.test.ts','e2e/43-motocross-world.spec.ts']},
 'D':{'name':'Surveyed approach guidance and settled-landing practice rhythm objective','files':['src/simulation/offroad/jump-target.ts','src/simulation/offroad/rhythm-coach.ts','src/ui/offroad-hud.ts'],'tests':['tests/motocross-rhythm-coach.test.ts','tests/motocross-hud.test.ts','e2e/44-motocross-interface.spec.ts','e2e/45-motocross-gameplay.spec.ts']},
}
obs={int(line.split('|')[0]):line.split('|')[1:] for line in (r/'authoring/motocross/reference-observations.txt').read_text().splitlines() if line}
assert len(obs)==100 and set(obs)==set(range(1,101))
references=[]
for n in sorted(old):
 row={**old[n]['suppliedMetadata'],'file':old[n]['file']}
 keys,observation,decision=obs[n]
 digest=row['sha256']
 if source is not None:
  actual=hashlib.sha256((source/row['file']).read_bytes()).hexdigest()
  assert actual==digest, row['file']
 changed=[] if keys=='-' else keys.split(',')
 baselineFiles=old[n]['implementation']['files']
 for path in baselineFiles:assert (r/path).is_file(),path
 references.append({'number':n,'id':f'{n:03}','file':row['file'],'sha256':digest,
  'review':{'visuallyInspected':True,'method':f'Labeled source-image tile on contact sheet {((n-1)//10)*10+1:03}-{((n-1)//10+1)*10:03}; not inferred from the filename','observation':observation},
  'decision':decision,'newFeatureKeys':changed,'retainedBaselineFiles':baselineFiles,
  'status':'applied-principle-not-literal-replica' if changed else 'context-only-no-new-pictured-mode-or-map',
  'sourceMetadata':{'authority':'Supplied archive index; not independently verified capture hardware or release/platform claims','title':row['game_title'],'kind':row['source_kind'],'url':row['source_url']}})
for f in features.values():
 for p in f['files']+f['tests']: assert (r/p).is_file(),p
payload={'schemaVersion':1,'title':'MOTOBOUND motocross original-asset pass: 100-reference review','baselineCommit':'5b31aef72d14f4bd35e567f126aac0a0bc327d9f',
 'archive':'Motocross_PS5_100_Developer_Reference_Images(2).zip','coverage':{'numberedImages':100,'visuallyReviewed':100,'matchingSuppliedSHA256':100,'uniqueSourceHashes':len({x['sha256'] for x in references})},
 'limits':['A reviewed/mapped image is not a claim of one-to-one object reproduction or PS5/AAA visual parity.','Screenshots do not specify physics values. The HUD shares existing production jump calibration.','ATV, UTV, snow, beach, desert/trials maps, pyro and licensed sponsor art are not added by this pass.','Source photos are not shipped in the repository or game.','Test paths are acceptance links, not claims that those tests have already passed; see the delivery report for actual outcomes.'],
 'newFeatures':features,'references':references}
(r/'docs/production/motocross-reference-review-20261017.json').write_text(json.dumps(payload,indent=2)+'\n')
print('100 recorded observations serialized; source hashes rechecked:',source is not None,'context-only:',sum(not x['newFeatureKeys'] for x in references))
