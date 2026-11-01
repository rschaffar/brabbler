#!/usr/bin/env node
// Temporary offline tool; not an application entry point. All output is bounded
// counts/fixed reasons. Sensitive manifests/reconstruction witnesses stay private.
import { pathToFileURL } from 'node:url';
import { dryRun, operate } from './run.mjs';
import { fixedReason, refuse } from './io.mjs';
export const ATTESTATION = 'I_STOPPED_ALL_SELECTED_WRITERS';
export function argumentsFor(argv) {
  const [mode, ...args] = argv;
  if (!['dry-run', 'check', 'apply', 'resume', 'restore'].includes(mode)) refuse('mode-required');
  const options = { sessions: [], repositories: [], mappings: [] }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!value || !['--sessions', '--operations', '--legacy', '--output', '--admit', '--map', '--confirm', '--writers-stopped', '--retain-blocked'].includes(key)) refuse('invalid-arguments');
    if (!['--sessions', '--admit', '--map'].includes(key) && seen.has(key)) refuse('duplicate-argument'); seen.add(key);
    if (key === '--sessions') options.sessions.push(value);
    else if (key === '--operations') options.operations = value === 'none' ? null : value;
    else if (key === '--legacy') options.legacy = value;
    else if (key === '--output') options.output = value;
    else if (key === '--admit') options.repositories.push(value);
    else if (key === '--map') {
      const at = value.indexOf('='); if (at < 1) refuse('invalid-mapping'); options.mappings.push({ from: value.slice(0, at), to: value.slice(at + 1) });
    } else if (key === '--confirm') { if (!/^[a-f0-9]{64}$/.test(value)) refuse('invalid-confirmation'); options.confirm = value; }
    else if (key === '--writers-stopped') { if (value !== ATTESTATION) refuse('explicit-stopped-writer-attestation-required'); options.writersStopped = true; }
    else if (key === '--retain-blocked') { if (value !== 'LEAVE_BLOCKED_INPUTS_UNCHANGED') refuse('explicit-block-disposition-required'); options.retainBlocked = true; }
  }
  if (!options.output) refuse('output-root-required');
  if (mode !== 'dry-run' && [...seen].some(k => ['--sessions', '--operations', '--legacy', '--admit', '--map'].includes(k))) refuse('use-frozen-manifest-roots');
  return { mode, options };
}
export async function main(argv) {
  const mutation = ['apply', 'resume', 'restore'].includes(argv[0]);
  try {
    const { mode, options } = argumentsFor(argv), result = mode === 'dry-run' ? await dryRun(options) : await operate(mode, options);
    process.stdout.write(JSON.stringify(result) + '\n'); return result.blocks || result.status === 'incomplete' ? 2 : 0;
  } catch (e) {
    // Even a failed journal write can follow a successful per-file rename. Do
    // not claim zero effects, guess a rollback, or print an exception fragment.
    process.stderr.write(JSON.stringify(mutation ? { status: 'recovery-required', reason: fixedReason(e), stateMayHaveChanged: true,
      recovery: ['check --output <same-run>', 'resume --output <same-run> --confirm <approved-manifest> --writers-stopped I_STOPPED_ALL_SELECTED_WRITERS',
        'restore --output <same-run> --confirm <approved-manifest> --writers-stopped I_STOPPED_ALL_SELECTED_WRITERS'] }
      : { status: 'refused', reason: fixedReason(e) }) + '\n'); return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
