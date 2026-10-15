import os, sys, json
root = sys.argv[1]
EXCL_TOP = {'repos','repo','head','base','base2','pristine','merged','integ','headsrc','wf466-base','apex-build','npm','tools','midfield','wp29','rv-or','aurel-load','wf466-fix','verify-plan','verify-wet','baseline','trace1','trace2','trace30'}
EXCL_DIRS = {'node_modules','.git','build','dist','build-before','build-after','test-results','playwright-report','.vite','.cache'}
EXT = {'.png','.jpg','.jpeg','.webp','.md','.txt','.mjs','.js','.ts','.py','.sh','.json','.tsv','.log','.csv','.html','.svg'}
MAX = 5 * 1024 * 1024
picked, skipped = [], []
for top in sorted(os.listdir(root)):
    p = os.path.join(root, top)
    for dirpath, dirnames, files in os.walk(p) if os.path.isdir(p) else [(root, [], [top])]:
        rel_dir = os.path.relpath(dirpath, root)
        first = rel_dir.split(os.sep)[0] if rel_dir != '.' else top
        # repo copies: any dir with package.json + src/ at its root
        if os.path.isfile(os.path.join(dirpath, 'package.json')) and os.path.isdir(os.path.join(dirpath, 'src')) and dirpath != root:
            dirnames[:] = []
            skipped.append((rel_dir + '/', 'repository copy (code is in git history)'))
            continue
        dirnames[:] = [d for d in dirnames if d not in EXCL_DIRS]
        for f in files:
            fp = os.path.join(dirpath, f); rel = os.path.relpath(fp, root)
            if os.path.islink(fp): continue
            size = os.path.getsize(fp); ext = os.path.splitext(f)[1].lower()
            if first in EXCL_TOP: skipped.append((rel, 'excluded working copy/cache/trace dir')); continue
            if first == 'asset-scout' and not (rel.startswith('asset-scout/_') and ext in {'.jpg','.png','.json','.txt'} or f in {'manifest.tsv'} or rel.endswith('.json') and 'HDRI_haven' in rel or ext == '.md'):
                skipped.append((rel, 'raw downloaded asset (re-downloadable; URL in asset-scout/manifest.tsv)')); continue
            if ext not in EXT: skipped.append((rel, f'binary/other type {ext or "none"}')); continue
            if size > MAX: skipped.append((rel, f'larger than 5 MB ({size//1024//1024} MB)')); continue
            picked.append((rel, size))
tot = sum(s for _, s in picked)
json.dump({'picked': picked, 'skipped': skipped}, open(sys.argv[2], 'w'))
print('picked', len(picked), 'files', round(tot/1e6,1), 'MB; skipped', len(skipped))
from collections import Counter
c = Counter(r.split('/')[0] for r, _ in picked); print(c.most_common(30))
