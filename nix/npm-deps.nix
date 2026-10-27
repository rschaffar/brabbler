{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-e2Z1YAcy5rvQ9MEDQuttF25yl83jgQctoSnZCIxPzM0=";
  fetcherVersion = 2;
}
