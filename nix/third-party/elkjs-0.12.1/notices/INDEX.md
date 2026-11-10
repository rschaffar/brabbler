# Source-material notices

Preserve original legal files and per-file copyright/license headers. These
materials are not relicensed as one MIT or Eclipse-only work.

- `EPL-2.0.txt`: original ELK v0.12.1 LICENSE.md, including secondary-license text.
- `ELK-NOTICE.md`, `ELK-DEPENDENCIES.txt`: original project notice/catalog.
- `elkjs-LICENSE.md`: original elkjs 0.12.1 full license/secondary-license text.
- `EPL-1.0.txt`: full legal text for the EMF-GWT common/ecore source headers.
- `Apache-2.0.txt`: original Guava COPYING.
- `GWT-COPYING.txt`, `GWT-about.txt`: original GWT 2.13.0 distribution notices.
- `*.jar.about.html`: original legal notices from the Xbase/Xtend GWT adapters.

ELK/elkjs now declare `EPL-2.0 OR GPL-3.0-or-later`; Brabbler continues using
EPL-2.0. Keep upstream secondary-license notices rather than deleting/rewording
them. This choice does not change EMF-GWT 2.12.4's EPL-1.0 source headers or
Xbase/Xtend 2.36.0's EPL-2.0 headers.

Original runtime source JARs and source-bearing GWT artifact JARs retain all their
embedded notices and source headers. GWT and Guava include Apache and additional
per-file terms. Their source inclusion is useful context, not a claim that
Apache generally requires publishing source for executable redistribution.

The ELK project catalog includes broader-project/native dependencies (including
libavoid) that are not in elkjs build.gradle's selected source set. Preserving
that catalog does not establish their presence in the browser worker. Actual
redistributed artifacts and any native Nix closure still require separate review.

Input provenance and checksums are recorded in MANIFEST.json. No upstream code,
compiler, downloaded JAR or build was executed for this research or by the
proposed archive assembly recipe.
