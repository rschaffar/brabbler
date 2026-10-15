# A nonce changes only the test derivation, never dependencies or the package.
{ runId, selection, system }:
let
  flake = builtins.getFlake ("path:" + toString ../.);
in
flake.lib.coreCheck.${system} {
  inherit runId;
  args = builtins.fromJSON selection;
}
