import { runE2E } from '../nix/test-e2e.mjs';
try { await runE2E('browser'); }
catch (error) { console.error(error.message); process.exitCode = 1; }
