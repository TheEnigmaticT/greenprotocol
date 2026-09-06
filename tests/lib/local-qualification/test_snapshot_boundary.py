"""Synthetic-only tests for the explicitly approved empty-link disposition."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

LIB = Path(__file__).resolve().parents[3] / 'lib/local-qualification'
spec = importlib.util.spec_from_file_location('discovery_boundary', LIB / 'discovery_boundary.py')
assert spec is not None and spec.loader is not None
discovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(discovery)
sys.modules['discovery_boundary'] = discovery


class EmptyLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        self.target = self.root / 'target'
        self.target.mkdir()
        self.link = self.source / 'approved-link'
        self.link.symlink_to(self.target)
        self.fd = os.open(self.source, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, self.fd)
        self.grant = {
            'link_identity': discovery.identity(self.link.lstat()),
            'link_text': os.readlink(self.link),
            'target_path': str(self.target),
            'target_identity': discovery.directory_identity(self.target.stat()),
        }

    def invoke(self, grant=None):
        # Delayed import makes missing implementation an explicit behavior failure.
        path = LIB / 'snapshot_boundary.py'
        self.assertTrue(path.exists(), 'empty-link disposition implementation is missing')
        spec = importlib.util.spec_from_file_location('snapshot_boundary', path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.verify_empty_link(self.fd, 'approved-link', grant)

    def test_pinned_empty_link_yields_explicit_disposition_without_content_reads(self):
        with patch.object(os, 'read', side_effect=AssertionError('content read forbidden')):
            result = self.invoke(self.grant)
        self.assertEqual(result['disposition'], 'verified-empty-directory-link')
        self.assertEqual(result['entries'], 0)
        self.assertEqual(len(result['link_identity_sha256']), 64)
        self.assertNotIn(str(self.target), str(result))
        self.assertTrue(self.link.is_symlink())
        self.assertEqual(discovery.identity(self.link.lstat()), self.grant['link_identity'])

    def test_absent_grant_fails_before_target_enumeration(self):
        with patch.object(os, 'scandir', side_effect=AssertionError('no target enumeration')):
            with self.assertRaises(discovery.Rejected):
                self.invoke()

    def test_changed_link_fails_before_target_enumeration(self):
        self.link.unlink()
        self.link.symlink_to(self.root / 'unapproved')
        with patch.object(os, 'scandir', side_effect=AssertionError('no target enumeration')):
            with self.assertRaises(discovery.Rejected):
                self.invoke(self.grant)

    def test_new_target_entry_rejects_without_reading_it(self):
        (self.target / 'private.json').write_text('synthetic fixture')
        # Even a freshly pinned identity does not authorize nonempty targets.
        self.grant['target_identity'] = discovery.directory_identity(self.target.stat())
        with patch.object(os, 'read', side_effect=AssertionError('content read forbidden')):
            with self.assertRaises(discovery.Rejected):
                self.invoke(self.grant)

    def test_replaced_target_rejects_before_enumeration(self):
        self.target.rename(self.root / 'old-target')
        self.target.mkdir()
        with patch.object(os, 'scandir', side_effect=AssertionError('no target enumeration')):
            with self.assertRaises(discovery.Rejected):
                self.invoke(self.grant)

    def test_target_ancestor_symlink_rejects_without_enumeration(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.grant['target_path'] = str(alias / 'target')
        with patch.object(os, 'scandir', side_effect=AssertionError('no target enumeration')):
            with self.assertRaises(discovery.Rejected):
                self.invoke(self.grant)

    def test_mutation_during_enumeration_rejects_and_never_follows_new_link(self):
        original = os.scandir
        reached = []
        def mutate(fd):
            reached.append(True)
            self.link.unlink()
            self.link.symlink_to(self.root / 'unapproved')
            return original(fd)
        with patch.object(os, 'scandir', side_effect=mutate):
            with self.assertRaises(discovery.Rejected):
                self.invoke(self.grant)
        self.assertEqual(reached, [True])


if __name__ == '__main__':
    unittest.main()
