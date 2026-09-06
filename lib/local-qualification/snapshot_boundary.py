"""Snapshot primitive for ONE independently approved, pinned empty link.

Not an operator entrypoint or a grant loader. The caller must acquire the source
parent through the reviewed descriptor boundary and supply a trusted grant from
approved inspection (never a source record or an argv/env override). Target path
is the inspection's literal canonical path; this code does not resolve aliases.
The strict discovery scanner remains unchanged. No private execution is enabled.
"""
import hashlib
import json
import os
import stat
from contextlib import ExitStack

import discovery_boundary as boundary


def verify_empty_link(parent, name, grant):
    """Revalidate pinned link/empty target; return an explicit safe disposition.

    No file bytes are read, no link is traversed and no original is changed.
    A successful return records only this observation, not corpus completeness.
    Caller must revalidate retained source ancestry before committing a snapshot.
    """
    if not isinstance(grant, dict) or set(grant) != {
        'link_identity', 'link_text', 'target_path', 'target_identity'
    }:
        raise boundary.Rejected('EMPTY_LINK_GRANT_SCHEMA')
    # Freeze before I/O. Do not let caller mutation change expected identities.
    link_identity = grant['link_identity']
    target_identity = grant['target_identity']
    link_text, target_path = grant['link_text'], grant['target_path']
    if (not isinstance(link_identity, tuple) or len(link_identity) != 7
            or not isinstance(target_identity, tuple) or len(target_identity) != 5
            or any(type(value) is not int for value in link_identity + target_identity)
            or not isinstance(link_text, str) or not link_text
            or not isinstance(target_path, str) or not target_path.startswith('/')
            or target_path == '/'):
        raise boundary.Rejected('EMPTY_LINK_GRANT_FIELDS')
    name = boundary.component(name)
    parts = [boundary.component(part) for part in target_path[1:].split('/')]

    def check_link():
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if (not stat.S_ISLNK(current.st_mode)
                or boundary.identity(current) != link_identity
                or os.readlink(name, dir_fd=parent) != link_text):
            raise boundary.Rejected('OPEN_IDENTITY_CHANGED')
        # readlink itself may race a replacement; bind its observation as well.
        if boundary.identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != link_identity:
            raise boundary.Rejected('OPEN_IDENTITY_CHANGED')

    check_link()
    with ExitStack() as stack:
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
        stack.callback(os.close, fd)
        bindings = []
        for part in parts:
            child, before = boundary.directory(fd, part, stack)
            bindings.append((fd, part, child, before))
            fd = child
        if boundary.directory_identity(os.fstat(fd)) != target_identity:
            raise boundary.Rejected('DIRECTORY_CHANGED')
        with os.scandir(fd) as entries:
            if next(entries, None) is not None:
                raise boundary.Rejected('DIRECTORY_CHANGED')
        for binding in reversed(bindings):
            boundary.check_directory(*binding)
        check_link()
    digest = lambda value: hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()
    return {
        'disposition': 'verified-empty-directory-link',
        'entries': 0,
        'link_identity_sha256': digest(link_identity),
        'target_identity_sha256': digest(target_identity),
    }
