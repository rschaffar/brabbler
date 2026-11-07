{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-LqXOQm033EsqJYMu/gStZCS1Zqdx/EX4dCN2fz/L5cs=";
  fetcherVersion = 2;
}
