import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Nix supplies the pinned build tool. No runtime bundler or upstream prebuilt
// Mermaid inventory: bundle the application's exact locked module graph.
mkdirSync('public/mermaid-renderer/v1', { recursive: true });
const result = spawnSync('esbuild', [
  'lib/mermaid-renderer-entry.ts', '--bundle', '--format=iife', '--platform=browser',
  '--target=es2022', '--minify', '--legal-comments=linked',
  '--loader:.woff2=dataurl', '--loader:.woff=dataurl', '--loader:.ttf=dataurl',
  '--outfile=public/mermaid-renderer/v1/render.js',
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
