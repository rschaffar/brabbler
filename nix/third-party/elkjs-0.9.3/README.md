# ELK / elkjs 0.9.3 source materials

This archive supplies editable source, original public inputs, ordered patches,
licenses and build configuration for the ELK engine included through Mermaid.
Normal Brabbler diagram layouts retain ELK; users do not need Java or a source
build to run the application. The assembly helper and authored metadata use the
included `ASSEMBLY-LICENSE.txt` (MIT); upstream sources retain their own terms.

## Source basis and verification

Upstream elkjs **0.9.3** release metadata declares **ELK v0.9.1 plus PR955**.
The elkjs tag and npm gitHead both identify
`a8304cf79fde75bc2ab1a89d28320f53f8637436`; their four generated reference JS
files match byte-for-byte. ELK v0.9.1 identifies
`62d5909f96fad541bc101ad52dabaece6b7eab7e`.

The seven original PR955 content patches are applied in order to that ELK source.
Every patch applies without fuzz, offsets or rejected hunks. The named top-down
layout changes are corroborated in the published worker. Patch order, original
hashes, resulting source-tree hashes and validation records are included.

**Traceability limitation:** upstream does not record the external ELK checkout
used for the manual release build. This source set follows its declared release
lineage; no positive source mismatch or additional change was identified. No
independent upstream build, legal certification or byte-identical regeneration of
JavaScript is claimed. Absence of a separate exhaustive upstream certificate is
not treated as evidence of missing source.

## Contents and licenses

- `sources/elk/`: full ELK v0.9.1 source with the seven PR955 patches applied.
- `sources/elkjs/`: full elkjs 0.9.3 source, including its JS/GWT/additional Java
  code, Gradle configuration and generated references for identification.
- `originals/`: unmodified upstream archives, npm reference, mailbox patch,
  source JARs, POMs and public release/commit metadata.
- `patches/`: seven original content patches; concatenation recreates the
  original mailbox. PR merge commits are not invented as extra content changes.
- `notices/`: full original ELK/elkjs EPL-2.0 notices, ELK NOTICE, EPL-1.0,
  Apache-2.0, GWT COPYING/about text and an attribution index.
- `MANIFEST.json`, `ORIGINALS.sha256`, `TREE-SHA256SUMS`, `provenance/`: identities,
  original URLs/hashes, patch order and checks of the assembled materials.

Original source JARs preserve headers and provide these runtime sources:

| Component | Version | License basis |
| --- | --- | --- |
| EMF-GWT common/ecore | 2.12.4 | EPL-1.0 |
| Xbase/Xtend libraries | 2.28.0 | EPL-2.0 |
| GWT user | 2.10.0 | Apache and original additional notices |
| Guava | 31.1-jre | Apache and original additional notices |

The broader upstream ELK/GWT notice catalogs are preserved without asserting
that every component they mention is part of this generated engine. Brabbler's
own MIT license does not replace these third-party licenses.

## Reassemble the source archive offline

With Python 3 and GNU-compatible `patch`, choose previously nonexistent paths
outside this extracted package:

```sh
python3 assemble.py --output ../reassembled-source \
  --archive ../elkjs-0.9.3-source-materials.tar.gz
```

The recipe verifies original hashes, patch order, exact patch application and
expanded source-tree hashes. It does not contact a network, run Git, execute
upstream programs or compile anything. Tar ordering, ownership, modes and
compressed timestamps are normalized. Original archives retain upstream modes;
expanded regular files use mode 0644, so a later build may need to restore an
executable bit or invoke a script's interpreter explicitly.

## Building is separate from source access

Original build scripts expect sibling `elk`/`elkjs` directories, provided under
`sources/`. They select Gradle 7.2, permit Java 8–17 and pin the runtime library
versions above. The `0.10.0-SNAPSHOT` meta-language compiler is a build tool, not
the ELK engine version. This source archive is not a complete offline compiler or
a promise that all historical remote build tools remain available.
