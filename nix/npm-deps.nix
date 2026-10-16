{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when package-lock.json changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-r9FWZIBzE7Ik6WS8wNO0zp4wkeBxO7boDqTZ7whTNf8=";
  fetcherVersion = 2;
}
