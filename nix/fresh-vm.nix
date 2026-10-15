# Only the declared resource profile varies; package and acceptance definition
# are identical to checks. The regular driver is executed freshly, not built as
# a cached test result.
{ workers, system }:
let
  flake = builtins.getFlake ("path:" + toString ../.);
  acceptance = flake.lib.vmTest.${system} { workers = builtins.fromJSON workers; };
in acceptance.driver
