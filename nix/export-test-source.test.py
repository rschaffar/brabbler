"""Focused stdlib contracts; run only after the coordinator releases tests."""
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('source_export', Path(__file__).with_name('export-test-source.py'))
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


class SourceExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-export-contract-')
        self.base = Path(self.temp.name)
        self.source = self.base / 'checkout'
        self.source.mkdir(mode=0o700)
        self.private = self.base / 'audit'
        self.private.mkdir(mode=0o700)
        self.output = self.private / 'source'
        self.manifest = self.private / 'source.json'
        for name in exporter.REQUIRED:
            self.put(name, '{}\n')

    def tearDown(self):
        # Only this test's private fixture; readonly-mode cases need restoration.
        for directory, _, _ in os.walk(self.base):
            os.chmod(directory, 0o700)
        self.temp.cleanup()

    def put(self, name, value='source\n', mode=0o644):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        path.chmod(mode)
        return path

    def run_export(self):
        return exporter.export_source(self.source, self.output, self.manifest)

    def test_untracked_allowed_source_and_modes_are_included(self):
        self.put('nix/new-check.nix', '{ }\n')
        self.put('lib/new-untracked.test.mjs', 'export {};\n', 0o444)
        self.put('bin/fixture.sh', '#!/bin/sh\nexit 0\n', 0o755)
        self.put('docs/new-note.md')
        self.put('public/fonts/fixture.woff2', 'disposable-font')
        report = self.run_export()
        self.assertEqual(report['status'], 'complete')
        self.assertEqual(report['before'], report['after'])
        self.assertEqual(report['exported'], exporter.content_modes(report['before']))
        self.assertEqual((self.output / 'nix/new-check.nix').read_text(), '{ }\n')
        self.assertEqual(stat.S_IMODE((self.output / 'lib/new-untracked.test.mjs').stat().st_mode), 0o444)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.manifest.stat().st_mode), 0o600)
        self.assertEqual(json.loads(self.manifest.read_text())['contentModeSha256'], report['contentModeSha256'])

    def test_secret_and_generated_paths_are_not_opened_or_traversed(self):
        for name in ['.env', '.env.local', '.npmrc', 'auth.json', 'private/config.json',
                     '.next/cache/data.json', 'node_modules/pkg/index.js', 'test-results/private.json',
                     'lib/.env.secret', 'lib/auth.json', 'lib/private/token.json',
                     'lib/config.json', 'lib/credentials.json',
                     'lib/pi-web-accounts.json', 'lib/brabbler-accounts.json']:
            self.put(name, 'DO_NOT_READ')
        secret = self.base / 'outside-secret'
        secret.write_text('DO_NOT_READ')
        (self.source / '.git').symlink_to(secret)
        real_open = os.open
        def guarded_open(path, *args, **kwargs):
            if isinstance(path, (str, bytes, os.PathLike)):
                name = os.fsdecode(path)
                self.assertNotIn(Path(name).name,
                    {'.git', '.env', '.env.local', '.env.secret', '.npmrc', 'auth.json',
                     'private', 'node_modules', '.next', 'test-results', 'config.json',
                     'credentials.json', 'outside-secret',
                     'pi-web-accounts.json', 'brabbler-accounts.json'})
            return real_open(path, *args, **kwargs)
        with patch.object(exporter.os, 'open', side_effect=guarded_open):
            report = self.run_export()
        self.assertNotIn('lib/auth.json', report['before'])
        for name in ('lib/pi-web-accounts.json', 'lib/brabbler-accounts.json'):
            self.assertIn(name, report['omittedNames'])
            self.assertNotIn(name, report['before'])
            self.assertFalse((self.output / name).exists())
        self.assertFalse((self.output / '.git').exists())
        self.assertIn('.env', report['omittedNames'])
        self.assertIn('lib/private', report['omittedNames'])

    def test_only_approved_agent_skill_is_copied(self):
        self.put('.agents/skills/writing-plans/SKILL.md')
        self.put('.agents/skills/unapproved/secret.md', 'DO_NOT_READ')
        self.put('.agents/config.json', 'DO_NOT_READ')
        report = self.run_export()
        self.assertIn('.agents/skills/writing-plans/SKILL.md', report['before'])
        self.assertFalse((self.output / '.agents/config.json').exists())
        self.assertFalse((self.output / '.agents/skills/unapproved').exists())
        self.assertIn('.agents/config.json', report['omittedNames'])
        self.assertIn('.agents/skills/unapproved', report['omittedNames'])
        self.assertNotIn('.agents/skills/unapproved/secret.md', report['omittedNames'])
        self.assertIn('protected descendants not traversed', report['omissionPolicy'])

    def test_admitted_file_symlink_is_refused_without_reading_target(self):
        outside = self.base / 'outside-secret'
        outside.write_text('DO_NOT_READ')
        (self.source / 'lib').mkdir()
        (self.source / 'lib/alias.ts').symlink_to(outside)
        with self.assertRaisesRegex(exporter.ExportError, 'symlink'):
            self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_admitted_directory_symlink_is_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (self.source / 'nix').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(exporter.ExportError, 'physical source directory'):
            self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_internal_symlinks_also_fail_closed(self):
        target = self.put('lib/original.ts')
        (self.source / 'lib/alias.ts').symlink_to(target.name)
        with self.assertRaises(exporter.ExportError):
            self.run_export()

    def test_special_files_and_unknown_extensions_are_not_read(self):
        (self.source / 'lib').mkdir()
        os.mkfifo(self.source / 'lib/blocked.ts')
        with self.assertRaisesRegex(exporter.ExportError, 'regular source file'):
            self.run_export()
        (self.source / 'lib/blocked.ts').unlink()
        self.put('lib/unapproved.archive', 'DO_NOT_READ')
        with self.assertRaisesRegex(exporter.ExportError, 'Unapproved source file'):
            self.run_export()

    def test_changed_source_aborts_before_copying_new_bytes(self):
        path = self.put('lib/current.ts', 'original')
        original_snapshot = exporter.snapshot
        first = True
        def change_after_inventory(*args, **kwargs):
            nonlocal first
            result = original_snapshot(*args, **kwargs)
            if first:
                first = False
                path.write_text('changed bytes')
            return result
        with patch.object(exporter, 'snapshot', side_effect=change_after_inventory):
            with self.assertRaisesRegex(exporter.ExportError, 'changed before reading'):
                self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_private_parent_and_disjoint_new_output_are_required(self):
        self.private.chmod(0o755)
        with self.assertRaisesRegex(exporter.ExportError, '0700'):
            self.run_export()
        self.private.chmod(0o700)
        with self.assertRaisesRegex(exporter.ExportError, 'disjoint'):
            exporter.export_source(self.source, self.source / 'copy', self.source / 'manifest.json')
        self.output.mkdir()
        with self.assertRaisesRegex(exporter.ExportError, 'already exists'):
            self.run_export()

    def test_source_and_output_parent_symlink_aliases_are_refused(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(exporter.ExportError, 'physical'):
            exporter.export_source(alias, self.output, self.manifest)
        alias.unlink()
        alias.symlink_to(self.private, target_is_directory=True)
        with self.assertRaisesRegex(exporter.ExportError, 'physical'):
            exporter.export_source(self.source, alias / 'source', alias / 'manifest.json')

    def test_existing_manifest_is_never_overwritten(self):
        self.manifest.write_text('original audit')
        with self.assertRaisesRegex(exporter.ExportError, 'already exists'):
            self.run_export()
        self.assertEqual(self.manifest.read_text(), 'original audit')

    def test_resource_bound_refuses_instead_of_truncating(self):
        with patch.object(exporter, 'MAX_TOTAL_BYTES', 1):
            with self.assertRaisesRegex(exporter.ExportError, 'byte bound'):
                self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_known_ignore_patterns_never_open_in_any_admitted_tree(self):
        ignored = ['e2e_private.mjs', 'npm-debug.log.json', 'yarn-debug.log.mjs',
                   'yarn-error.log.ts', '.pnpm-debug.log.json', '.pnp.cjs',
                   '.DS_Store', 'next-env.d.ts', 'secret.pem', 'x.tsbuildinfo', '.env.local']
        for tree in (*exporter.ROOT_TREES, '.agents/skills/writing-plans'):
            for name in ignored:
                self.put(tree + '/' + name, 'DO_NOT_READ')
            for directory in ['.factory', '.vercel', '.yarn']:
                self.put(tree + '/' + directory + '/nested.ts', 'DO_NOT_READ')
        original_open = os.open
        def guarded_open(name, flags, *args, **kwargs):
            self.assertNotIn(os.fspath(name), ignored + ['.factory', '.vercel', '.yarn'])
            return original_open(name, flags, *args, **kwargs)
        with patch.object(exporter.os, 'open', side_effect=guarded_open):
            report = self.run_export()
        self.assertFalse(any(name.endswith('/e2e_private.mjs') for name in report['before']))
        self.assertIn('lib/npm-debug.log.json', report['omittedNames'])

    def ancestor_swap(self, role, timing, symlink=True):
        """Real rename/symlink race at a directory-open boundary, not a fake
        successful reader. Refuse BEFORE ANY regular source content open.
        """
        tag = role + '-' + timing + ('-link' if symlink else '-replacement')
        ancestor = self.base / ('edge-' + tag)
        ancestor.mkdir(mode=0o700)
        if role == 'source':
            self.source.rename(ancestor / 'checkout')
            self.source = ancestor / 'checkout'
            leaf = 'checkout'
        else:
            self.private.rename(ancestor / 'audit')
            self.private = ancestor / 'audit'
            self.output, self.manifest = self.private / 'source', self.private / 'source.json'
            leaf = 'audit'
        foreign = self.base / ('foreign-' + tag)
        foreign.mkdir(mode=0o700)
        (foreign / leaf).mkdir(mode=0o700)
        for name in exporter.REQUIRED:
            (foreign / leaf / name).write_text('UNINTENDED_CONTENT')
        held = self.base / ('held-' + tag)
        original_open = os.open
        swapped, regular_opens = False, []
        def raced_open(name, flags, *args, **kwargs):
            nonlocal swapped
            if not (flags & os.O_DIRECTORY):
                regular_opens.append(os.fspath(name))
                self.fail('No regular content may open after this pre-admission race')
            trigger = ancestor.name if timing == 'before' else leaf
            if not swapped and os.fspath(name) == trigger:
                swapped = True
                ancestor.rename(held)
                if symlink:
                    ancestor.symlink_to(foreign, target_is_directory=True)
                else:
                    foreign.rename(ancestor)
            return original_open(name, flags, *args, **kwargs)
        try:
            with patch.object(exporter.os, 'open', side_effect=raced_open):
                with self.assertRaises((OSError, exporter.ExportError)):
                    self.run_export()
            self.assertTrue(swapped)
            self.assertEqual(regular_opens, [])
        finally:
            if swapped:
                if symlink:
                    ancestor.unlink()
                else:
                    ancestor.rename(foreign)
                held.rename(ancestor)

    def test_source_ancestor_alias_races_open_no_content(self):
        for timing in ['before', 'after']:
            with self.subTest(timing=timing):
                self.ancestor_swap('source', timing)

    def test_output_parent_ancestor_alias_races_open_no_content(self):
        for timing in ['before', 'after']:
            with self.subTest(timing=timing):
                self.ancestor_swap('parent', timing)

    def test_physical_directory_replacements_are_identity_bound_before_reads(self):
        for role in ['source', 'parent']:
            with self.subTest(role=role):
                self.ancestor_swap(role, 'before', symlink=False)

    def test_only_trusted_slash_is_opened_as_an_absolute_directory(self):
        original_open = os.open
        def guarded_open(name, flags, *args, **kwargs):
            if os.path.isabs(name):
                self.assertEqual(name, '/')
                self.assertTrue(flags & os.O_DIRECTORY)
            else:
                self.assertNotIn('/', os.fspath(name))
                self.assertIsNotNone(kwargs.get('dir_fd'))
            self.assertTrue(flags & os.O_NOFOLLOW)
            return original_open(name, flags, *args, **kwargs)
        with patch.object(exporter.os, 'open', side_effect=guarded_open):
            self.run_export()

    def test_repeated_snapshots_do_not_share_directory_cursor(self):
        self.put('lib/current.ts')
        with exporter.DirectoryPath(self.source) as root:
            first = exporter.snapshot(root.fd)
            second = exporter.snapshot(root.fd)
        self.assertEqual(first, second)
        self.assertIn('lib/current.ts', first[0])

    def test_ignored_root_enumeration_is_incremental_and_bounded(self):
        for i in range(40):
            self.put(f'npm-debug.log{i}.json', 'DO_NOT_READ')
        original_scandir = os.scandir
        observed = []
        @contextmanager
        def counted(fd):
            with original_scandir(fd) as entries:
                def incremental():
                    for entry in entries:
                        observed.append(entry.name)
                        yield entry
                yield incremental()
        with patch.object(exporter, 'MAX_ENTRIES', 8), \
                patch.object(exporter.os, 'scandir', side_effect=counted):
            with self.assertRaisesRegex(exporter.ExportError, 'enumeration bound'):
                self.run_export()
        self.assertEqual(len(observed), 9)  # one over-limit observation, not all names
        self.assertFalse(self.output.exists())

    def test_ignored_and_restricted_directory_entries_consume_budget(self):
        for tree in ['lib', '.agents', '.agents/skills']:
            with self.subTest(tree=tree):
                for i in range(30):
                    self.put(f'{tree}/npm-debug.log{i}.json', 'DO_NOT_READ')
                original_open = os.open
                def guarded(name, flags, *args, **kwargs):
                    self.assertFalse(os.fspath(name).startswith('npm-debug.log'))
                    return original_open(name, flags, *args, **kwargs)
                with patch.object(exporter, 'MAX_ENTRIES', 12), \
                        patch.object(exporter.os, 'open', side_effect=guarded):
                    with self.assertRaisesRegex(exporter.ExportError, 'enumeration bound'):
                        self.run_export()
                for i in range(30):
                    (self.source / tree / f'npm-debug.log{i}.json').unlink()

    def test_depth_path_metadata_and_file_size_bounds(self):
        deep = 'lib/' + '/'.join(['child'] * 9) + '/payload.ts'
        path = self.put(deep)
        with patch.object(exporter, 'MAX_DEPTH', 8):
            with self.assertRaisesRegex(exporter.ExportError, 'depth bound'):
                self.run_export()
        path.unlink()
        # Remove empty deep directories so the next case measures path bytes.
        directory = path.parent
        while directory != self.source / 'lib':
            previous = directory.parent
            directory.rmdir()
            directory = previous
        long_path = self.put('lib/' + 'x' * 160 + '.ts')
        with patch.object(exporter, 'MAX_PATH_BYTES', 140):
            with self.assertRaisesRegex(exporter.ExportError, 'path metadata bound'):
                self.run_export()
        long_path.unlink()
        with patch.object(exporter, 'MAX_METADATA_BYTES', 1):
            with self.assertRaisesRegex(exporter.ExportError, 'metadata bound'):
                self.run_export()
        with patch.object(exporter, 'MAX_FILE_BYTES', 1):
            with self.assertRaisesRegex(exporter.ExportError, 'file bound'):
                self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_report_limit_and_write_failures_never_publish_final_name(self):
        original_chunks = exporter.encoded_chunks
        def partial_then_fail(value):
            if value.get('status') == 'complete':
                yield b'{"status":"complete",'
                raise OSError('injected serialization failure')
            yield from original_chunks(value)
        with patch.object(exporter, 'encoded_chunks', side_effect=partial_then_fail):
            with self.assertRaisesRegex(OSError, 'serialization failure'):
                self.run_export()
        self.assertFalse(self.manifest.exists())
        # Separate destination; retained partial export is never overwritten.
        self.output = self.private / 'second-source'
        with patch.object(exporter, 'MAX_REPORT_BYTES', 1):
            with self.assertRaisesRegex(exporter.ExportError, 'Report metadata bound'):
                self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_failed_manifest_file_fsync_never_publishes(self):
        with patch.object(exporter.os, 'fsync', side_effect=OSError('injected fsync failure')):
            with self.assertRaisesRegex(OSError, 'fsync failure'):
                self.run_export()
        self.assertFalse(self.manifest.exists())

    def test_final_parent_recheck_failure_leaves_only_unpublished_document(self):
        original_write = exporter.write_unpublished
        held, decoy = self.base / 'held-audit', self.base / 'decoy-audit'
        decoy.mkdir(mode=0o700)
        def move_after_write(*args):
            result = original_write(*args)
            self.private.rename(held)
            self.private.symlink_to(decoy, target_is_directory=True)
            return result
        try:
            with patch.object(exporter, 'write_unpublished', side_effect=move_after_write):
                with self.assertRaisesRegex(exporter.ExportError, 'public directory path changed'):
                    self.run_export()
            self.assertFalse((held / self.manifest.name).exists())
            self.assertFalse((decoy / self.manifest.name).exists())
            self.assertTrue(any(p.name.startswith('.export-manifest-') for p in held.iterdir()))
        finally:
            if self.private.is_symlink():
                self.private.unlink()
                held.rename(self.private)

    def test_publication_cannot_overwrite_a_racing_final_name(self):
        original_link = os.link
        def racing_final(*args, **kwargs):
            self.manifest.write_text('original competing audit')
            return original_link(*args, **kwargs)
        with patch.object(exporter.os, 'link', side_effect=racing_final):
            with self.assertRaises(FileExistsError):
                self.run_export()
        self.assertEqual(self.manifest.read_text(), 'original competing audit')

    def test_no_required_check_or_durability_operation_after_commit(self):
        original_link, original_validate, original_fsync = os.link, exporter.DirectoryPath.validate, os.fsync
        published = False
        def link(*args, **kwargs):
            nonlocal published
            result = original_link(*args, **kwargs)
            published = True
            return result
        def validate(handle):
            self.assertFalse(published)
            return original_validate(handle)
        def fsync(fd):
            self.assertFalse(published)
            return original_fsync(fd)
        with patch.object(exporter.os, 'link', side_effect=link), \
                patch.object(exporter.DirectoryPath, 'validate', validate), \
                patch.object(exporter.os, 'fsync', side_effect=fsync):
            report = self.run_export()
        self.assertTrue(published)
        self.assertIn('crash durability NOT asserted', report['durability'])

    def test_post_commit_interruption_does_not_authorize_consumer(self):
        original_link = os.link
        def interrupt_after_link(*args, **kwargs):
            original_link(*args, **kwargs)
            raise KeyboardInterrupt('after atomic publication')
        with patch.object(exporter.os, 'link', side_effect=interrupt_after_link), \
                patch.object(exporter, 'verify_manifest') as consumer:
            with self.assertRaises(KeyboardInterrupt):
                self.run_export()  # caller must first obtain successful return/EXIT0
                exporter.verify_manifest(self.source, self.output, self.manifest)
            consumer.assert_not_called()
        self.assertTrue(self.manifest.exists())  # existence alone MUST NOT pass

    def test_consumer_refuses_new_ignored_export_entry_without_opening_it(self):
        self.run_export()
        (self.output / '.env.local').write_text('DO_NOT_READ')
        original_open = os.open
        def guarded_open(name, flags, *args, **kwargs):
            self.assertNotEqual(os.fspath(name), '.env.local')
            return original_open(name, flags, *args, **kwargs)
        with patch.object(exporter.os, 'open', side_effect=guarded_open):
            with self.assertRaisesRegex(exporter.ExportError, 'Unexpected entries'):
                exporter.verify_manifest(self.source, self.output, self.manifest)

    def test_consumer_requires_matching_complete_manifest_and_export(self):
        report = self.run_export()
        self.assertEqual(exporter.verify_manifest(self.source, self.output, self.manifest), report)
        (self.output / 'package.json').write_text('tampered')
        with self.assertRaisesRegex(exporter.ExportError, 'content-mode mismatch'):
            exporter.verify_manifest(self.source, self.output, self.manifest)
        (self.output / 'package.json').write_text('{}\n')
        modified = dict(report, export=str(self.base / 'wrong-export'))
        self.manifest.write_text(json.dumps(modified))
        with self.assertRaisesRegex(exporter.ExportError, 'matching manifest'):
            exporter.verify_manifest(self.source, self.output, self.manifest)
        modified = dict(report, status='incomplete')
        self.manifest.write_text(json.dumps(modified))
        with self.assertRaisesRegex(exporter.ExportError, 'matching manifest'):
            exporter.verify_manifest(self.source, self.output, self.manifest)


if __name__ == '__main__':
    unittest.main()
