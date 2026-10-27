{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-CnPk1RQsm9fVyCNTX7qq+2FsZ3AhaCCyxoLj5ub5mH4=";
  fetcherVersion = 2;
}
