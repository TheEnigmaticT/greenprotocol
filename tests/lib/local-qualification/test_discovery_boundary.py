"""Only test-owned synthetic fixtures; observer lives at actual helper I/O."""
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).resolve().parents[3] / 'lib/local-qualification/discovery_boundary.py'

class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(HELPER.is_file(), 'descriptor boundary implementation missing')
        spec = importlib.util.spec_from_file_location('boundary', HELPER)
        self.h = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.h)
        self.tmp = tempfile.TemporaryDirectory(prefix='discovery-python-test-')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.roots = [self.base / '0', self.base / '1']
        for r in self.roots:
            (r / 'synthetic-benchmark').mkdir(parents=True)
        self.h.ROOTS = tuple(str(r) for r in self.roots)
        self.inside = self.roots[0] / 'synthetic-benchmark'
        self.outside = self.base / 'outside'
        self.outside.mkdir()
        (self.inside / 'fixture.json').write_bytes(b'{"sourceText":"ALLOWED"}')
        (self.outside / 'fixture.json').write_bytes(b'{"sourceText":"FORBIDDEN"}')
        (self.outside / 'outside-only.json').write_bytes(b'{}')

    def race(self, phase):
        h = self.h
        real_open, real_read, real_scan = os.open, os.read, os.scandir
        replaced = False
        consumed = []
        enumerated = []
        inside_ino = self.inside.stat().st_ino
        def replace():
            nonlocal replaced
            self.inside.rename(self.base / 'retained')
            self.inside.symlink_to(self.outside, target_is_directory=True)
            replaced = True
        def opened(name, flags, *args, **kwargs):
            if phase == 'file' and name == 'fixture.json' and not replaced:
                replace()
            return real_open(name, flags, *args, **kwargs)
        def read(fd, length):
            b = real_read(fd, length)
            consumed.append(b)
            return b
        class Scan:
            def __init__(self, fd):
                if phase == 'directory' and os.fstat(fd).st_ino == inside_ino and not replaced:
                    replace()
                self.it = real_scan(fd)
            def __enter__(self): return self
            def __exit__(self, *args): self.it.close()
            def __iter__(self): return self
            def __next__(self):
                e = next(self.it)
                enumerated.append(e.name)
                return e
        # Check capabilities before substituting exact low-level primitives.
        h.capabilities()
        with patch.object(h, 'capabilities'), patch.object(h.os, 'open', opened), patch.object(h.os, 'read', read), patch.object(h.os, 'scandir', Scan):
            with self.assertRaises(h.Rejected) as caught:
                h.discover(io.BytesIO())
        self.assertEqual(caught.exception.code, 'DISCOVERY_UNSAFE_PATH')
        self.assertTrue(replaced, 'race must actually execute')
        self.assertNotIn(b'FORBIDDEN', b''.join(consumed))
        self.assertNotIn('outside-only.json', enumerated)
        # Positive observers rule out vacuity when implementation moves over IPC.
        self.assertIn('fixture.json', enumerated)
        if phase == 'file': self.assertIn(b'ALLOWED', b''.join(consumed))

    def test_file_ancestor_replacement_never_reads_outside(self): self.race('file')
    def test_directory_replacement_never_enumerates_outside(self): self.race('directory')
    def test_success_real_descriptors(self):
        out = io.BytesIO()
        self.h.discover(out)
        self.assertTrue(out.getvalue().startswith(b'DSC1'))
        self.assertIn(b'ALLOWED', out.getvalue())
        self.assertNotIn(b'FORBIDDEN', out.getvalue())
    def test_missing_capability_precedes_any_root_open(self):
        with patch.object(self.h.os, 'supports_dir_fd', set()), patch.object(self.h.os, 'open') as opened:
            with self.assertRaises(self.h.Rejected): self.h.discover(io.BytesIO())
            opened.assert_not_called()
    def test_child_components_are_literal(self):
        for name in ('', '.', '..', '/tmp', 'a/b', 'a\x00b'):
            with self.assertRaises(self.h.Rejected): self.h.component(name)

if __name__ == '__main__': unittest.main(verbosity=2)
