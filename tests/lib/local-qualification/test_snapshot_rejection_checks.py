"""Attribution only; test-owned files and fixed synthetic error metadata."""
import ast
import contextlib
import io
import json
import os
import sys
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch
import test_snapshot_acquisition as fixtures


class RejectionCheckTests(fixtures.unittest.TestCase):
    a: Any
    b: Any
    policy: Path
    out: Path
    selected: Path
    base: Path
    file: Path
    # Reuse test-owned setup helpers without inheriting integration cases.
    setUp = fixtures.AcquisitionTests.setUp
    configure = fixtures.AcquisitionTests.configure
    invoke = fixtures.AcquisitionTests.invoke
    no_manifest = fixtures.AcquisitionTests.no_manifest
    link = fixtures.AcquisitionTests.link
    def rejected(self, check, fn, code='DISCOVERY_UNSAFE_PATH'):
        with self.assertRaises(self.b.Rejected) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(caught.exception.check, check)
        self.assertIn(check, self.b.CHECKS)

    def policy_value(self, value):
        raw = json.dumps(value).encode()
        self.policy.write_bytes(raw)
        self.a.POLICY_SHA256 = self.a.digest(raw)

    def test_policy_schema_attribution(self):
        grant = {'link_identity': [1] * 7, 'target_identity': [1] * 5,
                 'link_text': 'synthetic', 'target_path': '/synthetic'}
        record = {'root_index': 0, 'relative_components': ['benchmark-fixture'], 'grant': grant}
        cases = [([], 'POLICY_SCHEMA'),
                 ({'version': 1, 'grants': [{}]}, 'POLICY_RECORD_SCHEMA'),
                 ({'version': 1, 'grants': [dict(record, root_index=True)]}, 'POLICY_RECORD_FIELDS'),
                 ({'version': 1, 'grants': [dict(record, relative_components=['other'])]}, 'POLICY_SELECTION'),
                 ({'version': 1, 'grants': [dict(record, grant=dict(grant, link_identity=[1]))]}, 'POLICY_IDENTITY_SCHEMA')]
        for value, check in cases:
            with self.subTest(check=check):
                self.policy_value(value)
                self.rejected(check, self.a.load_policy)

    def test_private_metadata_attribution(self):
        self.policy.chmod(0o644)
        self.rejected('PRIVATE_METADATA_REQUIREMENTS', self.a.load_policy)
        self.out.chmod(0o755)
        self.rejected('PRIVATE_METADATA_REQUIREMENTS', lambda: self.a.private(self.out.stat(), True))

    def test_unknown_link_and_invalid_grant_attribution(self):
        (self.selected / 'unknown').symlink_to(self.base)
        self.rejected('EMPTY_LINK_GRANT_SCHEMA', self.invoke)
        self.no_manifest()
        grant = {'link_identity': (), 'target_identity': (), 'link_text': '', 'target_path': '/'}
        with patch.object(os, 'stat', side_effect=AssertionError('no I/O for invalid grant')):
            self.rejected('EMPTY_LINK_GRANT_FIELDS', lambda: self.a.verify_empty_link(-1, 'synthetic', grant))

    def test_empty_or_oversize_file_is_limit_not_unsafe(self):
        fd = os.open(self.selected, os.O_RDONLY | os.O_DIRECTORY)
        try:
            self.file.write_bytes(b'')
            self.rejected('FILESYSTEM_ERROR', lambda: self.b.read_file(fd, self.file.name, 10), 'DISCOVERY_LIMIT')
            self.file.write_bytes(b'123')
            self.rejected('FILESYSTEM_ERROR', lambda: self.b.read_file(fd, self.file.name, 2), 'DISCOVERY_LIMIT')
            with patch.object(self.b, 'MAX_FILE', 2):
                self.rejected('FILESYSTEM_ERROR', lambda: self.b.read_file(fd, self.file.name, 10), 'DISCOVERY_LIMIT')
        finally:
            os.close(fd)

    def test_raw_source_json_schema_is_not_validated(self):
        self.file.write_bytes(b'not json; synthetic only')
        self.assertEqual(self.invoke()['files'], 1)

    def test_runtime_path_and_component_attribution(self):
        with patch.object(sys, 'version_info', (0, 0, 0)):
            self.rejected('RUNTIME_CAPABILITIES', self.b.capabilities)
        with ExitStack() as stack:
            self.rejected('ABSOLUTE_DIRECTORY_PATH', lambda: self.a.absolute_directory('relative', stack))
        self.rejected('INVALID_COMPONENT', lambda: self.b.component('..'))
        with patch.object(os, 'supports_dir_fd', set(os.supports_dir_fd) - {os.readlink}):
            self.rejected('READLINK_CAPABILITY', self.invoke)
        with patch.object(self.b, 'ROOTS', ('relative',)):
            self.rejected('DISCOVERY_ROOT_PATH', lambda: self.b.discover(io.BytesIO()))

    def test_discovery_invalid_arguments_wire_attribution(self):
        output = SimpleNamespace(buffer=io.BytesIO())
        with patch.object(sys, 'argv', ['boundary', 'invalid']), patch.object(sys, 'stdout', output):
            status = self.b.main()
        self.assertEqual(status, 1)
        data = output.buffer.getvalue()
        self.assertEqual(data[:2], b'E\x00')
        self.assertEqual(self.b.CHECKS[data[2]], 'DISCOVERY_ARGUMENTS')

    def test_save_nonprogress_and_binding_attribution(self):
        fd = os.open(self.out, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with patch.object(os, 'write', return_value=0):
                self.rejected('SAVE_WRITE_PROGRESS', lambda: self.a.save(fd, 'zero', b'x'))
            original = self.b.metadata
            def different(parent, name):
                return self.file.stat() if name == 'different' else original(parent, name)
            with patch.object(self.b, 'metadata', side_effect=different):
                self.rejected('SAVE_BINDING_OR_LENGTH', lambda: self.a.save(fd, 'different', b'x'))
        finally:
            os.close(fd)

    def test_empty_link_disposition_recheck_attribution(self):
        self.link()
        original = self.a.verify_empty_link
        calls = []
        def changed(*args):
            result = original(*args)
            calls.append(True)
            if len(calls) == 2:
                result['entries'] = 1
            return result
        with patch.object(self.a, 'verify_empty_link', side_effect=changed):
            self.rejected('EMPTY_LINK_DISPOSITION_CHANGED', self.invoke)
        self.assertEqual(len(calls), 2)
        self.no_manifest()

    def test_oserror_has_different_code_and_never_prints_text(self):
        for error, code, check in [(OSError('SYNTHETIC_SECRET'), 'SNAPSHOT_FAILED', 'FILESYSTEM_ERROR'),
                                   (self.b.Rejected('PRIVATE_METADATA_REQUIREMENTS'), 'DISCOVERY_UNSAFE_PATH', 'PRIVATE_METADATA_REQUIREMENTS'),
                                   (self.b.Rejected('SYNTHETIC_SECRET'), 'DISCOVERY_UNSAFE_PATH', 'FILESYSTEM_ERROR')]:
            output = io.StringIO()
            with patch.object(sys, 'argv', ['acquisition', '--acquire']), patch.object(self.a, 'acquire', side_effect=error), contextlib.redirect_stdout(output):
                self.assertEqual(self.a.main(), 1)
            self.assertEqual(json.loads(output.getvalue()), {'status': 'failed', 'code': code, 'check': check})
            self.assertNotIn('SYNTHETIC_SECRET', output.getvalue())

    def test_no_bare_default_rejections_remain_and_wire_ids_stable(self):
        old = ('SYMLINK_COMPONENT', 'NON_DIRECTORY_COMPONENT', 'NON_REGULAR_OR_MULTILINK',
               'OPEN_IDENTITY_CHANGED', 'FILE_CHANGED', 'READ_LENGTH_CHANGED',
               'EXPECTED_DIRECTORY', 'DIRECTORY_CHANGED', 'PATH_MISSING', 'ACCESS_DENIED', 'FILESYSTEM_ERROR')
        self.assertEqual(self.b.CHECKS[:len(old)], old)
        self.assertEqual(len(self.b.CHECKS), len(set(self.b.CHECKS)))
        self.assertLessEqual(len(self.b.CHECKS), 256)
        for name in ('discovery_boundary', 'snapshot_boundary', 'snapshot_acquisition'):
            tree = ast.parse((fixtures.LIB / (name + '.py')).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and ((isinstance(node.func, ast.Name) and node.func.id == 'Rejected') or (isinstance(node.func, ast.Attribute) and node.func.attr == 'Rejected')):
                    self.assertTrue(node.args or node.keywords, (name, node.lineno))



