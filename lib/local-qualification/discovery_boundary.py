"""Private descriptor-only discovery boundary. No argv/env root authority.

Wire: DSC1, (D + root:u8 + length:u32be + bytes)*, R + root:u8
for each root in order, Z. On failure E + code:u8 + check:u8 may follow
any prefix; the parent discards the entire stream. No paths cross the wire.
"""
import errno
import os
import stat
import struct
import sys
from contextlib import ExitStack

ROOTS = ('/private/tmp/greenchemistry-ai-decomposed-benchmark/tmp',
         '/Users/ct-mac-mini/dev/greenchemistry-ai/tmp')
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_FILES = 2048
CHECKS = ('SYMLINK_COMPONENT', 'NON_DIRECTORY_COMPONENT', 'NON_REGULAR_OR_MULTILINK',
          'OPEN_IDENTITY_CHANGED', 'FILE_CHANGED', 'READ_LENGTH_CHANGED',
          'EXPECTED_DIRECTORY', 'DIRECTORY_CHANGED', 'PATH_MISSING',
          'ACCESS_DENIED', 'FILESYSTEM_ERROR',
          # Append only: existing DSC1 check byte IDs must remain stable.
          'RUNTIME_CAPABILITIES', 'INVALID_COMPONENT', 'DISCOVERY_ROOT_PATH',
          'DISCOVERY_ARGUMENTS', 'ABSOLUTE_DIRECTORY_PATH',
          'PRIVATE_METADATA_REQUIREMENTS', 'POLICY_SCHEMA', 'POLICY_RECORD_SCHEMA',
          'POLICY_RECORD_FIELDS', 'POLICY_SELECTION', 'POLICY_IDENTITY_SCHEMA',
          'SAVE_WRITE_PROGRESS', 'SAVE_BINDING_OR_LENGTH', 'READLINK_CAPABILITY',
          'EMPTY_LINK_DISPOSITION_CHANGED', 'EMPTY_LINK_GRANT_SCHEMA',
          'EMPTY_LINK_GRANT_FIELDS')


class Rejected(Exception):
    def __init__(self, check='FILESYSTEM_ERROR', code='DISCOVERY_UNSAFE_PATH'):
        super().__init__(code)
        self.code, self.check = code, check


def limit():
    raise Rejected(code='DISCOVERY_LIMIT')


def capabilities():
    # Explicit reviewed runtime pin: upgrades require tests and re-review.
    if (sys.version_info[:3] != (3, 9, 6) or os.name != 'posix'
            or os.open not in os.supports_dir_fd
            or os.stat not in os.supports_dir_fd
            or os.stat not in os.supports_follow_symlinks
            or os.scandir not in os.supports_fd
            or any(not getattr(os, f, 0) for f in ('O_DIRECTORY', 'O_NOFOLLOW', 'O_NONBLOCK'))):
        raise Rejected('RUNTIME_CAPABILITIES')


def component(name):
    if not isinstance(name, str) or name in ('', '.', '..') or '/' in name or '\x00' in name:
        raise Rejected('INVALID_COMPONENT')
    return name


def metadata(parent, name):
    s = os.stat(component(name), dir_fd=parent, follow_symlinks=False)
    if stat.S_ISLNK(s.st_mode):
        raise Rejected('SYMLINK_COMPONENT')
    return s


def identity(s):
    return s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink


def directory_identity(s):
    # Directory contents legitimately update mtime/ctime (including a sibling
    # fixture created by a parallel test).  Binding checks need the directory's
    # object and type/mode, not its mutable contents timestamps.
    return s.st_dev, s.st_ino, s.st_mode


def directory_contents_identity(s):
    return directory_identity(s) + (s.st_mtime_ns, s.st_ctime_ns)


def directory(parent, name, stack, expected='NON_DIRECTORY_COMPONENT'):
    before = metadata(parent, name)
    if not stat.S_ISDIR(before.st_mode):
        raise Rejected(expected)
    fd = os.open(component(name), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    stack.callback(os.close, fd)
    if directory_identity(os.fstat(fd)) != directory_identity(before):
        raise Rejected('OPEN_IDENTITY_CHANGED')
    return fd, before


def check_directory(parent, name, fd, before, contents=False):
    # Relative binding recheck detects replacement; confinement itself is the fd.
    for s in (metadata(parent, name), os.fstat(fd)):
        if not stat.S_ISDIR(s.st_mode) or directory_identity(s) != directory_identity(before):
            raise Rejected('DIRECTORY_CHANGED')
        # A traversed directory must not change after enumeration, but ancestors
        # only need binding checks: their timestamps change for benign sibling I/O.
        if contents and directory_contents_identity(s) != directory_contents_identity(before):
            raise Rejected('DIRECTORY_CHANGED')


def read_file(parent, name, remaining):
    before = metadata(parent, name)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise Rejected('NON_REGULAR_OR_MULTILINK')
    if before.st_size <= 0 or before.st_size > MAX_FILE or before.st_size > remaining:
        limit()
    fd = os.open(component(name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or identity(opened) != identity(before):
            raise Rejected('OPEN_IDENTITY_CHANGED')
        data = bytearray()
        while len(data) < opened.st_size + 1:
            chunk = os.read(fd, min(65536, opened.st_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        for s in (metadata(parent, name), os.fstat(fd)):
            if not stat.S_ISREG(s.st_mode) or identity(s) != identity(opened):
                raise Rejected('FILE_CHANGED')
        if len(data) != opened.st_size:
            raise Rejected('READ_LENGTH_CHANGED')
        return data
    finally:
        os.close(fd)


def discover(out):
    capabilities()  # Before any root I/O, including '/'.
    out.write(b'DSC1')
    entries = files = total = 0

    def walk(fd, root_index, depth, selecting):
        nonlocal entries, files, total
        if depth > 16:
            limit()
        with os.scandir(fd) as iterator:
            for entry in iterator:
                entries += 1
                if entries > 20000:
                    limit()
                name = component(entry.name)
                if selecting and 'benchmark' not in name:
                    continue
                before = metadata(fd, name)
                if stat.S_ISDIR(before.st_mode):
                    with ExitStack() as stack:
                        child, initial = directory(fd, name, stack, 'EXPECTED_DIRECTORY')
                        walk(child, root_index, depth + 1, False)
                        check_directory(fd, name, child, initial, contents=True)
                elif not selecting and name.endswith('.json'):
                    files += 1
                    if files > MAX_FILES:
                        limit()
                    data = read_file(fd, name, MAX_TOTAL - total)
                    total += len(data)
                    out.write(b'D' + struct.pack('>BI', root_index, len(data)))
                    out.write(data)

    for index, root in enumerate(ROOTS):
        if not root.startswith('/') or root == '/':
            raise Rejected('DISCOVERY_ROOT_PATH')
        with ExitStack() as stack:
            parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
            stack.callback(os.close, parent)
            bindings = []
            parts = root[1:].split('/')
            for i, name in enumerate(parts):
                child, before = directory(parent, name, stack, 'EXPECTED_DIRECTORY' if i == len(parts) - 1 else 'NON_DIRECTORY_COMPONENT')
                bindings.append((parent, name, child, before))
                parent = child
            walk(parent, index, 0, True)
            for binding in reversed(bindings):
                check_directory(*binding)
        out.write(b'R' + bytes([index]))
    out.write(b'Z')


def main():
    try:
        if len(sys.argv) != 1:
            raise Rejected('DISCOVERY_ARGUMENTS')
        discover(sys.stdout.buffer)
        sys.stdout.buffer.flush()
        return 0
    except Exception as error:
        check, code = 'FILESYSTEM_ERROR', 'DISCOVERY_UNSAFE_PATH'
        if isinstance(error, Rejected):
            check, code = error.check, error.code
        elif isinstance(error, OSError):
            if error.errno == errno.ENOENT:
                check = 'PATH_MISSING'
            elif error.errno in (errno.EACCES, errno.EPERM):
                check = 'ACCESS_DENIED'
        # Exact static codes only; no exception text/traceback or stderr.
        check_id = CHECKS.index(check) if check in CHECKS else CHECKS.index('FILESYSTEM_ERROR')
        try:
            sys.stdout.buffer.write(b'E' + bytes([1 if code == 'DISCOVERY_LIMIT' else 0, check_id]))
            sys.stdout.buffer.flush()
        except Exception:
            pass
        return 1


if __name__ == '__main__':
    sys.exit(main())
