"""Real synthetic filesystem integration; never opens production roots."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from typing import Any
from unittest.mock import patch

LIB = Path(__file__).resolve().parents[3] / 'lib/local-qualification'


def load(name) -> Any:
    spec = importlib.util.spec_from_file_location(name, LIB / (name + '.py'))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((LIB / 'snapshot_acquisition.py').exists(), 'runnable acquisition adapter missing')
        modules = patch.dict(sys.modules)
        modules.start()
        self.addCleanup(modules.stop)
        self.b = load('discovery_boundary')
        load('snapshot_boundary')
        self.a = load('snapshot_acquisition')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.source = self.base / 'source'
        self.source.mkdir()
        self.selected = self.source / 'benchmark-fixture'
        self.selected.mkdir()
        self.file = self.selected / 'input.json'
        self.file.write_bytes(b'{"synthetic":true}')
        self.out = self.base / 'output'
        self.out.mkdir(mode=0o700)
        self.policy = self.base / 'policy.json'
        self.configure([])
        self.a.ROOTS = (str(self.source),)
        self.a.OUTPUT_ROOT = str(self.out)
        self.a.POLICY_PATH = str(self.policy)

    def configure(self, grants):
        data = json.dumps({'version': 1, 'grants': grants}).encode()
        self.policy.write_bytes(data)
        self.policy.chmod(0o600)
        self.a.POLICY_SHA256 = hashlib.sha256(data).hexdigest()

    def link(self):
        target = self.base / 'empty'
        target.mkdir()
        link = self.selected / 'approved-link'
        link.symlink_to(target)
        grant = {'root_index': 0, 'relative_components': ['benchmark-fixture', 'approved-link'],
                 'grant': {'link_identity': self.b.identity(link.lstat()), 'link_text': str(target),
                           'target_path': str(target), 'target_identity': self.b.directory_identity(target.stat())}}
        self.configure([grant])
        return link, target

    def invoke(self):
        return self.a.acquire()

    def no_manifest(self):
        self.assertEqual(list(self.out.glob('*/manifest.json')), [])

    def test_exact_copy_manifest_hash_permissions_original_unchanged(self):
        before = self.b.identity(self.file.stat())
        result = self.invoke()
        run = self.out / result['snapshot']
        manifest = json.loads((run / 'manifest.json').read_bytes())
        self.assertEqual(manifest['status'], 'acquired-not-loader-approved')
        self.assertFalse(manifest['reviewApproved'])
        self.assertEqual(manifest['files'], 1)
        record = next(r for r in manifest['entries'] if r['disposition'] == 'copied')
        self.assertEqual((run / record['artifact']).read_bytes(), self.file.read_bytes())
        self.assertEqual(record['sha256'], hashlib.sha256(self.file.read_bytes()).hexdigest())
        self.assertEqual(before, self.b.identity(self.file.stat()))
        self.assertEqual(stat.S_IMODE(run.stat().st_mode), 0o700)
        for path in run.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertNotIn(str(self.source), json.dumps(result))

    def test_explicit_empty_link_disposition(self):
        link, target = self.link()
        result = self.invoke()
        manifest = json.loads((self.out / result['snapshot'] / 'manifest.json').read_bytes())
        self.assertEqual(sum(r['disposition'] == 'verified-empty-directory-link' for r in manifest['entries']), 1)
        self.assertTrue(link.is_symlink())
        self.assertEqual(list(target.iterdir()), [])

    def test_unknown_link_rejected(self):
        (self.selected / 'unknown').symlink_to(self.base)
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_changed_link_rejected(self):
        link, _ = self.link()
        link.unlink()
        link.symlink_to(self.base)
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_nonempty_target_rejected(self):
        _, target = self.link()
        (target / 'forbidden.json').write_text('synthetic forbidden')
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_hardlink_and_fifo_rejected(self):
        for kind in ('hardlink', 'fifo'):
            with self.subTest(kind=kind):
                bad = self.selected / 'bad.json'
                if kind == 'hardlink': os.link(self.file, bad)
                else: os.mkfifo(bad)
                with self.assertRaises(self.b.Rejected): self.invoke()
                self.no_manifest()
                bad.unlink()

    def test_byte_and_file_limits_rejected(self):
        for name, value in (('MAX_TOTAL', 1), ('MAX_FILES', 0), ('MAX_FILE', 1)):
            with self.subTest(limit=name), patch.object(self.b, name, value):
                with self.assertRaises(self.b.Rejected): self.invoke()
                self.no_manifest()

    def test_source_mutation_after_copy_rejected(self):
        real = self.a.save
        seen = []
        def mutate(fd, name, data):
            result = real(fd, name, data)
            if name.endswith('.json') and name != 'manifest.json':
                self.file.write_text('changed synthetic')
                seen.append(True)
            return result
        with patch.object(self.a, 'save', side_effect=mutate):
            with self.assertRaises(self.b.Rejected): self.invoke()
        self.assertTrue(seen)
        self.no_manifest()

    def test_ancestor_swap_never_reads_outside(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'input.json').write_text('forbidden synthetic')
        forbidden = (outside / 'input.json').stat().st_ino
        real_read, real_file = os.read, self.b.read_file
        read_inodes, swaps = [], []
        def observe(fd, count):
            read_inodes.append(os.fstat(fd).st_ino)
            return real_read(fd, count)
        def swap(fd, name, remaining):
            if name == 'input.json' and not swaps:
                self.selected.rename(self.source / 'old-benchmark')
                self.selected.symlink_to(outside)
                swaps.append(True)
            return real_file(fd, name, remaining)
        with patch.object(os, 'read', side_effect=observe), patch.object(self.b, 'read_file', side_effect=swap):
            with self.assertRaises(self.b.Rejected): self.invoke()
        self.assertEqual(swaps, [True])
        self.assertIn(self.file.parent.parent.joinpath('old-benchmark/input.json').stat().st_ino, read_inodes)
        self.assertNotIn(forbidden, read_inodes)
        self.no_manifest()

    def test_policy_pin_mode_and_unused_grant_fail(self):
        self.a.POLICY_SHA256 = '0' * 64
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.configure([])
        self.policy.chmod(0o644)
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_output_symlink_and_insecure_directory_rejected(self):
        self.out.chmod(0o755)
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.out.chmod(0o700)
        alias = self.base / 'alias'
        alias.symlink_to(self.out)
        self.a.OUTPUT_ROOT = str(alias)
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_write_failure_never_success_manifest(self):
        with patch.object(self.a, 'save', side_effect=OSError('synthetic write failure')):
            with self.assertRaises(OSError): self.invoke()
        self.no_manifest()

    def test_both_fixed_roots_and_duplicate_bytes_preserved(self):
        second = self.base / 'second-source'
        selected = second / 'benchmark-second'
        selected.mkdir(parents=True)
        (selected / 'duplicate.json').write_bytes(self.file.read_bytes())
        self.a.ROOTS = (str(self.source), str(second))
        result = self.invoke()
        manifest = json.loads((self.out / result['snapshot'] / 'manifest.json').read_bytes())
        records = [r for r in manifest['entries'] if r['disposition'] == 'copied']
        self.assertEqual(manifest['roots_completed'], [0, 1])
        self.assertEqual(len(records), 2)
        self.assertEqual(len({r['sha256'] for r in records}), 1)
        self.assertEqual(len({r['artifact'] for r in records}), 2)

    def test_incomplete_second_root_never_publishes_manifest(self):
        self.a.ROOTS = (str(self.source), str(self.base / 'missing-source'))
        with self.assertRaises(FileNotFoundError): self.invoke()
        self.no_manifest()

    def test_unused_grant_rejected(self):
        link, _ = self.link()
        link.unlink()
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_manifest_partial_write_removed_on_failure(self):
        real = self.a.save
        reached = []
        def partial(fd, name, data):
            if name == 'manifest.json':
                real(fd, name, data[:10])
                reached.append(True)
                raise OSError('synthetic disk error')
            return real(fd, name, data)
        with patch.object(self.a, 'save', side_effect=partial):
            with self.assertRaises(OSError): self.invoke()
        self.assertEqual(reached, [True])
        self.no_manifest()

    def test_exclusive_save_preserves_preexisting_artifact(self):
        path = self.out / 'artifact.json'
        path.write_bytes(b'original synthetic')
        fd = os.open(self.out, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with self.assertRaises(FileExistsError): self.a.save(fd, path.name, b'replacement')
        finally: os.close(fd)
        self.assertEqual(path.read_bytes(), b'original synthetic')

    def test_entry_and_depth_limits(self):
        for name, value in (('MAX_ENTRIES', 0), ('MAX_DEPTH', 0)):
            with self.subTest(limit=name), patch.object(self.a, name, value):
                with self.assertRaises(self.b.Rejected): self.invoke()
                self.no_manifest()

    def test_symlink_source_root_rejected(self):
        alias = self.base / 'source-alias'
        alias.symlink_to(self.source)
        self.a.ROOTS = (str(alias),)
        with self.assertRaises(self.b.Rejected): self.invoke()
        self.no_manifest()

    def test_actual_isolated_cli_with_staged_synthetic_fixed_constants(self):
        # Exercise the real -I CLI by staging code in test-owned paths. This is
        # not an operator override or a test switch in the shipped adapter.
        stage = self.base / 'stage'
        stage.mkdir()
        for name in ('discovery_boundary.py', 'snapshot_boundary.py'):
            (stage / name).write_bytes((LIB / name).read_bytes())
        code = (LIB / 'snapshot_acquisition.py').read_text()
        code = code.replace('ROOTS = boundary.ROOTS', 'ROOTS = ' + repr((str(self.source),)))
        code = code.replace("OUTPUT_ROOT = str(Path(__file__).absolute().parents[2] / 'tmp/local-qualification/acquisitions')", 'OUTPUT_ROOT = ' + repr(str(self.out)))
        code = code.replace("POLICY_PATH = '/Users/ct-mac-mini/dev/local-model-migration-planning/snapshot-inspection-policy.json'", 'POLICY_PATH = ' + repr(str(self.policy)))
        pin_line = next(line for line in code.splitlines() if line.startswith('POLICY_SHA256:'))
        code = code.replace(pin_line, 'POLICY_SHA256 = ' + repr(self.a.POLICY_SHA256))
        (stage / 'snapshot_acquisition.py').write_text(code)
        p = subprocess.run(['/usr/bin/python3', '-I', '-S', str(stage / 'snapshot_acquisition.py'), '--acquire'],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stderr, '')
        result = json.loads(p.stdout)
        manifest = self.out / result['snapshot'] / 'manifest.json'
        self.assertEqual(hashlib.sha256(manifest.read_bytes()).hexdigest(), result['manifest_sha256'])
        self.assertEqual(result['files'], 1)

    def test_cli_help_and_arbitrary_path_rejected_without_root_io(self):
        for args, code in ((['--help'], 0), (['--source', str(self.source)], 1)):
            p = subprocess.run(['/usr/bin/python3', '-I', '-S', str(LIB / 'snapshot_acquisition.py')] + args,
                               capture_output=True, text=True)
            self.assertEqual(p.returncode, code, p.stderr)
            self.assertEqual(p.stderr, '')
            self.assertNotIn(str(self.source), p.stdout)


if __name__ == '__main__':
    unittest.main()
