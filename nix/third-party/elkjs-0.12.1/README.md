# ELK / elkjs 0.12.1 source materials

This seed supplies the new release's source materials, not a relabeling of the
0.9.3 payload. Original source archives and runtime inputs are pinned by hash;
source-tree hashes were computed directly from archive members and are verified
during offline assembly.

## Source basis

The upstream elkjs 0.12.1 release says “Based on ELK 0.12.1”. Its tag, npm
gitHead and decoded npm publishing provenance identify elkjs commit
`624ae90aa37110033a8af59c5ccbb292708b4317`. All 12 published npm files, including
generated JS, declarations, package metadata and license, match that commit's
source archive byte-for-byte. The npm tarball's SHA-512 matches the registry SRI.

ELK tag v0.12.1 identifies commit
`3aa3b9fb98d8f9a41285b3061cff5efe79ed2ba4`. The full source archive is preserved
at that immutable commit. No downstream ELK source patches are applied. The old
ELK 0.9.1 + seven PR955 patches are not inputs to this release's source asset.

## What is supplied

- `sources/elk`: the complete declared ELK v0.12.1 source tree.
- `sources/elkjs`: the complete elkjs release source tree, including editable
  Java/JS/Xtend, GWT modules, build files and generated reference JS.
- `originals`: original source archives, unchanged Maven source JARs, POMs,
  source-bearing GWT adapter artifacts, npm references and upstream metadata.
- `notices`: original legal material, including EPL secondary-license notices.
- `provenance`: static npm/tag identity report and decoded publishing statements.
- `MANIFEST.json`: input URLs, SHA-256 and lengths, exact commit identities,
  components, source-tree hash algorithm/results and traceability limits.

The wrapper's declared inputs are EMF-GWT common/ecore 2.12.4, Xbase/Xtend
2.36.0, GWT 2.13.0 and Guava 31.1-jre. The GWT variants of Xbase/Xtend contain
editable Java and super-sources (not just module XML, despite a build comment).
They, guava-gwt and gwt-user's source-bearing artifact are preserved in addition
to source JARs. These `.jar` files are containers; no JAR is executed in assembly.

## Traceability limits

Publishing provenance identifies the elkjs publishing commit, not the earlier
compilation of the checked-in worker. The publish workflow checks out the tag
and runs `npm publish`; it neither checks out ELK nor builds it. The separate CI
build workflow uses ELK `master`, not an immutable release checkout. Neither
establishes the external ELK checkout used for the generated release worker.

The release declaration is the basis for selecting ELK v0.12.1, not independent
proof of exact compiler inputs. There is no exhaustive generated-code/source
mapping, independent upstream compilation or byte-identical JS regeneration.
Decoded attestation statements were inspected, not cryptographically verified.

The original build still requests the mutable metadata compiler
`0.13.0-SNAPSHOT`, uses jcenter and a snapshot repository, and resolves build
plugins/transitives without a preserved Gradle dependency lock. Java guard and
comment disagree at the lower bound (guard accepts 8; GWT comment says 11;
CI uses 17). This archive is source availability and build configuration, not
a fully mirrored, executable or independently reproducible upstream toolchain.

## Offline assembly

Populate every `MANIFEST.json` input under `originals/` from its pinned URL and
verify its SHA-256 and length.
Small metadata/POM/legal inputs are included in the seed so mutable API responses
never have to be fetched again. Nix fetches the large fixed-version/commit
archives; checked-in binaries are unnecessary.

Then, outside the seed directory:

```
python3 assemble.py --output ../assembled-source \
  --archive ../elkjs-0.12.1-source-materials.tar.gz
```

The recipe refuses existing outputs and any nonempty patch series, verifies all
input and source-tree hashes, preserves originals, emits a complete file hash
listing and writes a deterministic archive. It executes no upstream code and
needs Python only, not patch, Java, Gradle, Node, network or Git. Original archive
permissions remain inside the original tarballs; normalized editable trees have
regular files mode 0644 (set a build script executable when using it).

## Licenses

ELK/elkjs advertise `EPL-2.0 OR GPL-3.0-or-later`. This distribution continues on
the EPL-2.0 path and preserves the secondary-license notices, without applying
that wrapper expression to independently licensed incorporated runtime code.
EMF-GWT sources retain EPL-1.0, Xbase/Xtend EPL-2.0, and GWT/Guava original
Apache/additional notices. No legal certification or complete dependency/native
closure audit is claimed. See `notices/INDEX.md`.
