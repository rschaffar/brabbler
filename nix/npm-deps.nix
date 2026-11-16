{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-SBs2MR+5WR1sJed49dYW6vrA3ERq1vhaRo4dXx9gvfU=";
  fetcherVersion = 2;
}
