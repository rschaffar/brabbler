{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when package-lock.json changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-VD90JIBBlOTGirfPF/OKSvhT9uOKYk60rSM8+pCyKxg=";
  fetcherVersion = 2;
}
