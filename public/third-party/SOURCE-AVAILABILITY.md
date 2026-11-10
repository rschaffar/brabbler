# ELK source availability

ELK/elkjs advertise **EPL-2.0 OR GPL-3.0-or-later**; this distribution follows
the EPL-2.0 option and preserves the secondary-license notices. Incorporated
Xbase/Xtend sources retain EPL-2.0, and EMF-GWT common/ecore retain EPL-1.0.
Original copyright, Apache and additional applicable notices remain included.

## Obtain the sources

The matching source archive accompanies the application archive on the same
[Brabbler release](https://github.com/rschaffar/brabbler/releases). Its exact
versioned filename, download URL and SHA-256 are recorded in the installed
build's adjacent `SOURCE-AVAILABILITY.json`. Verify that checksum before use.
Publication must provide this separate source asset, not only the application.
The main application download does not contain the large source archive.

Nix package recipients also have offline access through
`share/brabbler/third-party-sources/` in the installed package output. Maintainers
can build the source output independently with `nix build .#brabbler-sources`.

## What is supplied

- Full ELK v0.12.1 source at commit
  `3aa3b9fb98d8f9a41285b3061cff5efe79ed2ba4`, with no downstream patches.
- Full elkjs 0.12.1 source at commit
  `624ae90aa37110033a8af59c5ccbb292708b4317`: editable Java/JS/Xtend/GWT files,
  original build configuration and generated JS references for identification.
- Unchanged source JARs for EMF-GWT common/ecore 2.12.4 and Xbase/Xtend 2.36.0,
  GWT 2.13.0 / Guava 31.1-jre sources, source-bearing GWT adapter artifacts and
  original legal material. Assembly never executes the JARs or upstream code.
- Public release/publishing metadata, exact input and editable-tree hashes, and
  a deterministic offline archive assembly recipe.

The source basis is **upstream elkjs 0.12.1's declared ELK v0.12.1 release**.
All twelve published npm files match the elkjs release commit byte-for-byte.
Publishing provenance identifies that commit, not the external ELK compilation
checkout or resolved mutable Gradle snapshot inputs used to generate the worker.
No exhaustive generated-code/source mapping, independent upstream build,
attestation-signature verification, legal certification or byte-identical JS
regeneration is claimed. The source README and manifest preserve these limits.
The old ELK 0.9.1 + PR955 materials are not this release's source asset.

This does not change Brabbler's own MIT license or the normal installation path.
Users do not need Java, these sources or a compiler to run the prebuilt app.
