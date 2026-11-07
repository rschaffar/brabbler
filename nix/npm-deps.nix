{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-KBWBS4Kjo6ixomt7byeZb4PU5rfIE9lBEdjY0QW7zDM=";
  fetcherVersion = 2;
}
