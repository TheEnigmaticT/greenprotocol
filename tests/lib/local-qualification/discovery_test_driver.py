"""TEST ONLY subprocess bootstrap. Never imported by production."""
import importlib.util
import os
from pathlib import Path
import struct
import sys
import tempfile
import time

helper = Path(__file__).resolve().parents[3] / 'lib/local-qualification/discovery_boundary.py'
spec = importlib.util.spec_from_file_location('boundary', helper)
assert spec and spec.loader
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
args = sys.argv[1:]
sys.argv = [str(helper)]
if args[0] == '--transport':
    mode = args[1]
    if mode == 'timeout': time.sleep(10)
    if mode == 'failure':
        os.write(2, b'PRIVATE-SENTINEL')
        sys.exit(4)
    streams = {
        'truncated': b'DSC1D\x00\x00',
        'oversize': b'DSC1D' + struct.pack('>BI', 0, 8 * 1024 * 1024 + 1),
        'extra': b'DSC1R\x00R\x01ZZ',
        'order': b'DSC1R\x01R\x00Z',
        'bad-error': b'DSC1E\xff\xff',
        'count': b'DSC1' + (b'D\x00\x00\x00\x00\x02{}' * 2049) + b'R\x00R\x01Z',
        'buffer-limit': b'DSC1' + b'x' * 10000,
    }
    if mode in streams:
        sys.stdout.buffer.write(streams[mode]); sys.exit(0)
    with tempfile.TemporaryDirectory(prefix='discovery-transport-') as tmp:
        base = Path(tmp).resolve()
        roots = [base / '0', base / '1']
        for root in roots: (root / 'synthetic-benchmark').mkdir(parents=True)
        (roots[0] / 'synthetic-benchmark' / 'a.json').write_bytes(b'{"sourceText":"SYNTHETIC"}')
        h.ROOTS = tuple(str(r) for r in roots)
        if mode == 'capability': h.os.supports_dir_fd = set()
        if mode == 'stderr': os.write(2, b'PRIVATE-SENTINEL' * 100000)
        sys.exit(h.main())
elif args[0] in ('--race', '--fault'):
    import json
    from contextlib import contextmanager
    operation, mode, report, *roots = args
    h.ROOTS = tuple(roots)
    h.capabilities()
    h.capabilities = lambda: None
    base = Path(roots[0]).parent
    inside = Path(roots[0]) / 'synthetic-benchmark'
    outside = base / 'outside'
    real_open, real_read, real_scan, real_stat, real_close = os.open, os.read, os.scandir, os.stat, os.close
    observed = dict(replaced=False, consumedForbidden=False, enumeratedOutside=False, consumedAllowed=False, enumeratedInside=False)
    live = set()
    inside_ino = inside.stat().st_ino
    def replace():
        inside.rename(base / 'retained-inside')
        inside.symlink_to(outside, target_is_directory=True)
        observed['replaced'] = True
    def opened(name, flags, *a, **kw):
        if operation == '--race' and mode == 'file' and name == 'fixture.json' and not observed['replaced']:
            replace()
        if operation == '--fault' and mode == 'descriptor' and name == 'fixture.json':
            name = 'alternate.txt'
        fd = real_open(name, flags, *a, **kw)
        live.add(fd)
        return fd
    def closed(fd):
        real_close(fd)
        live.remove(fd)
    mutated = False
    def read(fd, length):
        global mutated
        if operation == '--fault' and mode == 'short-read': return b''
        data = real_read(fd, length)
        observed['consumedForbidden'] |= b'FORBIDDEN' in data
        observed['consumedAllowed'] |= b'ALLOWED' in data
        if operation == '--fault' and mode == 'mutation' and not mutated:
            (inside / 'fixture.json').write_bytes(b'{"sourceText":"MUTATED-LONGER"}')
            mutated = True
        return data
    @contextmanager
    def scan(fd):
        if operation == '--race' and mode == 'directory' and os.fstat(fd).st_ino == inside_ino and not observed['replaced']:
            replace()
        def entries(it):
            for entry in it:
                observed['enumeratedOutside'] |= entry.name == 'outside-only.json'
                observed['enumeratedInside'] |= entry.name == 'fixture.json'
                yield entry
        with real_scan(fd) as it:
            yield entries(it)
        if operation == '--fault' and mode == 'directory-mutation' and os.fstat(fd).st_ino == inside_ino:
            (inside / 'added.txt').write_bytes(b'x')
    def metadata(name, *a, **kw):
        if operation == '--fault' and name == Path(roots[0]).name:
            if mode == 'permission': raise PermissionError(13, 'PRIVATE-SENTINEL credential')
            if mode == 'unknown': raise OSError(5, 'PRIVATE-SENTINEL credential')
        return real_stat(name, *a, **kw)
    if operation == '--fault':
        if mode == 'symlink':
            inside.rename(base / 'retained-inside'); inside.symlink_to(base / 'retained-inside')
        if mode == 'ancestor-file':
            (base / 'plain').write_bytes(b'x'); h.ROOTS = (str(base / 'plain' / 'tmp'), roots[1])
        if mode == 'missing': h.ROOTS = (str(base / 'missing'), roots[1])
        if mode == 'hardlink': os.link(inside / 'fixture.json', inside / 'hard.txt')
        if mode == 'descriptor': (inside / 'alternate.txt').write_bytes(b'{}')
    os.open, os.read, os.scandir, os.stat, os.close = opened, read, scan, metadata, closed
    status = h.main()
    observed['openDescriptors'] = len(live)
    Path(report).write_text(json.dumps(observed))
    sys.exit(status)
else:
    h.ROOTS = tuple(args)
    sys.exit(h.main())
