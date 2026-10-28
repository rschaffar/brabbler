#!/usr/bin/env python3
"""Offline deterministic assembly of preserved source materials; no upstream code executes.
Requires Python 3 and a system GNU-compatible patch utility. No network or Git usage.
Usage: python3 assemble.py --output NEW_DIRECTORY --archive OUTPUT.tar.gz
The output directory and archive must not already exist.
"""
import argparse, gzip, hashlib, json, os, pathlib, shutil, subprocess, tarfile
ROOT_NAME='elkjs-0.9.3-source-materials'
SEED=pathlib.Path(__file__).resolve().parent

def sha(data):return hashlib.sha256(data).hexdigest()

def tree_hash(root):
    rows=[(p.relative_to(root).as_posix(),sha(p.read_bytes())) for p in sorted(root.rglob('*')) if p.is_file()]
    text=''.join(digest+'  '+name+'\n' for name,digest in rows)
    return {'files':len(rows),'sha256_of_sorted_file_hash_listing':sha(text.encode())}

def extract(archive,destination):
    destination.mkdir(parents=True)
    with tarfile.open(archive) as source:
        for item in source:
            path=pathlib.PurePosixPath(item.name)
            if item.name.startswith('/') or '..' in path.parts or '.git' in path.parts:
                raise RuntimeError('unsafe archive path')
            parts=path.parts[1:]
            if not parts:continue
            target=destination.joinpath(*parts)
            if item.isdir():target.mkdir(parents=True,exist_ok=True)
            elif item.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(source.extractfile(item).read())
            else:raise RuntimeError('source archive contains non-regular member')

def assemble(output,archive):
    output=output.resolve();archive=archive.resolve()
    if output.exists() or archive.exists():raise RuntimeError('refusing to overwrite output')
    if SEED==output or SEED in output.parents or output in archive.parents:
        raise RuntimeError('choose output outside the seed and archive outside output')
    manifest=json.loads((SEED/'MANIFEST.json').read_text())
    for item in manifest['inputs']:
        body=(SEED/item['file']).read_bytes()
        if len(body)!=item['bytes'] or sha(body)!=item['sha256']:raise RuntimeError('original input mismatch: '+item['file'])
    mailbox=b''.join((SEED/item['file']).read_bytes() for item in manifest['patch_series'])
    if mailbox!=(SEED/'originals/elk-pr955.patch').read_bytes():raise RuntimeError('patch order/original mismatch')
    for item in manifest['patch_series']:
        if sha((SEED/item['file']).read_bytes())!=item['sha256']:raise RuntimeError('split patch hash mismatch')
    output.mkdir(parents=True)
    root=output/ROOT_NAME;root.mkdir()
    for name in ['originals','patches','provenance','notices','README.md','SOURCE-AVAILABILITY.txt','MANIFEST.json','assemble.py','ASSEMBLY-LICENSE.txt']:
        source=SEED/name;target=root/name
        if source.is_dir():shutil.copytree(source,target)
        else:shutil.copyfile(source,target)
    extract(root/'originals/elk-v0.9.1-source.tar.gz',root/'sources/elk')
    extract(root/'originals/elkjs-0.9.3-source.tar.gz',root/'sources/elkjs')
    results=[]
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LC_ALL':'C'}
    for item in manifest['patch_series']:
        command=['patch','--batch','--forward','--fuzz=0','--no-backup-if-mismatch','-p1','--input','../../'+item['file']]
        check=subprocess.run(command+['--dry-run'],cwd=root/'sources/elk',env=env,capture_output=True,text=True)
        record={'order':item['order'],'patch':item['file'],'dry_run_exit':check.returncode,'dry_run_stdout':check.stdout,'dry_run_stderr':check.stderr}
        if check.returncode:raise RuntimeError('patch dry run failed: '+json.dumps(record))
        applied=subprocess.run(command,cwd=root/'sources/elk',env=env,capture_output=True,text=True)
        record.update(apply_exit=applied.returncode,apply_stdout=applied.stdout,apply_stderr=applied.stderr)
        if applied.returncode:raise RuntimeError('patch application failed: '+json.dumps(record))
        if any(word in (check.stdout+applied.stdout).lower() for word in ['offset','fuzz','failed','reversed']):
            raise RuntimeError('patch was not an exact-context application')
        results.append(record)
    for component in ['elk','elkjs']:
        if tree_hash(root/'sources'/component)!=manifest['source_trees'][component]:raise RuntimeError('assembled tree hash mismatch: '+component)
    (root/'provenance/assembly-patch-validation.json').write_text(json.dumps(results,indent=2)+'\n')
    (root/'ORIGINALS.sha256').write_text(''.join(item['sha256']+'  '+item['file']+'\n' for item in manifest['inputs']))
    (root/'TREE-SHA256SUMS').write_text(''.join(sha(p.read_bytes())+'  '+p.relative_to(root).as_posix()+'\n' for p in sorted(root.rglob('*')) if p.is_file()))
    archive.parent.mkdir(parents=True,exist_ok=True)
    with archive.open('wb') as raw:
        with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0,compresslevel=9) as zipped:
            with tarfile.open(fileobj=zipped,mode='w',format=tarfile.PAX_FORMAT) as tar:
                for path in [root,*sorted(root.rglob('*'))]:
                    info=tar.gettarinfo(str(path),arcname=path.relative_to(output).as_posix())
                    info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0;info.mode=0o755 if path.is_dir() else 0o644;info.pax_headers={}
                    if path.is_file():
                        with path.open('rb') as body:tar.addfile(info,body)
                    elif path.is_dir():tar.addfile(info)
                    else:raise RuntimeError('unexpected non-regular output')
    return {'root':ROOT_NAME,'archive_sha256':sha(archive.read_bytes()),'archive_bytes':archive.stat().st_size,'source_trees':manifest['source_trees'],'all_seven_patches_applied_without_fuzz_or_offsets':True,'upstream_code_executed':False,'source_basis':manifest['source_basis']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=pathlib.Path)
    parser.add_argument('--archive',required=True,type=pathlib.Path)
    args=parser.parse_args()
    print(json.dumps(assemble(args.output,args.archive),indent=2))
