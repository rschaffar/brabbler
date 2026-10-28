# ELK source availability

The ELK/elkjs and Xbase/Xtend sources incorporated through Mermaid are available
under their included **EPL-2.0** terms. Incorporated EMF-GWT common/ecore sources
retain **EPL-1.0** terms. Original copyright, Apache and additional applicable
notices are preserved in the source material.

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

- Full ELK v0.9.1 source plus the seven original PR955 content patches, applied
  in order without fuzz or offsets.
- Full elkjs 0.9.3 source: editable JS/GWT/additional Java files and original
  build configuration, alongside generated JS reference files for identification.
- Unchanged runtime source JARs for EMF-GWT common/ecore 2.12.4 and Xbase/Xtend
  2.28.0, plus GWT 2.10.0 / Guava 31.1-jre sources and original legal material.
- Public upstream release metadata, exact input hashes, patch order, source-tree
  hashes, original source/patch copyrights and an offline archive assembly recipe.

The source basis is **upstream elkjs 0.9.3's declared ELK v0.9.1 + PR955 lineage**.
The tag/npm generated references and the named patch changes were checked.
Upstream did not record the external ELK checkout used for its manual release;
no positive source mismatch or additional change was identified. No independent
upstream build, legal certification or byte-identical JS regeneration is claimed.
The source archive's README and manifest preserve this traceability limitation.

This does not change Brabbler's own MIT license or the normal installation path.
Users do not need Java, these sources or a compiler to run the prebuilt app.
