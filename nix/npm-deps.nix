{ fetchNpmDeps, src }:
# One pinned npm cache for both the release package and Nix-managed development
# modules. Update this hash when npm manifest/install metadata changes; no network access
# is needed when installing packages from the completed cache derivation.
fetchNpmDeps {
  inherit src;
  hash = "sha256-3QiU7jyLJqH2jAbMSCTs1iuzxDsUs9m0sdbmBTuN5II=";
  fetcherVersion = 2;
}
