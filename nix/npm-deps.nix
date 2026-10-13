{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when package-lock.json changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-YdUVGeGZJJiqpGykVCygPM6Y9n8M6QHYFtBSwyh+Yl4=";
  fetcherVersion = 2;
}
