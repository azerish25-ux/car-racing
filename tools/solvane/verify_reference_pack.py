#!/usr/bin/env python3
"""Read-only audit of the supplied reference ZIP against the committed ledger.

Uses Python's standard library. No network requests, extraction or image copying.
A successful audit proves file/source continuity, not visual equivalence to a game.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from typing import Any, BinaryIO
import zipfile

CHUNK = 1024 * 1024
MAX_IMAGE_BYTES = 32 * CHUNK
MAX_MANIFEST_BYTES = 2 * CHUNK


class AuditError(ValueError):
    """The supplied archive does not match the recorded reference set."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def digest(stream: BinaryIO) -> str:
    result = hashlib.sha256()
    while data := stream.read(CHUNK):
        result.update(data)
    return result.hexdigest()


def audit(archive: Path, record: dict[str, Any], ledger: str) -> dict[str, Any]:
    with archive.open('rb') as stream:
        archive_hash = digest(stream)
    require(archive_hash == record['archiveSha256'], 'Archive SHA-256 differs from the recorded upload.')
    # Compact committed records anchor the full manifest instead of duplicating
    # 100 long URLs. Explicit rows remain supported for independent audit tests.
    rows = record.get('images')
    checked: list[dict[str, Any]] = []
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP entry names are not permitted.')
        for name in names:
            path = PurePosixPath(name)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in name,
                    f'Unsafe ZIP entry: {name!r}')
        info = source.getinfo('manifest.json')
        require(info.file_size <= MAX_MANIFEST_BYTES, 'Embedded manifest exceeds the audit budget.')
        manifest_bytes = source.read(info)
        if rows is None:
            require(hashlib.sha256(manifest_bytes).hexdigest() == record['manifestSha256'],
                    'Embedded manifest SHA-256 differs from the committed anchor.')
        manifest = json.loads(manifest_bytes)
        require(isinstance(manifest, list) and len(manifest) == 100,
                'The embedded manifest must contain exactly 100 entries.')
        if rows is None:
            rows = [dict(index=m['index'], localPath=m['local_path'], filename=m['filename'],
                         bytes=m['bytes'], sha256=m['sha256'], url=m['downloaded_from'])
                    for m in manifest]
        require(len(rows) == 100, 'The recorded set must contain exactly 100 images.')
        require(sorted(row['index'] for row in rows) == list(range(1, 101)),
                'Recorded IDs must be 001 through 100 exactly once.')
        require(len({row['sha256'] for row in rows}) == 100, 'Duplicate recorded image hashes.')
        require(len({row['localPath'] for row in rows}) == 100, 'Duplicate recorded paths.')
        by_id = {item['index']: item for item in manifest}
        require(sorted(by_id) == list(range(1, 101)), 'Duplicate or missing embedded reference IDs.')
        image_names = {name for name in names
                       if PurePosixPath(name).suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}}
        require(image_names == {row['localPath'] for row in rows},
                'The image file set differs from the recorded set.')
        for row in sorted(rows, key=lambda item: item['index']):
            index = row['index']
            embedded = by_id[index]
            mapping = {'local_path': 'localPath', 'filename': 'filename', 'bytes': 'bytes',
                       'sha256': 'sha256', 'downloaded_from': 'url'}
            for packed, recorded in mapping.items():
                require(embedded.get(packed) == row[recorded],
                        f'{index:03}: {packed} differs between the archive and audit record.')
            require(PurePosixPath(row['localPath']).name == row['filename'],
                    f'{index:03}: filename/path mismatch.')
            require(row['filename'].startswith(f'{index:03}_'), f'{index:03}: wrong filename ID.')
            require(row['filename'] in ledger and row['url'] in ledger,
                    f'{index:03}: filename or source attribution missing from the original ledger.')
            require(bool(re.fullmatch(r'[0-9a-f]{64}', row['sha256'])), f'{index:03}: invalid SHA-256.')
            info = source.getinfo(row['localPath'])
            require(0 < info.file_size == row['bytes'] <= MAX_IMAGE_BYTES,
                    f'{index:03}: invalid byte length or exceeded image budget.')
            with source.open(info) as stream:
                require(digest(stream) == row['sha256'], f'{index:03}: image SHA-256 mismatch.')
            checked.append({'index': index, 'sha256': row['sha256'], 'bytes': info.file_size})
    return {'passed': True, 'archiveSHA256': archive_hash, 'imagesChecked': len(checked),
            'uniqueImages': 100, 'sourceAttributionMatches': True,
            'scope': 'Integrity and attribution continuity only; not a visual-quality acceptance.',
            'images': checked}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Path to the original supplied ZIP.')
    parser.add_argument('--record', type=Path,
                        default=Path(__file__).resolve().parents[2] / 'docs/production/solvane-reference-integrity.json')
    parser.add_argument('--ledger', type=Path,
                        default=Path(__file__).resolve().parents[2] / 'docs/production/HORIZON_REFERENCE_IMPLEMENTATION.md')
    parser.add_argument('--output', type=Path, help='Optional JSON audit receipt; refuses existing paths.')
    args = parser.parse_args()
    try:
        record_bytes = args.record.read_bytes()
        result = audit(args.archive, json.loads(record_bytes),
                       args.ledger.read_text(encoding='utf-8'))
        if args.output:
            with args.output.open('x', encoding='utf-8') as stream:
                json.dump(result, stream, indent=2)
                stream.write('\n')
        print('PASS: 100 distinct reference images; all bytes, hashes, paths and source attributions match.')
        return 0
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
