{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when package-lock.json changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-aisB8fNKTGvI1jLFdR/HZJqEF8b/3gCc1ruIGjOs2n0=";
  fetcherVersion = 2;
}
