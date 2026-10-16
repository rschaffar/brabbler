# No group: realize immutable prerequisites. A group: execute its actual capsule
# with an invocation nonce, not a wrapper around an already cached test verdict.
{ system, group ? "", runId ? "", sourceDigest ? "", hostNamespaces ? "{}" }:
let
  flake = builtins.getFlake ("path:" + toString ../.);
in
if group == "" then flake.lib.browserSupport.${system}
else flake.lib.browserCapsule.${system} {
  inherit group runId sourceDigest;
  hostNamespaces = builtins.fromJSON hostNamespaces;
}
