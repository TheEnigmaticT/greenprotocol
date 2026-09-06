"""Single fixed-command supervisor. No retry, shell, or private path output.

Only exit-zero + complete validated result/manifest/artifacts is acceptance.
Failed runs remain private/incomplete; this does not grant loader approval.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).absolute().parent))
import snapshot_acquisition as a
import os
import json
import re
import selectors
import stat
import subprocess
import time
from contextlib import ExitStack

COMMAND = ('/usr/bin/python3', '-I', '-S', str(Path(__file__).absolute().with_name('snapshot_acquisition.py')), '--acquire')
DEADLINE = 120.0
STDOUT_LIMIT = 4096
LAST_EXIT = None

class Failed(Exception):
    pass

class ChildFailed(Failed):
    """Preserve only the fixed child's exact bounded failure vocabulary."""
    def __init__(self, raw):
        super().__init__('CHILD_FAILED')
        self.diagnostic = {}
        def unique(pairs):
            value = {}
            for key, item in pairs:
                if key in value: raise ValueError('duplicate key')
                value[key] = item
            return value
        try:
            value = json.loads(raw, object_pairs_hook=unique)
            codes = {'SNAPSHOT_REVIEW_REQUIRED', 'SNAPSHOT_POLICY_MISMATCH', 'SNAPSHOT_UNUSED_GRANT',
                     'SNAPSHOT_INVALID_ARGUMENTS', 'DISCOVERY_LIMIT', 'DISCOVERY_UNSAFE_PATH', 'SNAPSHOT_FAILED'}
            if (isinstance(value, dict) and set(value) == {'status', 'code', 'check'}
                    and value['status'] == 'failed'
                    and isinstance(value['code'], str) and value['code'] in codes
                    and isinstance(value['check'], str) and value['check'] in a.boundary.CHECKS):
                self.diagnostic = {'child_code': value['code'], 'child_check': value['check']}
        except (ValueError, TypeError, RecursionError):
            pass  # Never echo malformed/unknown child output or parser errors.

def require(ok):
    if not ok: raise Failed('VALIDATION_FAILED')

def integer(value, maximum):
    return type(value) is int and 0 <= value <= maximum

def sha(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None

def validate(raw):
    result = json.loads(raw)
    require(isinstance(result, dict) and set(result) == {'status','snapshot','files','bytes','manifest_sha256'})
    require(result['status'] == 'acquired-not-loader-approved')
    require(isinstance(result['snapshot'], str) and re.fullmatch('snapshot-[0-9a-f]{32}', result['snapshot']))
    require(integer(result['files'], a.boundary.MAX_FILES) and integer(result['bytes'], a.boundary.MAX_TOTAL))
    require(sha(result['manifest_sha256']))
    with ExitStack() as stack:
        out, bindings = a.absolute_directory(a.OUTPUT_ROOT, stack)
        a.private(os.fstat(out), True)
        fd, before = a.boundary.directory(out, result['snapshot'], stack)
        bindings.append((out, result['snapshot'], fd, before))
        a.private(os.fstat(fd), True)
        def read(name):
            a.private(a.boundary.metadata(fd, name))
            return a.boundary.read_file(fd, name, a.boundary.MAX_TOTAL)
        blob = read('manifest.json')
        require(a.digest(blob) == result['manifest_sha256'])
        m = json.loads(blob)
        require(isinstance(m, dict) and set(m) == {'version','status','reviewApproved','policy_sha256','roots_completed','files','bytes','enumerated_entries','entries'})
        require(type(m['version']) is int and m['version'] == 1 and m['reviewApproved'] is False)
        require(m['status'] == result['status'] and m['policy_sha256'] == a.POLICY_SHA256)
        require(m['roots_completed'] == list(range(len(a.ROOTS))) and all(type(x) is int for x in m['roots_completed']))
        require(integer(m['files'], a.boundary.MAX_FILES) and integer(m['bytes'], a.boundary.MAX_TOTAL))
        require(m['files'] == result['files'] and m['bytes'] == result['bytes'])
        require(integer(m['enumerated_entries'], a.MAX_ENTRIES) and isinstance(m['entries'], list) and len(m['entries']) == m['enumerated_entries'])
        total, count, paths, artifacts, links = 0, 0, {}, set(), set()
        grants = a.load_policy()
        for record in m['entries']:
            require(isinstance(record, dict))
            idx, parts, disposition = record['root_index'], record['relative_components'], record['disposition']
            require(type(idx) is int and 0 <= idx < len(a.ROOTS))
            require(isinstance(parts, list) and 1 <= len(parts) <= a.MAX_DEPTH + 1)
            parts = tuple(a.boundary.component(p) for p in parts)
            key = (idx, parts)
            require(key not in paths); paths[key] = disposition
            fields = {'root_index','relative_components','disposition'}
            if disposition != 'outside-selection':
                require('benchmark' in parts[0])
                fields.add('source_identity')
                require(isinstance(record['source_identity'], list) and len(record['source_identity']) == 7 and all(type(x) is int for x in record['source_identity']))
                source = record['source_identity']
                if disposition in ('copied', 'non-json-or-top-level-file'):
                    require(stat.S_ISREG(source[2]) and source[6] == 1)
                elif disposition == 'directory':
                    require(stat.S_ISDIR(source[2]))
                elif disposition == 'verified-empty-directory-link':
                    require(stat.S_ISLNK(source[2]))
            if disposition == 'copied':
                fields.update(('artifact','bytes','sha256'))
                count += 1
                require(len(parts) > 1 and parts[-1].endswith('.json'))
                require(record['artifact'] == 'artifact-%04d.json' % count and record['artifact'] not in artifacts)
                require(integer(record['bytes'], a.boundary.MAX_FILE) and record['bytes'] > 0 and sha(record['sha256']))
                require(record['source_identity'][3] == record['bytes'])
                data = read(record['artifact'])
                require(len(data) == record['bytes'] and a.digest(data) == record['sha256'])
                total += len(data); artifacts.add(record['artifact'])
            elif disposition == 'directory':
                source = record['source_identity']
                fields.add('directory_identity')
                require(isinstance(record['directory_identity'], list) and len(record['directory_identity']) == 5 and all(type(x) is int for x in record['directory_identity']))
                require(record['directory_identity'] == [source[0], source[1], source[2], source[4], source[5]])
            elif disposition == 'verified-empty-directory-link':
                fields.update(('entries','link_identity_sha256','target_identity_sha256'))
                require(key in grants and type(record['entries']) is int and record['entries'] == 0)
                grant = grants[key]
                require(record['source_identity'] == list(grant['link_identity']))
                for field in ('link_identity','target_identity'):
                    expected = a.digest(json.dumps(grant[field], separators=(',', ':')).encode())
                    require(record[field + '_sha256'] == expected)
                links.add(key)
            elif disposition == 'outside-selection':
                require(len(parts) == 1 and 'benchmark' not in parts[0])
            else:
                require(disposition == 'non-json-or-top-level-file' and (len(parts) == 1 or not parts[-1].endswith('.json')))
            require(set(record) == fields)
        # Every selected ancestor must be recorded as a directory in this root.
        for idx, parts in paths:
            for depth in range(1, len(parts)):
                require(paths.get((idx, parts[:depth])) == 'directory')
        require(count == m['files'] and total == m['bytes'] and links == set(grants))
        with os.scandir(fd) as entries:
            names = set()
            for item in entries:
                require(len(names) <= a.boundary.MAX_FILES)
                names.add(item.name)
        require(names == artifacts | {'manifest.json'})
        for binding in reversed(bindings): a.boundary.check_directory(*binding)
    return result

def launch():
    global LAST_EXIT
    LAST_EXIT = None
    a.boundary.capabilities()
    deadline = time.monotonic() + DEADLINE
    p = subprocess.Popen(COMMAND, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, env={}, close_fds=True)
    assert p.stdout is not None
    data = bytearray()
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(p.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0: raise Failed('TIMEOUT')
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fd, min(4096, STDOUT_LIMIT + 1 - len(data)))
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        data.extend(chunk)
                        if len(data) > STDOUT_LIMIT: raise Failed('STDOUT_LIMIT')
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise Failed('TIMEOUT')
            try: LAST_EXIT = p.wait(timeout=remaining)
            except subprocess.TimeoutExpired: raise Failed('TIMEOUT')
            if time.monotonic() >= deadline: raise Failed('TIMEOUT')
            if LAST_EXIT == 1: raise ChildFailed(data)
            if LAST_EXIT != 0: raise Failed('CHILD_FAILED')
        return validate(data)
    finally:
        if p.poll() is None:
            p.kill()
        try: LAST_EXIT = p.wait(timeout=5)
        except subprocess.TimeoutExpired: raise Failed('TERMINATION_UNCERTAIN')
        finally: p.stdout.close()

def main():
    try:
        if sys.argv[1:] != ['--acquire']: raise Failed('INVALID_ARGUMENTS')
        print(json.dumps(launch(), sort_keys=True))
        return 0
    except BaseException as error:
        allowed = {'TIMEOUT','STDOUT_LIMIT','CHILD_FAILED','TERMINATION_UNCERTAIN','INVALID_ARGUMENTS','VALIDATION_FAILED'}
        code = str(error) if isinstance(error, Failed) and str(error) in allowed else 'SUPERVISOR_FAILED'
        result = {'status':'failed','code':code}
        if isinstance(error, ChildFailed): result.update(error.diagnostic)
        print(json.dumps(result, sort_keys=True))
        return 1
if __name__ == '__main__': sys.exit(main())
