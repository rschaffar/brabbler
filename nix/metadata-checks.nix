# Pure evaluation regression, used by both cacheable and fresh core checks.
# Exercise the actual recipes, replacing only derivation construction so metadata
# can be observed independently of build inputs. Even a warm store cannot hide an
# accidental dependency on the filtered source: demanding it throws explicitly.
{ pkgs }:
let
  manifest = { name = "synthetic-metadata-package"; version = "7.8.9-metadata-test"; };
  src = throw "Filtered source must not be demanded to evaluate package metadata";
  stdenv = pkgs.stdenv // { mkDerivation = attrs: attrs; };
  package = pkgs.callPackage ./package.nix {
    inherit src manifest stdenv;
    nodejs = pkgs.nodejs_24;
    modules = null;
    thirdPartySources = null;
  };
  modules = import ./modules.nix {
    inherit src manifest;
    pkgs = pkgs // { inherit stdenv; };
    nodejs = pkgs.nodejs_24;
  };
  metadataOK = label: value:
    let result = builtins.tryEval value;
    in
    assert pkgs.lib.assertMsg result.success
      "${label}: metadata evaluation demanded filtered build inputs";
    assert pkgs.lib.assertMsg (result.value == manifest.version)
      "${label}: metadata did not use the supplied manifest version";
    true;
in
assert metadataOK "application" package.version;
assert metadataOK "runtime modules" modules.version;
true
