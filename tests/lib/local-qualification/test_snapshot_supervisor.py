"""Synthetic supervisor execution only: never private acquisition."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import test_snapshot_acquisition as fixture
from test_snapshot_acquisition import LIB, load

class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((LIB / 'snapshot_supervisor.py').exists(), 'supervisor missing')
        self.fixture = fixture.AcquisitionTests('test_exact_copy_manifest_hash_permissions_original_unchanged')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.s = load('snapshot_supervisor')
        self.s.a = self.fixture.a
        self.s.DEADLINE = 0.3
        self.result = self.fixture.invoke()
        self.run_dir = self.fixture.out / self.result['snapshot']
        self.child = self.fixture.base / 'child.py'
        self.s.COMMAND = ('/usr/bin/python3', '-I', '-S', str(self.child))

    def execute(self, body):
        self.child.write_text(body)
        return self.s.launch()

    def refresh_snapshot(self):
        self.result = self.fixture.invoke()
        self.run_dir = self.fixture.out / self.result['snapshot']

    def rich_snapshot(self):
        nested = self.fixture.selected / 'nested' / 'deeper'
        nested.mkdir(parents=True)
        (nested / 'duplicate.json').write_bytes(self.fixture.file.read_bytes())
        (self.fixture.selected / 'notes.txt').write_text('synthetic')
        (self.fixture.source / 'benchmark-top.json').write_text('{}')
        self.fixture.link()
        self.refresh_snapshot()

    def reject_candidate(self, mutate):
        path = self.run_dir / 'manifest.json'
        original, result = path.read_bytes(), dict(self.result)
        # Establish acceptance before mutation, not an unrelated early failure.
        self.assertEqual(self.execute('print(' + repr(json.dumps(result)) + ')'), result)
        manifest = json.loads(original)
        mutate(manifest)
        manifest['enumerated_entries'] = len(manifest['entries'])
        blob = self.fixture.a.encode(manifest)
        path.write_bytes(blob)
        self.result['manifest_sha256'] = self.fixture.a.digest(blob)
        self.assertEqual(self.fixture.a.digest(path.read_bytes()), self.result['manifest_sha256'])
        try:
            with self.assertRaises(self.s.Failed) as error:
                self.execute('print(' + repr(json.dumps(self.result)) + ')')
            self.assertEqual(str(error.exception), 'VALIDATION_FAILED')
        finally:
            self.assertEqual(self.s.LAST_EXIT, 0)
            path.write_bytes(original)
            self.result = result

    def test_impossible_copied_source_identity_rejected(self):
        def mutate(m):
            next(r for r in m['entries'] if r['disposition'] == 'copied')['source_identity'] = [0] * 7
        self.reject_candidate(mutate)

    def test_disposition_source_mode_and_regular_link_count_rejected(self):
        self.rich_snapshot()
        for disposition in ('copied', 'non-json-or-top-level-file', 'directory'):
            for index, value in ((2, 0),) + (((6, 2), (6, 0)) if disposition != 'directory' else ()):
                with self.subTest(disposition=disposition, index=index, value=value):
                    def mutate(m):
                        r = next(r for r in m['entries'] if r['disposition'] == disposition)
                        r['source_identity'][index] = value
                        if disposition == 'directory':
                            r['directory_identity'][2] = value
                    self.reject_candidate(mutate)

    def test_link_mode_rejected_even_with_matching_synthetic_grant(self):
        self.rich_snapshot()
        def mutate(m):
            policy = json.loads(self.fixture.policy.read_bytes())
            identity = policy['grants'][0]['grant']['link_identity']
            identity[2] = 0
            self.fixture.configure(policy['grants'])
            m['policy_sha256'] = self.fixture.a.POLICY_SHA256
            r = next(r for r in m['entries'] if r['disposition'] == 'verified-empty-directory-link')
            r['source_identity'] = identity
            r['link_identity_sha256'] = self.fixture.a.digest(json.dumps(identity, separators=(',', ':')).encode())
        self.reject_candidate(mutate)

    def test_copied_source_size_must_match_bytes(self):
        def mutate(m):
            next(r for r in m['entries'] if r['disposition'] == 'copied')['source_identity'][3] += 1
        self.reject_candidate(mutate)

    def test_directory_identity_semantic_projection_rejected(self):
        for index in (None, 0, 1, 2, 3, 4):
            with self.subTest(index=index):
                def mutate(m):
                    r = next(r for r in m['entries'] if r['disposition'] == 'directory')
                    if index is None:
                        r['directory_identity'] = [0] * 5
                    else:
                        r['directory_identity'][index] += 1
                self.reject_candidate(mutate)

    def test_missing_parent_at_each_depth_and_wrong_root_rejected(self):
        self.rich_snapshot()
        for depth in (1, 2, 3):
            with self.subTest(depth=depth):
                def mutate(m):
                    m['entries'] = [r for r in m['entries'] if not (
                        r['disposition'] == 'directory' and len(r['relative_components']) == depth)]
                self.reject_candidate(mutate)
        # A parent present only in a different completed root is still missing.
        second = self.fixture.base / 'second-root'
        (second / 'benchmark-fixture').mkdir(parents=True)
        self.fixture.a.ROOTS += (str(second),)
        self.refresh_snapshot()
        def wrong_root(m):
            m['entries'] = [r for r in m['entries'] if not (
                r['root_index'] == 0 and r['disposition'] == 'directory' and len(r['relative_components']) == 1)]
        self.reject_candidate(wrong_root)

    def test_descendant_under_each_non_directory_disposition_rejected(self):
        self.rich_snapshot()
        for disposition in ('copied', 'non-json-or-top-level-file', 'verified-empty-directory-link'):
            with self.subTest(disposition=disposition):
                def mutate(m):
                    parent = next(r for r in m['entries'] if r['disposition'] == disposition)
                    child = dict(next(r for r in m['entries'] if r['disposition'] == 'directory'))
                    child['relative_components'] = parent['relative_components'] + ['child']
                    m['entries'].append(child)
                self.reject_candidate(mutate)

    def test_valid_nested_duplicate_bytes_siblings_and_empty_link(self):
        self.rich_snapshot()
        m = json.loads((self.run_dir / 'manifest.json').read_bytes())
        copies = [r for r in m['entries'] if r['disposition'] == 'copied']
        self.assertEqual(len(copies), 2)
        self.assertEqual(copies[0]['sha256'], copies[1]['sha256'])
        self.assertNotEqual(copies[0]['relative_components'], copies[1]['relative_components'])
        self.assertEqual(self.execute('print(' + repr(json.dumps(self.result)) + ')'), self.result)

    def test_normal_success_full_validation(self):
        got = self.execute('print(' + repr(json.dumps(self.result)) + ')')
        self.assertEqual(got, self.result)

    def test_timeout_kills_reaps_rejects_complete_manifest(self):
        with patch.object(self.s.subprocess, 'Popen', wraps=self.s.subprocess.Popen) as spawn:
            with self.assertRaises(self.s.Failed) as error:
                self.execute('import time\ntime.sleep(60)')
            self.assertEqual(str(error.exception), 'TIMEOUT')
        # Launch records exact child's final status, not manifest existence.
        self.assertEqual(self.s.LAST_EXIT, -9)
        self.assertTrue((self.run_dir / 'manifest.json').exists())
        self.assertEqual(spawn.call_count, 1)

    def test_overflow_kills_reaps(self):
        with self.assertRaises(self.s.Failed) as error:
            self.execute("import os,time\nos.write(1,b'x'*10000)\ntime.sleep(60)")
        self.assertEqual(str(error.exception), 'STDOUT_LIMIT')
        self.assertEqual(self.s.LAST_EXIT, -9)

    def test_nonzero_complete_looking_result_rejected(self):
        with self.assertRaises(self.s.Failed) as error:
            self.execute('import sys\nprint(' + repr(json.dumps(self.result)) + ')\nsys.exit(23)')
        self.assertEqual(str(error.exception), 'CHILD_FAILED')
        self.assertEqual(self.s.LAST_EXIT, 23)
        self.assertTrue((self.run_dir / 'manifest.json').exists())

    def test_real_staged_isolated_supervisor_and_acquisition_cli(self):
        self.rich_snapshot()
        stage = self.fixture.base / 'stage'
        stage.mkdir()
        for name in ('discovery_boundary.py', 'snapshot_boundary.py', 'snapshot_supervisor.py'):
            (stage / name).write_bytes((LIB / name).read_bytes())
        code = (LIB / 'snapshot_acquisition.py').read_text()
        replacements = {
            'ROOTS = boundary.ROOTS': 'ROOTS = ' + repr(self.fixture.a.ROOTS),
            "OUTPUT_ROOT = str(Path(__file__).absolute().parents[2] / 'tmp/local-qualification/acquisitions')": 'OUTPUT_ROOT = ' + repr(str(self.fixture.out)),
            "POLICY_PATH = '/Users/ct-mac-mini/dev/local-model-migration-planning/snapshot-inspection-policy.json'": 'POLICY_PATH = ' + repr(str(self.fixture.policy)),
            next(line for line in code.splitlines() if line.startswith('POLICY_SHA256:')): 'POLICY_SHA256 = ' + repr(self.fixture.a.POLICY_SHA256),
        }
        for old, new in replacements.items():
            self.assertEqual(code.count(old), 1)
            code = code.replace(old, new)
        (stage / 'snapshot_acquisition.py').write_text(code)
        p = self.s.subprocess.run(['/usr/bin/python3', '-I', '-S', str(stage / 'snapshot_supervisor.py'), '--acquire'],
            stdin=self.s.subprocess.DEVNULL, capture_output=True, env={}, timeout=5)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertEqual(p.stderr, b'')
        result = json.loads(p.stdout)
        self.assertEqual(result['status'], 'acquired-not-loader-approved')
        self.assertNotEqual(result['snapshot'], self.result['snapshot'])
        self.assertEqual(self.s.validate(p.stdout), result)

    def test_manifest_counts_policy_roots_and_status_rejected(self):
        path = self.run_dir / 'manifest.json'
        original = path.read_bytes()
        for field, bad in [('files', 9), ('bytes', 1), ('roots_completed', []),
                           ('policy_sha256', '0' * 64), ('reviewApproved', True),
                           ('enumerated_entries', 0), ('status', 'approved')]:
            with self.subTest(field=field):
                manifest = json.loads(original)
                manifest[field] = bad
                raw = self.fixture.a.encode(manifest)
                path.write_bytes(raw)
                self.result['manifest_sha256'] = self.fixture.a.digest(raw)
                with self.assertRaises(self.s.Failed):
                    self.s.validate(json.dumps(self.result).encode())

    def test_corrupt_artifact_rejected(self):
        (self.run_dir / 'artifact-0001.json').write_bytes(b'bad')
        with self.assertRaises(Exception):
            self.execute('print(' + repr(json.dumps(self.result)) + ')')

    def test_bad_manifest_digest_rejected(self):
        self.result['manifest_sha256'] = '0' * 64
        with self.assertRaises(Exception):
            self.execute('print(' + repr(json.dumps(self.result)) + ')')

if __name__ == '__main__': unittest.main()
