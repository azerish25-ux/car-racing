"""List the landscape files (PLY meshes and PNG textures) each chosen plant object needs.

usage: python3 -I plan_downloads.py geometry.pbrt OUT.tsv
Writes rows: object<TAB>relative path (geometry/... or textures/...)
"""
import re
import sys

OBJECTS = [
    '"Abies_concolor_02medium"',
    '"xref_Picea_20mt.c4d"',
    '"xref_Betula_pendula_03mediumb.c4d"',
    '"xref_Tilia_tomentosa_02medium.c4d Instance"',
    '"xref_Aesculus_02adult.c4d Instance"',
    '"mountain_ash"',
    '"xref_WPR.c4d"',
    '"meadow_v3"',
    '"meadow_v3dry"',
    '"Short_mowed_large_variant1"',
]
text = open(sys.argv[1]).read()
rows = []
for chunk in re.split(r'\n\s*ObjectBegin ', text)[1:]:
    name = chunk.split('\n', 1)[0].strip()
    if name not in OBJECTS:
        continue
    body = chunk.split('ObjectEnd', 1)[0]
    for ply in re.findall(r'"string filename" "(geometry/[^"]+\.ply)"', body):
        rows.append((name.strip('"'), ply))
    for tex in sorted(set(re.findall(r'"(textures/[^"]+)"', body))):
        rows.append((name.strip('"'), tex))
with open(sys.argv[2], 'w') as out:
    for r in rows:
        out.write('\t'.join(r) + '\n')
print(len(rows), 'rows;', len(set(r[1] for r in rows)), 'unique files')
