"""Synthetic child failures: no private paths or acquisition execution."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from test_snapshot_acquisition import load


class ChildDiagnosticTests(unittest.TestCase):
    def setUp(self):
        modules = patch.dict(sys.modules)
        modules.start()
        self.addCleanup(modules.stop)
        load('discovery_boundary')
        load('snapshot_boundary')
        load('snapshot_acquisition')
        self.s = load('snapshot_supervisor')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.child = Path(self.temp.name) / 'child.py'
        self.s.COMMAND = ('/usr/bin/python3', '-I', '-S', str(self.child))
        self.s.DEADLINE = 1.0

    def run_child(self, raw, exit_code=1, suffix=''):
        self.child.write_text('import os,sys\nos.write(1,' + repr(raw) + ')\nos.write(2,b"SYNTHETIC_SECRET_STDERR")\n' + suffix + '\nsys.exit(' + str(exit_code) + ')\n')
        out = io.StringIO()
        with patch.object(sys, 'argv', ['supervisor', '--acquire']), contextlib.redirect_stdout(out), patch.object(self.s, 'validate', side_effect=AssertionError('must not validate failed child')) as validate:
            status = self.s.main()
        self.assertEqual(status, 1)
        validate.assert_not_called()
        self.assertNotIn('SYNTHETIC_SECRET', out.getvalue())
        return json.loads(out.getvalue())

    def test_preserves_every_allowlisted_child_code_and_check(self):
        codes = ('SNAPSHOT_REVIEW_REQUIRED', 'SNAPSHOT_POLICY_MISMATCH', 'SNAPSHOT_UNUSED_GRANT',
                 'SNAPSHOT_INVALID_ARGUMENTS', 'DISCOVERY_LIMIT', 'DISCOVERY_UNSAFE_PATH', 'SNAPSHOT_FAILED')
        for code in codes:
            for check in self.s.a.boundary.CHECKS:
                with self.subTest(code=code, check=check):
                    child = {'status': 'failed', 'code': code, 'check': check}
                    actual = self.run_child(json.dumps(child).encode())
                    self.assertEqual(actual, {'status': 'failed', 'code': 'CHILD_FAILED', 'child_code': code, 'child_check': check})
                    self.assertEqual(self.s.LAST_EXIT, 1)

    def test_untrusted_or_malformed_payload_stays_generic(self):
        valid = {'status': 'failed', 'code': 'SNAPSHOT_FAILED', 'check': 'FILESYSTEM_ERROR'}
        bad = [b'', b'SYNTHETIC_SECRET', b'\xff', b'{}', b'[]', b'null',
               json.dumps(dict(valid, extra='SYNTHETIC_SECRET')).encode(),
               json.dumps(dict(valid, code='SYNTHETIC_SECRET')).encode(),
               json.dumps(dict(valid, check='SYNTHETIC_SECRET')).encode(),
               json.dumps(dict(valid, status='success')).encode(),
               json.dumps(dict(valid, code=[])).encode(),
               json.dumps(dict(valid, check={})).encode(),
               json.dumps(valid).encode() + b'\n{}',
               b'{"status":"failed","status":"failed","code":"SNAPSHOT_FAILED","check":"FILESYSTEM_ERROR"}']
        for raw in bad:
            with self.subTest(raw=raw):
                self.assertEqual(self.run_child(raw), {'status': 'failed', 'code': 'CHILD_FAILED'})

    def test_abnormal_exit_does_not_forward_normal_failure_diagnostic(self):
        raw = b'{"status":"failed","code":"SNAPSHOT_FAILED","check":"FILESYSTEM_ERROR"}'
        self.assertEqual(self.run_child(raw, 23), {'status': 'failed', 'code': 'CHILD_FAILED'})
        self.assertEqual(self.s.LAST_EXIT, 23)

    def test_timeout_and_overflow_do_not_forward_failure_prefix(self):
        raw = b'{"status":"failed","code":"SNAPSHOT_FAILED","check":"FILESYSTEM_ERROR"}'
        self.s.DEADLINE = 0.2
        self.assertEqual(self.run_child(raw, suffix='import time\ntime.sleep(60)'), {'status': 'failed', 'code': 'TIMEOUT'})
        self.assertEqual(self.s.LAST_EXIT, -9)
        self.assertEqual(self.run_child(raw + b' ' * 4096, suffix='import time\ntime.sleep(60)'), {'status': 'failed', 'code': 'STDOUT_LIMIT'})
        self.assertEqual(self.s.LAST_EXIT, -9)

if __name__ == '__main__':
    unittest.main()
