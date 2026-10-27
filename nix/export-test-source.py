#!/usr/bin/env python3
"""Export allowlisted working source BEFORE passing path:... to Nix.

No Git commands, ignore-file parsing, imports from the checkout, or secret-file
reads. New/untracked source files in approved trees are included. All admitted
symlinks/special files are refused, not followed. The output and its manifest
must be new siblings beneath an existing physical owned 0700 directory.

This is bounded source-copy evidence, not continuous monitoring or a secret
content detector. Review source placed in approved paths before exporting it.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

ROOT_FILES = frozenset({
    '.gitignore', 'AGENTS.md', 'CONTEXT.md', 'LICENSE',
    'README.md',
    'flake.nix', 'flake.lock', 'package.json', 'package-lock.json',
    'tsconfig.json', 'next.config.ts', 'eslint.config.mjs',
    'postcss.config.mjs', 'tailwind.config.ts', 'instrumentation.ts',
    'instrumentation-node.ts', 'proxy.ts',
})
ROOT_TREES = ('app', 'components', 'hooks', 'lib', 'plugins', 'public', 'e2e', 'bin',
              'nix', 'docs', '.github')
# Admit ONLY this maintained subtree, not other agent/private configuration.
MAINTAINED_TREE = ('.agents', 'skills', 'writing-plans')
REQUIRED = frozenset({'flake.nix', 'flake.lock', 'package.json',
                      'package-lock.json', 'tsconfig.json'})
SUFFIXES = frozenset({'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
    '.md', '.nix', '.sh', '.py', '.c', '.h', '.css', '.svg', '.html',
    '.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.gif',
    '.webp', '.ico', '.txt', '.yaml', '.yml', '.license', '.webmanifest'})
EXCLUDED_NAMES = frozenset({'.git', 'node_modules', '.next', 'test-results',
    'coverage', 'build', 'out', '__pycache__', '.cache', '.config', '.local',
    '.pi', '.ssh', '.gnupg', '.npm', '.npmrc', '.yarnrc', '.yarnrc.yml',
    'private', 'credentials', 'secrets', 'auth.json', 'credentials.json',
    'settings.json', 'models.json', 'config.json', 'brabbler-accounts.json',
    'pi-web-accounts.json',  # Legacy secrets remain excluded, never migrated/read.
    'git-workflow-settings.json', 'next-env.d.ts', '.ds_store', '.pnp',
    '.yarn', '.vercel', '.factory', 'skills-lock.json'})
SECRET_SUFFIXES = ('.pem', '.key', '.p12', '.pfx', '.tsbuildinfo', '.log')
# Per snapshot: charge EVERY enumerated name, even ignored/restricted entries.
MAX_ENTRIES = 25_000
MAX_PATH_BYTES = 4096
MAX_DEPTH = 64
MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_REPORT_BYTES = 32 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC


class ExportError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ExportError(message)


def safe_name(name):
    require(name not in ('', '.', '..') and '/' not in name and '\\' not in name
            and not any(ord(c) < 32 or ord(c) == 127 for c in name),
            'Unsafe source entry name')


def excluded(name):
    # Reviewed CURRENT .gitignore rules, plus the stricter source allowlist.
    # No dynamic ignore-file parsing and no Git/index dependence. Root-only
    # ignores are conservatively excluded below admitted trees as well.
    lower = name.lower()
    return (lower in EXCLUDED_NAMES or lower.startswith(('.env', '.pnp.'))
            or lower.startswith(('npm-debug.log', 'yarn-debug.log',
                                 'yarn-error.log', '.pnpm-debug.log'))
            or (lower.startswith('e2e_') and lower.endswith('.mjs'))
            or lower.endswith(SECRET_SUFFIXES) or lower.endswith(('~', '.bak'))
            or lower.startswith(('.brabbler-', '.pi-web-', '.pi-desk-')))


def identity(s, directory=False):
    value = [s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid]
    if not directory:
        value += [s.st_size, s.st_mtime_ns, s.st_ctime_ns]
    return value


def file_record(s):
    return {'kind': 'file', 'mode': stat.S_IMODE(s.st_mode), 'bytes': s.st_size,
            'identity': identity(s)}


def content_modes(rows):
    return {name: {k: v for k, v in row.items() if k != 'identity'}
            for name, row in sorted(rows.items())}


def snapshot(root_fd, destination_fd=None, expected=None):
    rows, omissions = {}, []
    total = 0
    enumerated = 0
    metadata_bytes = 0

    def names_in(fd, prefix=''):
        nonlocal enumerated, metadata_bytes
        names = []
        # scandir is consumed incrementally, never listdir/set of an unbounded
        # directory. Sort only AFTER this bounded collection has succeeded.
        # A fresh open description avoids sharing scandir's directory cursor
        # across repeated snapshots of the same pinned FD.
        scan_fd = os.open('.', DIR_FLAGS, dir_fd=fd)
        try:
            with os.scandir(scan_fd) as entries:
                for entry in entries:
                    enumerated += 1
                    require(enumerated <= MAX_ENTRIES, 'Source enumeration bound exceeded')
                    name = entry.name
                    require(len(name) <= MAX_PATH_BYTES and len(os.fsencode(name)) <= MAX_PATH_BYTES,
                            'Source path metadata bound exceeded')
                    safe_name(name)
                    relative = prefix + '/' + name if prefix else name
                    length = len(os.fsencode(relative))
                    require(length <= MAX_PATH_BYTES, 'Source path metadata bound exceeded')
                    require(relative.count('/') < MAX_DEPTH, 'Source depth bound exceeded')
                    metadata_bytes += length
                    require(metadata_bytes <= MAX_METADATA_BYTES, 'Source metadata bound exceeded')
                    names.append(name)
        finally:
            os.close(scan_fd)
        return sorted(names)

    def insert(relative, row):
        require(len(rows) < MAX_ENTRIES, 'Source entry bound exceeded')
        if expected is not None:
            require(relative in expected and row['identity'] == expected[relative]['identity'],
                    f'Source identity/mode changed before reading: {relative}')
        rows[relative] = row

    def copy_file(parent, name, relative, dest, s):
        nonlocal total
        require(stat.S_ISREG(s.st_mode), f'Not a regular source file: {relative}')
        require(not s.st_mode & (stat.S_ISUID | stat.S_ISGID), f'Privileged file mode: {relative}')
        require(s.st_size <= MAX_FILE_BYTES, f'Source file bound exceeded: {relative}')
        total += s.st_size
        require(total <= MAX_TOTAL_BYTES, 'Source byte bound exceeded')
        row = file_record(s)
        insert(relative, row)
        fd = os.open(name, FILE_FLAGS, dir_fd=parent)
        output = None
        try:
            require(identity(os.fstat(fd)) == identity(s), f'Source open changed: {relative}')
            if dest is not None:
                output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=dest)
            digest, count = hashlib.sha256(), 0
            while True:
                data = os.read(fd, 128 * 1024)
                if not data:
                    break
                count += len(data)
                require(count <= s.st_size, f'Source grew during read: {relative}')
                digest.update(data)
                if output is not None:
                    pending = memoryview(data)
                    while pending:
                        written = os.write(output, pending)
                        require(written > 0, 'Short source-copy write')
                        pending = pending[written:]
            require(count == s.st_size and identity(os.fstat(fd)) == identity(s)
                    and identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) == identity(s),
                    f'Source changed during read: {relative}')
            row['sha256'] = digest.hexdigest()
            if expected is not None:
                require(row == expected[relative], f'Source content changed: {relative}')
            if output is not None:
                os.fchmod(output, row['mode'])
        finally:
            if output is not None:
                os.close(output)
            os.close(fd)

    def directory(parent, name, relative, dest, restricted=None):
        safe_name(name)
        s = os.stat(name, dir_fd=parent, follow_symlinks=False)
        require(stat.S_ISDIR(s.st_mode), f'Not a physical source directory: {relative}')
        require(not s.st_mode & (stat.S_ISUID | stat.S_ISGID), f'Privileged directory: {relative}')
        insert(relative, {'kind': 'directory', 'mode': stat.S_IMODE(s.st_mode),
                          'identity': identity(s, True)})
        fd = os.open(name, DIR_FLAGS, dir_fd=parent)
        output = None
        try:
            require(identity(os.fstat(fd), True) == identity(s, True), f'Directory changed: {relative}')
            if dest is not None:
                os.mkdir(name, 0o700, dir_fd=dest)
                output = os.open(name, DIR_FLAGS, dir_fd=dest)
            for child in names_in(fd, relative):
                child_rel = relative + '/' + child
                if restricted is not None:
                    if child == restricted[0]:
                        directory(fd, child, child_rel, output, restricted[1:] or None)
                    else:
                        # Charge/record this boundary name, never enumerate its
                        # protected descendants or claim their complete census.
                        omissions.append(child_rel)
                    continue
                if excluded(child):
                    omissions.append(child_rel)
                    continue
                require(not child.startswith('.'), f'Unapproved hidden source entry: {child_rel}')
                cs = os.stat(child, dir_fd=fd, follow_symlinks=False)
                require(not stat.S_ISLNK(cs.st_mode), f'Source symlink refused: {child_rel}')
                if stat.S_ISDIR(cs.st_mode):
                    directory(fd, child, child_rel, output)
                else:
                    require(Path(child).suffix.lower() in SUFFIXES or child in ('LICENSE', 'NOTICE'),
                            f'Unapproved source file: {child_rel}')
                    copy_file(fd, child, child_rel, output, cs)
            require(identity(os.fstat(fd), True) == identity(s, True)
                    and identity(os.stat(name, dir_fd=parent, follow_symlinks=False), True) == identity(s, True),
                    f'Source directory replaced: {relative}')
            if output is not None:
                os.fchmod(output, stat.S_IMODE(s.st_mode))
        finally:
            if output is not None:
                os.close(output)
            os.close(fd)

    names = names_in(root_fd)
    require(REQUIRED <= set(names), 'Not a complete source root (required manifests/config absent)')
    for name in names:
        if name in ROOT_FILES:
            copy_file(root_fd, name, name, destination_fd,
                      os.stat(name, dir_fd=root_fd, follow_symlinks=False))
        elif name in ROOT_TREES:
            directory(root_fd, name, name, destination_fd)
        elif name == MAINTAINED_TREE[0]:
            directory(root_fd, name, name, destination_fd, MAINTAINED_TREE[1:])
        else:
            # Names only. Never traverse/stat/open excluded root contents.
            omissions.append(name)
    if expected is not None:
        require(rows == expected, 'Source inventory changed')
    return rows, sorted(omissions)


def absolute_path(value):
    raw = os.fspath(value)
    require(isinstance(raw, str) and os.path.isabs(raw), 'Absolute paths required')
    require(len(raw) <= MAX_PATH_BYTES and len(os.fsencode(raw)) <= MAX_PATH_BYTES,
            'Path metadata bound exceeded')
    require(raw == '/' or all(part not in ('', '.', '..') for part in raw.split('/')[1:]),
            'Canonical absolute paths required')
    path = Path(raw)  # lexical only; never resolve symlinks
    require(len(path.parts) <= MAX_DEPTH, 'Path depth bound exceeded')
    for part in path.parts[1:]:
        safe_name(part)
    return path


class DirectoryPath:
    """Pin every public-path edge from /, BEFORE any source content open.

    O_NOFOLLOW on a multi-component absolute path is insufficient. Only the
    trusted / acquisition is absolute; every subsequent open is one component
    relative to a held directory FD, with pre/open/name identity comparisons.
    Rechecks observe original public edges, not a newly resolved replacement.
    """
    def __init__(self, value):
        self.path = absolute_path(value)
        self.fds, self.pins, self.links = [], [], []
        try:
            self.fds.append(os.open('/', DIR_FLAGS))
            self.pins.append(identity(os.fstat(self.fds[0]), True))
            for part in self.path.parts[1:]:
                parent = self.fds[-1]
                before = os.stat(part, dir_fd=parent, follow_symlinks=False)
                require(stat.S_ISDIR(before.st_mode), 'Path must be physical, not a symlink/alias')
                fd = os.open(part, DIR_FLAGS, dir_fd=parent)
                self.fds.append(fd)
                pin = identity(before, True)
                self.pins.append(pin)
                self.links.append((parent, part, fd, pin))
                require(identity(os.fstat(fd), True) == pin
                        and identity(os.stat(part, dir_fd=parent, follow_symlinks=False), True) == pin,
                        'Public directory changed during acquisition')
            self.validate()
        except BaseException:
            self.close()
            raise

    @property
    def fd(self):
        return self.fds[-1]

    def validate(self):
        require(identity(os.fstat(self.fds[0]), True) == self.pins[0], 'Root directory changed')
        for parent, name, fd, pin in self.links:
            require(identity(os.fstat(fd), True) == pin
                    and identity(os.stat(name, dir_fd=parent, follow_symlinks=False), True) == pin,
                    'Original public directory path changed')

    def close(self):
        while self.fds:
            # Read-only directory FD release is not a post-publication check
            # or a durability operation. File writes/flush/close precede commit.
            fd = self.fds.pop()
            try:
                os.close(fd)
            except OSError:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def paths(source, output, manifest):
    source, output, manifest = map(absolute_path, (source, output, manifest))
    require(manifest.parent == output.parent and manifest != output, 'Manifest must be an external sibling')
    require(not output.is_relative_to(source) and not source.is_relative_to(output),
            'Source and output must be disjoint')
    return source, output, manifest


def private_parent(parent, source):
    ps = os.fstat(parent.fd)
    require(ps.st_uid == os.getuid() and stat.S_IMODE(ps.st_mode) == 0o700,
            'Output parent must be an owned private 0700 directory')
    # In addition to lexical disjointness, reject an acquired parent ancestry
    # that aliases the acquired source root. This is not a mount sandbox.
    require(source.pins[-1][:2] not in [p[:2] for p in parent.pins],
            'Acquired source and output parent must be disjoint')
    source.validate()
    parent.validate()


def require_absent(parent_fd, name):
    try:
        os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise ExportError('Output/manifest already exists')


def encoded_chunks(value):
    size = 0
    for text in json.JSONEncoder(sort_keys=True, separators=(',', ':'), ensure_ascii=True).iterencode(value):
        data = text.encode('ascii')
        size += len(data)
        require(size <= MAX_REPORT_BYTES, 'Report metadata bound exceeded')
        yield data


def content_digest(rows):
    digest = hashlib.sha256()
    for data in encoded_chunks(rows):
        digest.update(data)
    return digest.hexdigest()


def write_unpublished(parent_fd, report):
    name = '.export-manifest-' + uuid.uuid4().hex + '.tmp'
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=parent_fd)
    with os.fdopen(fd, 'wb') as stream:
        for data in encoded_chunks(report):
            stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
        pin = identity(os.fstat(stream.fileno()))
    return name, pin


def export_source(source, output, manifest):
    source, output, manifest = paths(source, output, manifest)
    with DirectoryPath(source) as src, DirectoryPath(output.parent) as parent:
        private_parent(parent, src)
        require_absent(parent.fd, output.name)
        require_absent(parent.fd, manifest.name)
        before, omitted = snapshot(src.fd)
        os.mkdir(output.name, 0o700, dir_fd=parent.fd)
        # Acquire output with the same component-wise public path policy.
        with DirectoryPath(output) as dst:
            require(dst.pins[:-1] == parent.pins, 'Export parent identity changed')
            snapshot(src.fd, dst.fd, expected=before)
            after, omitted_after = snapshot(src.fd, expected=before)
            exported, output_omissions = snapshot(dst.fd)
            require(not output_omissions, 'Unexpected entries in export')
            expected_content = content_modes(before)
            require(content_modes(exported) == expected_content, 'Export content/mode inventory mismatch')
            require(omitted == omitted_after, 'Source entry inventory changed during export')
            report = {'version': 2, 'status': 'complete', 'source': str(source), 'export': str(output),
                      'before': before, 'after': after, 'exported': content_modes(exported),
                      'roots': {'source': src.pins[-1], 'parent': parent.pins[-1], 'export': dst.pins[-1]},
                      'omittedNames': omitted,
                      'omissionPolicy': 'Bounded enumerated boundary names only; protected descendants not traversed or counted.',
                      'contentModeSha256': content_digest(expected_content),
                      'durability': 'Manifest file fsynced before atomic name publication; directory/export crash durability NOT asserted.',
                      'note': 'Bounded observations, not continuous mutable-path protection, Git authority or secret detection.'}
            temporary, temporary_pin = write_unpublished(parent.fd, report)
            # ALL required consistency checks precede the one commit step.
            src.validate()
            parent.validate()
            dst.validate()
            require(identity(os.stat(temporary, dir_fd=parent.fd, follow_symlinks=False)) == temporary_pin,
                    'Unpublished manifest identity changed')
            # Same-parent atomic no-replace publication. Existing/racing final
            # names fail, never overwrite. Retain the temporary hardlink for
            # audit; no cleanup/check/fsync that can fail AFTER publication.
            os.link(temporary, manifest.name, src_dir_fd=parent.fd, dst_dir_fd=parent.fd,
                    follow_symlinks=False)
            return report
    # Pre-commit failures retain private partial files, not a published final
    # manifest. A kill/stdout failure AFTER commit may leave one: consumers
    # MUST require original exporter exit0 AND verify the matching manifest.


def verify_manifest(source, output, manifest):
    """Consumer check after successful export, NOT a replacement for exit0.

    Re-read the exact final manifest and exported content/modes. No live-source
    contents are read here and no continued immutability/durability is promised.
    """
    source, output, manifest = paths(source, output, manifest)
    with DirectoryPath(source) as src, DirectoryPath(output.parent) as parent, DirectoryPath(output) as dst:
        private_parent(parent, src)
        s = os.stat(manifest.name, dir_fd=parent.fd, follow_symlinks=False)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid()
                and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size <= MAX_REPORT_BYTES,
                'Invalid final manifest file')
        fd = os.open(manifest.name, FILE_FLAGS, dir_fd=parent.fd)
        try:
            require(identity(os.fstat(fd)) == identity(s), 'Manifest open changed')
            data = bytearray()
            while True:
                chunk = os.read(fd, min(128 * 1024, MAX_REPORT_BYTES - len(data) + 1))
                if not chunk:
                    break
                data.extend(chunk)
                require(len(data) <= MAX_REPORT_BYTES, 'Report metadata bound exceeded')
            require(identity(os.fstat(fd)) == identity(s) and len(data) == s.st_size
                    and identity(os.stat(manifest.name, dir_fd=parent.fd, follow_symlinks=False)) == identity(s),
                    'Manifest changed during read')
        finally:
            os.close(fd)
        report = json.loads(data)
        require(isinstance(report, dict) and report.get('version') == 2 and report.get('status') == 'complete'
                and report.get('source') == str(source) and report.get('export') == str(output),
                'Complete matching manifest required')
        require(report.get('roots') == {'source': src.pins[-1], 'parent': parent.pins[-1], 'export': dst.pins[-1]},
                'Manifest root identity mismatch')
        rows, output_omissions = snapshot(dst.fd)
        require(not output_omissions, 'Unexpected entries in export')
        observed = content_modes(rows)
        require(isinstance(report.get('before'), dict) and report['before'] == report.get('after')
                and all(isinstance(row, dict) for row in report['before'].values()), 'Invalid source inventory')
        require(observed == report.get('exported') == content_modes(report['before'])
                and content_digest(observed) == report.get('contentModeSha256'),
                'Manifest/export content-mode mismatch')
        src.validate()
        parent.validate()
        dst.validate()
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help='approved physical source checkout')
    parser.add_argument('--output', required=True, help='new export directory under a private parent')
    parser.add_argument('--manifest', required=True, help='new private manifest outside the export')
    parser.add_argument('--verify-manifest', action='store_true',
                        help='after export exit0, verify the exact final manifest and exported inventory')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        operation = verify_manifest if args.verify_manifest else export_source
        report = operation(args.source, args.output, args.manifest)
    except (OSError, ValueError, TypeError, RecursionError) as error:
        parser.exit(1, f'Source export/verification refused: {error}\n')
    # A broken stdout/termination after publication is NOT export exit0. Do not
    # infer success from a final pathname in that case; crash durability is not
    # guaranteed and this code never rolls back an already published document.
    print(f'Complete matching source export: {report["export"]}')
    print(f'Content/mode SHA256: {report["contentModeSha256"]}')
    print(f'Manifest: {args.manifest}')


if __name__ == '__main__':
    main()
