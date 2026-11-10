#!/usr/bin/env python3
"""Deterministic offline source assembly; never executes upstream code.
Populate MANIFEST.json inputs first. Requires only Python 3; no Git/patch/network.
Usage: python3 assemble.py --output NEW_DIRECTORY --archive NEW_ARCHIVE.tar.gz
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import shutil
import tarfile

SEED = pathlib.Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tree_hash(root):
    # Match the manifest's lexicographic POSIX-name order, not Path's
    # component ordering (which sorts a/b before a.txt).
    rows = sorted((p.relative_to(root).as_posix(), sha(p.read_bytes()))
                  for p in root.rglob('*') if p.is_file())
    listing = ''.join(digest + '  ' + name + '\n' for name, digest in rows)
    return {'files': len(rows), 'sha256_of_sorted_file_hash_listing': sha(listing.encode())}


def extract(archive, destination):
    destination.mkdir(parents=True)
    seen = set()
    top = None
    with tarfile.open(archive) as source:
        for item in source:
            path = pathlib.PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or '.git' in path.parts or not path.parts:
                raise RuntimeError('unsafe source archive path')
            if top is None:
                top = path.parts[0]
            if path.parts[0] != top:
                raise RuntimeError('source archive must have one top-level directory')
            if not (item.isdir() or item.isfile()):
                raise RuntimeError('source archive contains non-regular member')
            parts = path.parts[1:]
            if not parts:
                if not item.isdir():
                    raise RuntimeError('top-level member must be a directory')
                continue
            if path in seen:
                raise RuntimeError('duplicate archive path')
            seen.add(path)
            target = destination.joinpath(*parts)
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.extractfile(item).read())


def assemble(output, archive):
    output, archive = output.resolve(), archive.resolve()
    if output.exists() or archive.exists():
        raise RuntimeError('refusing to overwrite output')
    if (SEED == output or SEED in output.parents or output in SEED.parents
            or output in archive.parents or SEED == archive or SEED in archive.parents):
        raise RuntimeError('output and archive must be outside the seed; archive outside output')
    manifest = json.loads((SEED / 'MANIFEST.json').read_text())
    if manifest['patch_series']:
        raise RuntimeError('this assembly requires an unpatched upstream release')
    for item in manifest['inputs']:
        body = (SEED / item['file']).read_bytes()
        if len(body) != item['bytes'] or sha(body) != item['sha256']:
            raise RuntimeError('original input mismatch: ' + item['file'])
    output.mkdir(parents=True)
    root = output / manifest['archive_root']
    root.mkdir()
    for name in ['originals', 'provenance', 'notices', 'README.md',
                 'SOURCE-AVAILABILITY.txt', 'MANIFEST.json', 'assemble.py', 'ASSEMBLY-LICENSE.txt']:
        source, target = SEED / name, root / name
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copyfile(source, target)
    for component, source in manifest['source_archives'].items():
        extract(root / source, root / 'sources' / component)
        if tree_hash(root / 'sources' / component) != manifest['source_trees'][component]:
            raise RuntimeError('source tree mismatch: ' + component)
    (root / 'ORIGINALS.sha256').write_text(''.join(
        item['sha256'] + '  ' + item['file'] + '\n' for item in manifest['inputs']))
    (root / 'TREE-SHA256SUMS').write_text(''.join(
        sha(p.read_bytes()) + '  ' + p.relative_to(root).as_posix() + '\n'
        for p in sorted(root.rglob('*')) if p.is_file()))
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open('xb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=9) as zipped:
            with tarfile.open(fileobj=zipped, mode='w', format=tarfile.PAX_FORMAT) as tar:
                for path in [root, *sorted(root.rglob('*'))]:
                    info = tar.gettarinfo(str(path), arcname=path.relative_to(output).as_posix())
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    info.mtime = 0
                    info.mode = 0o755 if path.is_dir() else 0o644
                    info.pax_headers = {}
                    if path.is_file():
                        with path.open('rb') as body:
                            tar.addfile(info, body)
                    elif path.is_dir():
                        tar.addfile(info)
                    else:
                        raise RuntimeError('unexpected non-regular output')
    return {'root': manifest['archive_root'], 'archive_sha256': sha(archive.read_bytes()),
            'archive_bytes': archive.stat().st_size, 'source_trees': manifest['source_trees'],
            'patch_count': 0, 'upstream_code_executed': False,
            'source_basis': manifest['source_basis'],
            'traceability_limitation': manifest['traceability_limitation']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--archive', required=True, type=pathlib.Path)
    args = parser.parse_args()
    print(json.dumps(assemble(args.output, args.archive), indent=2))
