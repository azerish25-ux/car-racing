"""Synthetic byte fixtures for the read-only reference-pack audit; no media copied."""
from __future__ import annotations

import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

from verify_reference_pack import AuditError, audit, digest


class ReferenceAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.archive = Path(self.temp.name) / 'references.zip'
        self.images = {f'images/{n:03}_synthetic.jpg': f'synthetic bytes {n}'.encode()
                       for n in range(1, 101)}
        self.manifest = [
            {'index': n, 'local_path': path, 'filename': Path(path).name,
             'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
             'downloaded_from': f'https://example.invalid/reference/{n}'}
            for n, (path, data) in enumerate(self.images.items(), 1)
        ]
        self.record = {'images': [
            {'index': m['index'], 'localPath': m['local_path'], 'filename': m['filename'],
             'bytes': m['bytes'], 'sha256': m['sha256'], 'url': m['downloaded_from']}
            for m in self.manifest]}
        self.ledger = '\n'.join(f"{m['filename']} {m['downloaded_from']}" for m in self.manifest)
        self.pack()

    def pack(self, duplicate: bool = False) -> None:
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for path, data in self.images.items():
                archive.writestr(path, data)
            archive.writestr('manifest.json', json.dumps(self.manifest))
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr(next(iter(self.images)), b'duplicate')
        self.record['archiveSha256'] = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def test_valid_100_entry_archive(self) -> None:
        result = audit(self.archive, self.record, self.ledger)
        self.assertTrue(result['passed'])
        self.assertEqual(result['imagesChecked'], 100)

    def test_compact_manifest_anchor(self) -> None:
        with zipfile.ZipFile(self.archive) as source:
            manifest_hash = hashlib.sha256(source.read('manifest.json')).hexdigest()
        compact = {'archiveSha256': self.record['archiveSha256'], 'manifestSha256': manifest_hash}
        self.assertEqual(audit(self.archive, compact, self.ledger)['imagesChecked'], 100)

    def test_changed_manifest_anchor_is_rejected(self) -> None:
        compact = {'archiveSha256': self.record['archiveSha256'], 'manifestSha256': '0' * 64}
        with self.assertRaisesRegex(AuditError, 'manifest SHA-256'):
            audit(self.archive, compact, self.ledger)

    def test_stream_digest(self) -> None:
        self.assertEqual(digest(io.BytesIO(b'abc')), hashlib.sha256(b'abc').hexdigest())

    def test_changed_archive_is_rejected(self) -> None:
        self.archive.write_bytes(self.archive.read_bytes() + b'changed')
        with self.assertRaisesRegex(AuditError, 'Archive SHA-256'):
            audit(self.archive, self.record, self.ledger)

    def test_duplicate_zip_entry_is_rejected(self) -> None:
        self.pack(duplicate=True)
        with self.assertRaisesRegex(AuditError, 'Duplicate ZIP'):
            audit(self.archive, self.record, self.ledger)

    def test_missing_record_is_rejected(self) -> None:
        self.record['images'].pop()
        with self.assertRaisesRegex(AuditError, 'exactly 100'):
            audit(self.archive, self.record, self.ledger)

    def test_duplicate_reference_id_is_rejected(self) -> None:
        self.manifest[-1]['index'] = 1
        self.pack()
        with self.assertRaisesRegex(AuditError, 'reference IDs'):
            audit(self.archive, self.record, self.ledger)

    def test_altered_image_with_same_size_is_rejected(self) -> None:
        path = next(iter(self.images))
        self.images[path] = b'X' * len(self.images[path])
        self.pack()
        with self.assertRaisesRegex(AuditError, 'image SHA-256 mismatch'):
            audit(self.archive, self.record, self.ledger)

    def test_source_attribution_mismatch_is_rejected(self) -> None:
        self.manifest[0]['downloaded_from'] = 'https://example.invalid/wrong-source'
        self.pack()
        with self.assertRaisesRegex(AuditError, 'downloaded_from differs'):
            audit(self.archive, self.record, self.ledger)

    def test_missing_original_ledger_source_is_rejected(self) -> None:
        with self.assertRaisesRegex(AuditError, 'source attribution missing'):
            audit(self.archive, self.record, '')

    def test_extra_image_is_rejected(self) -> None:
        self.images['images/101_extra.jpg'] = b'extra'
        self.pack()
        with self.assertRaisesRegex(AuditError, 'image file set'):
            audit(self.archive, self.record, self.ledger)

    def test_unsafe_zip_path_is_rejected_without_extracting(self) -> None:
        self.images['../outside.jpg'] = b'extra'
        self.pack()
        with self.assertRaisesRegex(AuditError, 'Unsafe ZIP entry'):
            audit(self.archive, self.record, self.ledger)
        self.assertFalse((self.archive.parent.parent / 'outside.jpg').exists())

    def test_byte_count_mismatch_is_rejected(self) -> None:
        original = copy.deepcopy(self.record)
        original['images'][0]['bytes'] += 1
        with self.assertRaisesRegex(AuditError, 'bytes differs'):
            audit(self.archive, original, self.ledger)


if __name__ == '__main__':
    unittest.main()
