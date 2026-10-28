{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-IiL59QSkGC2gA8z30sDHFwMP7EhpQykMLS0tqG0yTqs=";
  fetcherVersion = 2;
}
