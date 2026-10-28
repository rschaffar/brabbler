// Run with the pinned Nix development dependencies; no application build is needed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { robotSvg } from './robot.mjs';

// Sharp is Next's pinned image dependency, not a new application dependency.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const root = fileURLToPath(new URL('../../', import.meta.url));
const check = process.argv.slice(2);
if (check.some(arg => arg !== '--check') || check.length > 1) {
  throw new Error('Usage: node tools/branding/generate.mjs [--check]');
}
const expected = new Map();
const svg = Buffer.from(robotSvg());
for (const publicRoot of ['public', 'demo/public']) {
  expected.set(`${publicRoot}/brand/robot.svg`, svg);
  for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
    const png = await sharp(svg).resize(size, size, { fit: 'contain', background: '#FFF9ED' })
      .flatten({ background: '#FFF9ED' }).png().toBuffer();
    expected.set(`${publicRoot}/icons/${name}.png`, png);
  }
}

// PNG-backed ICO entries preserve alpha and support native 16/32/48px favicons.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => sharp(svg)
  .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
const ico = Buffer.concat([header, ...images]);
expected.set('app/favicon.ico', ico);
expected.set('demo/app/favicon.ico', ico);

const poses = [[0, false], [1, false], [2, false], [1, false], [0, true], [2, false], [0, false], [1, false]];
const frames = await Promise.all(poses.map(([pose, blink]) => sharp(Buffer.from(robotSvg(pose, blink)))
  .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
expected.set('docs/brand/robot-brabbling.gif', await sharp(frames, { join: { animated: true } })
  .gif({ loop: 0, delay: [180, 130, 170, 130, 140, 160, 200, 150], effort: 5 }).toBuffer());

for (const [relative, bytes] of expected) {
  const file = resolve(root, relative);
  if (check.length) {
    if (!(await readFile(file)).equals(bytes)) throw new Error(`Generated branding differs: ${relative}`);
  } else {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}
console.log(`${check.length ? 'Verified' : 'Generated'} ${expected.size} branding assets.`);
