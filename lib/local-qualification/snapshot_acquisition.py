"""Bounded raw snapshot acquisition, not scientific/loader approval.

Run with /usr/bin/python3 -I -S <absolute module path> --acquire. No argv/env
paths, grants, or limits. Only reviewed constants below confer authority.
Policy enrollment is separate: an independent reviewer must pin the exact
private inspection policy bytes before private execution. Never derive a grant
from current source metadata (that would approve a replacement).
"""
import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import uuid
from typing import Optional
from contextlib import ExitStack

# -I omits the script directory. Only this module's literal sibling directory
# is added; no cwd/PYTHONPATH fallback and no imports from the private roots.
if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).absolute().parent))
import discovery_boundary as boundary
from snapshot_boundary import verify_empty_link

ROOTS = boundary.ROOTS
OUTPUT_ROOT = str(Path(__file__).absolute().parents[2] / 'tmp/local-qualification/acquisitions')
POLICY_PATH = '/Users/ct-mac-mini/dev/local-model-migration-planning/snapshot-inspection-policy.json'
# Enrolled from exclusive saved-link evidence and authorized target observation.
# Parent delta review remains required before supervised private launch.
POLICY_SHA256: Optional[str] = '7e2848cb1c0dd47311c442962fd7b940e8ae9ed83f8435b23701baa612d7ee5c'
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK
MAX_ENTRIES = 20000
MAX_DEPTH = 16


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def absolute_directory(path, stack):
    if not isinstance(path, str) or not path.startswith('/') or path == '/':
        raise boundary.Rejected('ABSOLUTE_DIRECTORY_PATH')
    fd = os.open('/', FLAGS)
    stack.callback(os.close, fd)
    bindings = []
    for part in path[1:].split('/'):
        child, before = boundary.directory(fd, part, stack)
        bindings.append((fd, part, child, before))
        fd = child
    return fd, bindings


def private(s, directory=False):
    if (s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != (0o700 if directory else 0o600)
            or (not directory and (not stat.S_ISREG(s.st_mode) or s.st_nlink != 1))):
        raise boundary.Rejected('PRIVATE_METADATA_REQUIREMENTS')


def check_output(bindings):
    # Creating our run/files changes parent timestamps. Bind dev/ino/type/mode,
    # not mtime/ctime; require the destination itself to remain owner-private.
    for parent, name, fd, before in bindings:
        for current in (boundary.metadata(parent, name), os.fstat(fd)):
            if (current.st_dev, current.st_ino, current.st_mode, current.st_uid) != (
                    before.st_dev, before.st_ino, before.st_mode, before.st_uid):
                raise boundary.Rejected('DIRECTORY_CHANGED')
    private(os.fstat(bindings[-1][2]), True)


def load_policy():
    if (not isinstance(POLICY_SHA256, str) or len(POLICY_SHA256) != 64
            or any(c not in '0123456789abcdef' for c in POLICY_SHA256)):
        raise boundary.Rejected(code='SNAPSHOT_REVIEW_REQUIRED')
    parent_path, name = POLICY_PATH.rsplit('/', 1)
    with ExitStack() as stack:
        fd, bindings = absolute_directory(parent_path, stack)
        before = boundary.metadata(fd, name)
        private(before)
        raw = boundary.read_file(fd, name, 65536)
        if digest(raw) != POLICY_SHA256:
            raise boundary.Rejected(code='SNAPSHOT_POLICY_MISMATCH')
        for binding in reversed(bindings): boundary.check_directory(*binding)
    policy = json.loads(raw)
    if (not isinstance(policy, dict) or set(policy) != {'version', 'grants'}
            or type(policy['version']) is not int or policy['version'] != 1
            or not isinstance(policy['grants'], list) or len(policy['grants']) > 1):
        raise boundary.Rejected('POLICY_SCHEMA')
    grants = {}
    for record in policy['grants']:
        if not isinstance(record, dict) or set(record) != {'root_index', 'relative_components', 'grant'}:
            raise boundary.Rejected('POLICY_RECORD_SCHEMA')
        index, parts, grant = record['root_index'], record['relative_components'], record['grant']
        if (type(index) is not int or not 0 <= index < len(ROOTS) or not isinstance(parts, list)
                or not 1 <= len(parts) <= MAX_DEPTH + 1 or not isinstance(grant, dict)
                or set(grant) != {'link_identity', 'link_text', 'target_path', 'target_identity'}):
            raise boundary.Rejected('POLICY_RECORD_FIELDS')
        parts = tuple(boundary.component(p) for p in parts)
        if 'benchmark' not in parts[0]: raise boundary.Rejected('POLICY_SELECTION')
        grant = dict(grant)
        for field, count in (('link_identity', 7), ('target_identity', 5)):
            value = grant[field]
            if not isinstance(value, list) or len(value) != count or any(type(v) is not int for v in value):
                raise boundary.Rejected('POLICY_IDENTITY_SCHEMA')
            grant[field] = tuple(value)
        grants[(index, parts)] = grant
    return grants


def save(parent, name, data):
    """Exclusive private regular file, full write and fsync, never overwrite."""
    fd = os.open(boundary.component(name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK,
                 0o600, dir_fd=parent)
    try:
        before = os.fstat(fd)
        private(before)
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            if count <= 0: raise boundary.Rejected('SAVE_WRITE_PROGRESS')
            view = view[count:]
        os.fsync(fd)
        after = os.fstat(fd)
        private(after)
        bound = boundary.metadata(parent, name)
        if boundary.identity(after) != boundary.identity(bound) or after.st_size != len(data):
            raise boundary.Rejected('SAVE_BINDING_OR_LENGTH')
    finally:
        os.close(fd)


def acquire():
    """Execute fixed-root acquisition; failures retain incomplete private files.

    manifest.json is the final commit artifact. Its status explicitly denies
    loader approval. No protocol parsing, model calls, labels or baselines.
    """
    boundary.capabilities()
    if os.readlink not in os.supports_dir_fd: raise boundary.Rejected('READLINK_CAPABILITY')
    grants = load_policy()  # Before any source root I/O.
    with ExitStack() as stack:
        out, output_bindings = absolute_directory(OUTPUT_ROOT, stack)
        private(os.fstat(out), True)
        # Fixed root must already be provisioned privately; do not chmod existing
        # worktree tmp directories or create arbitrary ancestors as a side effect.
        run_name = 'snapshot-' + uuid.uuid4().hex
        os.mkdir(run_name, 0o700, dir_fd=out)
        run, run_before = boundary.directory(out, run_name, stack)
        private(os.fstat(run), True)
        output_bindings.append((out, run_name, run, run_before))
        try:
            records, files, total, entries = [], 0, 0, 0
            roots, ancestry, seen_grants = [], [], set()
            for root in ROOTS:
                fd, bindings = absolute_directory(root, stack)
                roots.append(fd)
                ancestry.extend(bindings)

            def walk(fd, index, parts, depth, selecting):
                nonlocal files, total, entries
                if depth > MAX_DEPTH: boundary.limit()
                with os.scandir(fd) as iterator:
                    for item in iterator:
                        entries += 1
                        if entries > MAX_ENTRIES: boundary.limit()
                        name = boundary.component(item.name)
                        path = parts + (name,)
                        if selecting and 'benchmark' not in name:
                            records.append({'root_index': index, 'relative_components': path,
                                            'disposition': 'outside-selection'})
                            continue
                        before = os.stat(name, dir_fd=fd, follow_symlinks=False)
                        base = {'root_index': index, 'relative_components': path,
                                'source_identity': boundary.identity(before)}
                        if stat.S_ISLNK(before.st_mode):
                            key = (index, path)
                            disposition = verify_empty_link(fd, name, grants.get(key))
                            seen_grants.add(key)
                            records.append(dict(base, **disposition))
                        elif stat.S_ISDIR(before.st_mode):
                            records.append(dict(base, disposition='directory',
                                                directory_identity=boundary.directory_identity(before)))
                            with ExitStack() as child_stack:
                                child, initial = boundary.directory(fd, name, child_stack)
                                walk(child, index, path, depth + 1, False)
                                boundary.check_directory(fd, name, child, initial)
                        else:
                            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                                raise boundary.Rejected('NON_REGULAR_OR_MULTILINK')
                            if selecting or not name.endswith('.json'):
                                records.append(dict(base, disposition='non-json-or-top-level-file'))
                                continue
                            files += 1
                            if files > boundary.MAX_FILES: boundary.limit()
                            data = boundary.read_file(fd, name, boundary.MAX_TOTAL - total)
                            if boundary.identity(boundary.metadata(fd, name)) != boundary.identity(before):
                                raise boundary.Rejected('FILE_CHANGED')
                            total += len(data)
                            artifact = 'artifact-%04d.json' % files
                            save(run, artifact, data)
                            records.append(dict(base, disposition='copied', artifact=artifact,
                                                bytes=len(data), sha256=digest(data)))

            for index, root in enumerate(roots): walk(root, index, (), 0, True)
            if seen_grants != set(grants): raise boundary.Rejected(code='SNAPSHOT_UNUSED_GRANT')

            # Reopen every source relative to retained roots, check every parent,
            # reread/hash original copied bytes, and read back destination bytes.
            # This is bounded to a second pass, not a promise of global FS locking.
            for record in records:
                if record['disposition'] == 'outside-selection': continue
                with ExitStack() as recheck:
                    fd = roots[record['root_index']]
                    bindings = []
                    parts = record['relative_components']
                    for part in parts[:-1]:
                        child, before = boundary.directory(fd, part, recheck)
                        bindings.append((fd, part, child, before))
                        fd = child
                    name = parts[-1]
                    current = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if boundary.identity(current) != record['source_identity']:
                        raise boundary.Rejected('FILE_CHANGED')
                    if record['disposition'] == 'copied':
                        data = boundary.read_file(fd, name, boundary.MAX_TOTAL)
                        if digest(data) != record['sha256']: raise boundary.Rejected('FILE_CHANGED')
                        copied = boundary.read_file(run, record['artifact'], boundary.MAX_TOTAL)
                        private(boundary.metadata(run, record['artifact']))
                        if digest(copied) != record['sha256']: raise boundary.Rejected('FILE_CHANGED')
                    elif record['disposition'] == 'verified-empty-directory-link':
                        again = verify_empty_link(fd, name, grants[(record['root_index'], parts)])
                        if any(record[k] != v for k, v in again.items()): raise boundary.Rejected('EMPTY_LINK_DISPOSITION_CHANGED')
                    for binding in reversed(bindings): boundary.check_directory(*binding)
            for binding in reversed(ancestry): boundary.check_directory(*binding)
            check_output(output_bindings)
            manifest = {'version': 1, 'status': 'acquired-not-loader-approved', 'reviewApproved': False,
                        'policy_sha256': POLICY_SHA256, 'roots_completed': list(range(len(ROOTS))),
                        'files': files, 'bytes': total, 'enumerated_entries': entries, 'entries': records}
            blob = encode(manifest)
            save(run, 'manifest.json', blob)
            for binding in reversed(ancestry): boundary.check_directory(*binding)
            check_output(output_bindings)
            os.fsync(run)
            os.fsync(out)
            return {'status': manifest['status'], 'snapshot': run_name, 'files': files,
                    'bytes': total, 'manifest_sha256': digest(blob)}
        except BaseException:
            # Even a partial manifest write must not survive a failed acquisition.
            try: os.unlink('manifest.json', dir_fd=run)
            except FileNotFoundError: pass
            raise


def main():
    if sys.argv[1:] == ['--help']:
        print('Usage: /usr/bin/python3 -I -S snapshot_acquisition.py --acquire; fixed reviewed policy/roots only')
        return 0
    try:
        if sys.argv[1:] != ['--acquire']: raise boundary.Rejected(code='SNAPSHOT_INVALID_ARGUMENTS')
        result = acquire()
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        allowed = {'SNAPSHOT_REVIEW_REQUIRED', 'SNAPSHOT_POLICY_MISMATCH', 'SNAPSHOT_UNUSED_GRANT',
                   'SNAPSHOT_INVALID_ARGUMENTS', 'DISCOVERY_LIMIT', 'DISCOVERY_UNSAFE_PATH'}
        code = error.code if isinstance(error, boundary.Rejected) and error.code in allowed else 'SNAPSHOT_FAILED'
        check = error.check if isinstance(error, boundary.Rejected) and error.check in boundary.CHECKS else 'FILESYSTEM_ERROR'
        if isinstance(error, OSError):
            check = {errno.ENOENT: 'PATH_MISSING', errno.EPERM: 'ACCESS_DENIED', errno.EACCES: 'ACCESS_DENIED'}.get(error.errno or 0, check)
        print(json.dumps({'status': 'failed', 'code': code, 'check': check}, sort_keys=True))
        return 1


if __name__ == '__main__':
    sys.exit(main())
