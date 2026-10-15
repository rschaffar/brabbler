#!/usr/bin/env python3
"""Internal Linux run-owner bulk cleanup. Never accepts arbitrary target paths."""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys

FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def mount_paths():
    # Same-device bind mounts matter too; st_dev alone is insufficient.
    with open('/proc/self/mountinfo', encoding='utf8') as stream:
        return [re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), line.split()[4])
                for line in stream]


def cleanup(root, expected_root, expected_source, mounts=None, *, vm=False):
    if not shutil.rmtree.avoids_symlink_attacks:
        raise ValueError('FD-safe recursive removal unavailable')
    root = Path(root)
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('Canonical absolute root required')
    mounts = mount_paths() if mounts is None else mounts
    fds = []
    removed = []
    try:
        # Pin every ancestor, refusing aliases rather than resolving them.
        fd = os.open('/', FLAGS)
        fds.append(fd)
        for part in root.parts[1:]:
            fd = os.open(part, FLAGS, dir_fd=fd)
            fds.append(fd)
        st = os.fstat(fd)
        if (st.st_dev, st.st_ino) != tuple(expected_root) or st.st_uid != os.getuid() or st.st_mode & 0o077:
            raise ValueError('Run root identity/ownership changed')
        payload = 'runtime' if vm else 'source'
        source_fd = os.open(payload, FLAGS, dir_fd=fd)
        fds.append(source_fd)
        st = os.fstat(source_fd)
        if (st.st_dev, st.st_ino) != tuple(expected_source):
            raise ValueError(f'{payload.title()} root identity changed')
        # Fixed run-owner targets only. VM disks/exchange copies are separate
        # from exported diagnostics; core source and failed fixtures stay.
        if vm:
            targets = [(fd, name, root / name) for name in ('runtime', 'tmp', 'cache')]
        else:
            targets = [(source_fd, 'node_modules', root / 'source/node_modules'),
                       (source_fd, '.next', root / 'source/.next')]
            tmp_fd = os.open('tmp', FLAGS, dir_fd=fd)
            fds.append(tmp_fd)
            targets.append((tmp_fd, 'node-compile-cache', root / 'tmp/node-compile-cache'))
        # Preflight every target before deleting any. Never traverse mountpoints.
        for _, _, target in targets:
            if any(m == str(target) or m.startswith(str(target) + '/') or
                   (str(target).startswith(m + '/') and m.startswith(str(root) + '/')) for m in mounts):
                raise ValueError(f'Mounted cleanup target refused: {target.name}')
        for parent, name, target in targets:
            try:
                st = os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                continue
            if stat.S_ISLNK(st.st_mode):
                os.unlink(name, dir_fd=parent)  # Never follow the store link.
            elif stat.S_ISDIR(st.st_mode):
                shutil.rmtree(name, dir_fd=parent)
            else:
                raise ValueError(f'Unexpected cleanup target type: {name}')
            removed.append(str(target))
        return {'status': 'removed', 'paths': removed,
                'retained': 'manifests and diagnostics' if vm else 'source snapshot, manifests, diagnostics and fixture state'}
    finally:
        for fd in reversed(fds):
            os.close(fd)


if __name__ == '__main__':
    try:
        args = sys.argv[1:]
        vm = args[:1] == ['--vm']
        if vm:
            args = args[1:]
        root, dev, ino, source_dev, source_ino = args
        print(json.dumps(cleanup(root, (int(dev), int(ino)), (int(source_dev), int(source_ino)), vm=vm)))
    except (OSError, ValueError) as error:
        sys.exit(f'Cleanup refused (earlier targets may already be removed): {error}')
