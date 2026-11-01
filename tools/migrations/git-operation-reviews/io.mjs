// Linux-only descriptor-relative boundary. No ambient state, fallback or deletion.
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
export class Refusal extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
export const refuse = reason => { throw new Refusal(reason); };
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const C = fs.constants;
export function platform() {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) !== 24 || !C.O_NOFOLLOW || !C.O_DIRECTORY || !C.O_NONBLOCK) refuse('unsupported-platform');
}
export const identity = s => [s.dev, s.ino, s.mode, s.uid, s.gid].map(String).join(':');
export function stat(fd) {
  const s = fs.fstatSync(fd, { bigint: true });
  return { identity: identity(s), dev: String(s.dev), ino: String(s.ino), mode: Number(s.mode & 0o7777n), uid: Number(s.uid), gid: Number(s.gid),
    links: Number(s.nlink), bytes: Number(s.size), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) };
}
export const sameStat = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function name(value) { if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\/\0]/.test(value)) refuse('unsafe-path'); return value; }
function parts(value) { if (typeof value !== 'string' || isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..' || p.includes('\0'))) refuse('unsafe-relative-path'); return value.split('/'); }
export class Directory {
  constructor(fd, parent, child, absolute) { this.fd = fd; this.parent = parent; this.name = child; this.path = absolute; this.id = identity(fs.fstatSync(fd, { bigint: true })); }
  at(child) { return `/proc/self/fd/${this.fd}/${name(child)}`; }
  check() {
    if (identity(fs.fstatSync(this.fd, { bigint: true })) !== this.id) refuse('directory-changed');
    if (this.parent) {
      this.parent.check();
      if (identity(fs.lstatSync(this.parent.at(this.name), { bigint: true })) !== this.id) refuse('directory-edge-changed');
    } else if (identity(fs.lstatSync('/', { bigint: true })) !== this.id) refuse('directory-edge-changed');
  }
  child(child) {
    this.check();
    const fd = fs.openSync(this.at(child), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_NONBLOCK);
    try { const dir = new Directory(fd, this, child, this.path === '/' ? `/${child}` : `${this.path}/${child}`); dir.check(); return dir; }
    catch (e) { fs.closeSync(fd); throw e; }
  }
  file(child, flags = C.O_RDONLY, mode = 0o600) {
    this.check();
    const fd = fs.openSync(this.at(child), flags | C.O_NOFOLLOW | C.O_NONBLOCK, mode);
    try {
      const s = fs.fstatSync(fd, { bigint: true });
      if (!s.isFile() || s.nlink !== 1n || !Number.isSafeInteger(Number(s.size))) refuse('not-single-regular-file');
      if (Number(s.uid) !== process.geteuid() || Number(s.gid) !== process.getegid() || (Number(s.mode) & 0o7000)) refuse('unsupported-file-metadata');
      this.checkFile(child, fd); return fd;
    } catch (e) { fs.closeSync(fd); throw e; }
  }
  checkFile(child, fd) { this.check(); if (identity(fs.lstatSync(this.at(child), { bigint: true })) !== stat(fd).identity) refuse('file-edge-changed'); }
  names() { this.check(); const values = fs.readdirSync(`/proc/self/fd/${this.fd}`).sort(); this.check(); return values; }
  sync() { this.check(); fs.fsyncSync(this.fd); }
  close() { fs.closeSync(this.fd); }
}
export function holdRoot(path, { create = false, absent = false, assertDirectory } = {}) {
  platform();
  if (!isAbsolute(path) || resolve(path) !== path || path === '/') refuse('explicit-physical-root-required');
  let dir = new Directory(fs.openSync('/', C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW), null, '', '/');
  const held = [dir];
  try {
    assertDirectory?.(dir, false);
    const components = path.slice(1).split('/');
    for (const [index, p] of components.entries()) {
      if (create) {
        try { fs.mkdirSync(dir.at(p), { mode: 0o700 }); dir.sync(); }
        catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      try { dir = dir.child(p); held.push(dir); assertDirectory?.(dir, index === components.length - 1); }
      catch (e) { if (absent && e.code === 'ENOENT') { for (const d of held.reverse()) d.close(); return null; } throw e; }
    }
    return { dir, path, identity: dir.id, check: () => dir.check(), close: () => { for (const d of held.reverse()) d.close(); } };
  } catch (e) { for (const d of held.reverse()) d.close(); throw e; }
}
/** Physical overlap uses device/inode, not spelling, mount names or mode bits.
 * Input descendants come from the existing selected-tree inventory; ancestors
 * come only from held chains. No mount probing or saved-locator discovery. */
export const directoryObject = value => value.split(':').slice(0, 2).join(':');
export function assertOutputDisjoint(outputChain, inputDirectories, inputAncestors, final = true) {
  const tree = new Set([...inputDirectories].map(directoryObject)), parents = new Set([...inputAncestors].map(directoryObject));
  if (outputChain.some(id => tree.has(directoryObject(id))) || final && parents.has(directoryObject(outputChain.at(-1)))) refuse('aliased-output-root');
}
export function withParent(root, relative, fn) {
  const p = parts(relative), child = p.pop(), held = []; let dir = root.dir;
  try { for (const item of p) { dir = dir.child(item); held.push(dir); } return fn(dir, child); }
  finally { for (const d of held.reverse()) d.close(); }
}
export function hashFd(fd, start = 0, bytes = stat(fd).bytes - start) {
  if (![start, bytes, start + bytes].every(n => Number.isSafeInteger(n) && n >= 0)) refuse('unaddressable-file');
  const h = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let position = start;
  while (position < start + bytes) {
    const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, start + bytes - position), position);
    if (!read) refuse('incomplete-read'); h.update(buffer.subarray(0, read)); position += read;
  }
  return h.digest('hex');
}
export function readFd(fd) {
  const size = stat(fd).bytes, buffer = Buffer.alloc(size); let n = 0;
  while (n < size) { const read = fs.readSync(fd, buffer, n, size - n, n); if (!read) refuse('incomplete-read'); n += read; }
  return buffer;
}
export function inspect(root, relative, read = false) {
  return withParent(root, relative, (dir, child) => {
    const fd = dir.file(child);
    try {
      const before = stat(fd), bytes = read ? readFd(fd) : undefined, hash = bytes ? sha(bytes) : hashFd(fd);
      dir.checkFile(child, fd); if (!sameStat(before, stat(fd))) refuse('changed-during-read');
      return { ...before, sha256: hash, ...(read ? { data: bytes } : {}) };
    } finally { fs.closeSync(fd); }
  });
}
export function inventory(root, ignored = new Set()) {
  const files = [], directories = [], seen = new Set();
  function walk(dir, prefix) {
    const physical = directoryObject(dir.id);
    if (seen.has(physical)) refuse('aliased-input-directory'); seen.add(physical);
    const names = dir.names().filter(n => !ignored.has(prefix + n));
    directories.push({ path: prefix, identity: dir.id, names });
    for (const child of names) {
      const s = fs.lstatSync(dir.at(child));
      if (s.isDirectory()) { const sub = dir.child(child); try { walk(sub, prefix + child + '/'); } finally { sub.close(); } }
      else if (s.isFile() && s.nlink === 1) files.push(prefix + child);
      else refuse('nonregular-input');
    }
    if (JSON.stringify(names) !== JSON.stringify(dir.names().filter(n => !ignored.has(prefix + n)))) refuse('membership-changed');
  }
  walk(root.dir, ''); return { directories, files };
}
export function writeAll(fd, data, hooks = {}, label = 'write') {
  let offset = 0;
  while (offset < data.length) {
    const count = hooks.write ? hooks.write(fd, data, offset, label) : fs.writeSync(fd, data, offset, data.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > data.length - offset) refuse('write-no-progress'); offset += count;
  }
}
export function exclusive(dir, child, data, mode = 0o600, hooks = {}, label = 'artifact') {
  const fd = dir.file(child, C.O_WRONLY | C.O_CREAT | C.O_EXCL, 0o600);
  try { writeAll(fd, data, hooks, label); fs.fchmodSync(fd, mode); hooks.barrier?.(`${label}-before-fsync`); fs.fsyncSync(fd); return stat(fd); }
  finally { fs.closeSync(fd); }
}
export function atomic(dir, child, data, hooks = {}, label = 'journal') {
  const temporary = `.${child}.${randomUUID()}.tmp`;
  exclusive(dir, temporary, data, 0o600, hooks, label);
  dir.check(); hooks.barrier?.(`${label}-before-rename`); fs.renameSync(dir.at(temporary), dir.at(child)); dir.sync(); hooks.barrier?.(`${label}-durable`);
}
export function assertNoAttributes(fd) {
  // Node has no xattr API. Query only attribute NAMES through this held descriptor;
  // refuse ACLs/security/user attrs rather than silently lose them on replacement.
  const result = spawnSync('python3', ['-c', 'import os,sys; sys.exit(3 if os.listxattr(3) else 0)'], { stdio: ['ignore', 'ignore', 'ignore', fd] });
  if (result.status !== 0) refuse('unsupported-extended-metadata');
}
export function lock(root) {
  const fd = root.dir.file('run.lock', C.O_RDWR | C.O_CREAT);
  // Linux flock applies to the inherited open file description, retained here
  // until close. No stale PID locks or unlink/reaper are needed.
  const result = spawnSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] });
  if (result.status !== 0) { fs.closeSync(fd); refuse('run-locked'); }
  return () => fs.closeSync(fd);
}
export const fixedReason = e => e instanceof Refusal ? e.reason : ['ENOENT', 'EACCES', 'EPERM', 'ELOOP', 'ENOTDIR', 'EEXIST', 'ENOSPC', 'EIO'].includes(e?.code) ? `io-${e.code.toLowerCase()}` : 'validation-failed';
