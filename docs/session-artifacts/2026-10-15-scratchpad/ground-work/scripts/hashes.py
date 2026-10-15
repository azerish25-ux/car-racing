import hashlib
import os
import sys

manifest = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/asset-scout/manifest.tsv'
wanted = sys.argv[1:]
for line in open(manifest):
    cols = line.rstrip('\n').split('\t')
    if len(cols) < 5 or not cols[3].startswith('https://'):
        continue
    url, path = cols[3], cols[4]
    if not any(w in url for w in wanted):
        continue
    h = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    print(f'{url}\t{h}\t{os.path.getsize(path)}')
