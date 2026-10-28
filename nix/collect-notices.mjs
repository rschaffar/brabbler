// Preserve legal text from the pinned build dependency tree without executing it.
// This is a notice collection, not a claim that every dependency is bundled.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const legalName = /^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$|^third[-_ ]?party.*(?:notice|license)/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = path => path.split(sep).join('/');
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function verifySourceVersion(moduleDirectory, sourceInfo) {
  const fromMermaid = createRequire(join(resolve(moduleDirectory), 'mermaid', 'package.json'));
  if (fromMermaid('elkjs/package.json').version !== sourceInfo.components.elkjs) {
    throw new Error('Source materials must match installed elkjs');
  }
}

export function collectNotices(moduleDirectory, destination) {
  const root = resolve(moduleDirectory), output = resolve(destination);
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) throw new Error('Use a physical dependency tree');
  if (output === root || output.startsWith(root + sep)) throw new Error('Keep generated notices outside dependencies');
  const components = new Map(), bodies = new Map();
  function walk(directory, inherited, inLegalDirectory = false) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    let owner = inherited;
    const manifest = entries.find(entry => entry.name === 'package.json');
    const packagePath = posix(relative(root, directory));
    const installedRoot = /^(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(packagePath);
    const nextVendorRoot = inherited?.record.name === 'next' && /^dist\/compiled\/(?:@[^/]+\/)?[^/]+$/.test(posix(relative(inherited.directory, directory)));
    if (manifest && (installedRoot || nextVendorRoot)) {
      if (!manifest.isFile()) throw new Error('Dependency metadata must be a regular file');
      const metadata = JSON.parse(readFileSync(join(directory, manifest.name), 'utf8'));
      if (typeof metadata.name === 'string') {
        const key = posix(relative(root, directory)) || '.';
        owner = { directory, record: {
          name: metadata.name, version: metadata.version ?? null,
          license: metadata.license ?? null, path: key, notices: [],
        } };
        components.set(key, owner.record);
      }
    }
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['.bin', '.cache', '.git'].includes(entry.name)) walk(file, owner, inLegalDirectory || /^(?:licen[cs]es?|notices?|legal)$/i.test(entry.name));
      } else if (owner && (legalName.test(entry.name) || inLegalDirectory)) {
        const canonical = realpathSync(file);
        if (!canonical.startsWith(root + sep) || !lstatSync(canonical).isFile()) throw new Error('Legal text escapes the dependency tree');
        const bytes = readFileSync(canonical), digest = hash(bytes);
        bodies.set(digest, bytes);
        owner.record.notices.push({ path: posix(relative(owner.directory, file)), file: `dependency-licenses/${digest}.txt`, sha256: digest });
      }
      // Directory symlinks (including .bin) are never traversed.
    }
  }
  walk(root, null);
  const records = [...components.values()].sort(compare);
  for (const record of records) record.notices.sort(compare);
  const inventory = {
    schemaVersion: 1,
    scope: 'Legal text collected from the pinned build dependency tree; inclusion does not assert bundled runtime code or a license-compliance certification. Original notices remain unchanged.',
    components: records,
  };
  mkdirSync(join(output, 'dependency-licenses'), { recursive: true });
  for (const [digest, bytes] of [...bodies].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    writeFileSync(join(output, 'dependency-licenses', `${digest}.txt`), bytes);
  }
  writeFileSync(join(output, 'DEPENDENCIES.json'), JSON.stringify(inventory, null, 2) + '\n');
  return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (![4, 5].includes(process.argv.length)) throw new Error('Usage: collect-notices.mjs NODE_MODULES OUTPUT_DIRECTORY [SOURCE_INFO_JSON]');
  if (process.argv[4]) verifySourceVersion(process.argv[2], JSON.parse(readFileSync(process.argv[4], 'utf8')));
  const inventory = collectNotices(process.argv[2], process.argv[3]);
  console.log(`Preserved dependency notices for ${inventory.components.length} package locations`);
}
