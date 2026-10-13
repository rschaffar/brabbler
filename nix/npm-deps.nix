{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when package-lock.json changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-qhOht7PrK8KtnxNX7J1fvQjdvNiMcC6C4imgi31WQHE=";
  fetcherVersion = 2;
}
