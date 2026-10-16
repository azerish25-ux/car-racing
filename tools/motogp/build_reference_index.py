"""Bind every individually reviewed REF row to the exact supplied image bytes.
This verifies accounting/provenance, not visual quality or feature completion.
"""
from pathlib import Path
import hashlib
import json
import re
import zipfile

archive = Path('reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip')
review = Path('docs/MOTOGP_100_REFERENCE_R1.md').read_text()
rows = {int(n): (note.strip(), scope.strip()) for n, note, scope in re.findall(
    r'^\| REF (\d{3}) \| (.*?) \| (.*?) \|$', review, re.M)}
if set(rows) != set(range(1, 101)):
    raise ValueError('Expected exactly 100 uniquely numbered review rows')
records = []
with zipfile.ZipFile(archive) as pack:
    for name in sorted(pack.namelist()):
        match = re.match(r'REF_(\d{3})_', Path(name).name)
        if not match or Path(name).suffix.lower() not in ('.jpg', '.jpeg', '.png'):
            continue
        number = int(match.group(1))
        note, components = rows[number]
        records.append({'reference': number, 'file': name, 'sha256': hashlib.sha256(pack.read(name)).hexdigest(),
                        'observation': note, 'components': components,
                        'status': 'reviewed-context-retained' if components == 'Retained/context' else 'partially-applied-components'})
records.sort(key=lambda row: row['reference'])
if len(records) != 100 or len({r['reference'] for r in records}) != 100:
    raise ValueError('Reference archive does not match the 100-row review')
result = {'sourceArchive': str(archive), 'sourceSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(),
          'reviewedImages': len(records), 'qualityCertified': False, 'references': records}
Path('docs/motogp-reference-r1.json').write_text(json.dumps(result, indent=2) + '\n')
print('Bound 100 individual review rows to 100 hashed reference images.')
