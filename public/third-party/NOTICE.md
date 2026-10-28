# Brabbler — licenses and third-party notices

Brabbler's own code is [MIT-licensed](licenses/brabbler-MIT.txt), retaining the
original agegr attribution. Independently licensed dependencies, incorporated
code and assets retain their own terms; the first-party MIT license does not
replace them.

## Incorporated code

| Component | Notice / license |
| --- | --- |
| Next.js, copyright Vercel | [MIT](licenses/next-MIT.txt) |
| React, ReactDOM, React Server Components and Scheduler, copyright Meta Platforms, Inc. and affiliates | [MIT](licenses/react-family-MIT.txt) |
| Core-js, copyright Denis Pushkarev | [MIT](licenses/core-js-MIT.txt) |
| Babel runtime helpers | [MIT](licenses/babel-runtime-MIT.txt) |
| Buffer implementation | [MIT](licenses/buffer-MIT.txt) |
| Webpack runtime | [MIT](licenses/webpack-MIT.txt) |
| OpenTelemetry API, copyright The OpenTelemetry Authors | [Apache-2.0](licenses/Apache-2.0.txt) |
| ELK / elkjs, itemis and contributors; Xbase/Xtend runtime | [EPL-2.0](licenses/elkjs-EPL-2.0.txt) and original per-file source notices |
| Incorporated EMF-GWT common/ecore runtime, IBM and contributors | [EPL-1.0](licenses/EPL-1.0.txt) and original per-file source notices |
| Incorporated ask-user implementation | [Original MIT notice](licenses/ask-user-MIT.txt) |
| Incorporated Git graph layout | [Original MIT notice](licenses/git-graph-layout-MIT.txt) |
| Incorporated provider-usage implementation | [Original MIT notice](licenses/provider-usage-MIT.txt) |

For dual-license choices, this distribution uses **MIT for JSZip** and
**Apache-2.0 for DOMPurify**. Pako's MIT **and** Zlib notices both apply; preserve
Argparse's applicable Python/PSF text rather than relying only on old lock labels.

Original full legal texts and attributions are preserved, including the author
and copyright details in each linked notice. The installed build additionally
contains `DEPENDENCIES.json` and `dependency-licenses/`: original legal text
collected from the pinned build dependency tree, including Next's vendored
components. That collection may include packages not copied into runtime output;
it is not a declaration that every listed dependency is bundled. Packages fetched
by the recipient's npm installation also retain their upstream legal files.

## Corresponding ELK sources

Editable Java/JS sources, original patches, runtime source JARs, build
configuration and notices are supplied as a separate accompanying release asset.
See [source availability](SOURCE-AVAILABILITY.md). The installed build's
`SOURCE-AVAILABILITY.json` records the versioned filename, locator and SHA-256.
This is a source-access statement, not a requirement for application users to
install Java or compile anything. ELK remains enabled for normal Mermaid layouts.

## Fonts and icons

- [Font sources and licenses](../fonts/README.md), including Noto Sans Mono,
  JetBrains Mono Nerd Font and the original glyph-set [legal texts](../fonts/licenses/README.md).
- Catppuccin file icons retain their original [MIT license](../icons/catppuccin/LICENSE).

These notices are shipped in the application archive and served under
`/third-party/`. The application document advertises this notice via a
`rel="license"` link. No notice here grants rights to separately protected marks.
