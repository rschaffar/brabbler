# Temporary Node 24 security update for the pinned Nixpkgs recipe.
# Reassess/remove when Nixpkgs supplies this release and the shared Brotli fix.
# Fail on a changed base rather than silently downgrading or duplicating patches.
_final: prev:
let
  inherit (prev) lib;
  brotliFixed = prev.brotli.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [
      (prev.fetchurl {
        url = "https://github.com/google/brotli/commit/0ed4268a4401abcb4472096340477cf4af7d1a2b.patch?full_index=1";
        hash = "sha256-1vliUJAAIj3vcGKVgim9CEV+XgMuftDR2U+3kLBUsfw=";
      })
    ];
  });
  # Re-enter the same version-sensitive builder and Darwin compiler selection.
  # nodejs_24 itself is a symlink join: overriding only its src is insufficient.
  buildNodejs = prev.callPackage
    (prev.path + "/pkgs/development/web/nodejs/nodejs.nix")
    ({
      python = prev.python3;
      brotli = brotliFixed;
    } // lib.optionalAttrs prev.stdenv.hostPlatform.isDarwin {
      stdenv = prev.buildPackages.llvmPackages_20.libcxxStdenv;
    });
  nodejsSlim = buildNodejs {
    version = "24.22.2";
    # Official node-v24.22.2.tar.xz SHA-256, not a platform binary.
    sha256 = "8fe2ec1723bb9f8d0b683907c82708debbeda64af21cb2aa214c4241eed0a061";
    # Preserve Nix/platform patches; only the FreeBSD-cross SmallVector patch
    # is already upstream. Brabbler declares native Linux/Darwin systems only.
    patches = builtins.filter
      (patch: !(lib.hasSuffix "v8-no-assert-trivially-copyable.patch"
        (builtins.baseNameOf (toString patch))))
      prev.nodejs-slim_24.patches;
  };
in
assert lib.assertMsg (prev.nodejs-slim_24.version == "24.21.0")
  "Reassess the temporary Node 24 recipe after the Nixpkgs runtime changes";
assert lib.assertMsg (prev.brotli.version == "1.2.0")
  "Reassess the temporary Node 24 Brotli patch after its base changes";
{
  nodejs_24 = prev.nodejs_24.override { nodejs-slim = nodejsSlim; };
}
