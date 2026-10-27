# No group: original immutable prerequisites. A group: original capsule factory.
# Private definitionGroups mode publishes selected definitions, NEVER their outputs.
{ system, group ? "", runId ? "", sourceDigest ? "", hostNamespaces ? "{}",
  definitionGroups ? "" }:
let
  b = builtins;
  flake = b.getFlake ("path:" + toString ../.);
  # An explicit constant pinned-source reference in the publisher's payload.
  source = b.storePath (toString ../.);
  support = flake.lib.browserSupport.${system};
  plain = b.unsafeDiscardStringContext;
  unique = values: b.length (b.attrNames (b.listToAttrs
    (map (value: { name = value; inherit value; }) values))) == b.length values;
  selected = b.fromJSON definitionGroups;
  namespaces = b.fromJSON hostNamespaces;
  knownGroups = b.attrNames (b.fromJSON (b.readFile ./e2e-groups.json));
  namespaceOK = name: b.isString namespaces.${name}
    && b.match (name + ":[[][0-9]+[]]") namespaces.${name} != null;
  inputsOK = group == ""
    && b.elem system [ "x86_64-linux" "aarch64-linux" ]
    && b.match "/nix/store/[a-z0-9]{32}-[^/]+" source != null
    && b.match "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}" runId != null
    && (sourceDigest == "" || b.match "[a-f0-9]{64}" sourceDigest != null)
    && b.isAttrs namespaces && b.attrNames namespaces == [ "mnt" "net" "pid" ]
    && b.all namespaceOK [ "mnt" "net" "pid" ]
    && b.isList selected && selected != [ ] && b.all b.isString selected
    && unique selected && b.all (name: b.elem name knownGroups) selected;
  entry = group:
    let
      # Keep this factory and ALL fresh bindings identical to the direct mode.
      capsule = flake.lib.browserCapsule.${system} {
        inherit group runId sourceDigest;
        hostNamespaces = namespaces;
      };
      # Constant .drv reference, NOT allOutputs or an output dependency.
      drvPath = b.unsafeDiscardOutputDependency capsule.drvPath;
      # Identity data only. An outPath KEY would make toJSON coerce the object.
      expectedOutputPath = plain capsule.outPath;
      expectedContext = b.listToAttrs [ { name = plain capsule.drvPath; value = { path = true; }; } ];
    in
    assert b.getContext drvPath == expectedContext;
    assert b.getContext expectedOutputPath == { };
    { inherit drvPath expectedOutputPath; outputName = "out"; };
  definitions = b.listToAttrs (map (name: { inherit name; value = entry name; }) selected);
  payload = b.toJSON {
    version = 1;
    kind = "fresh-capsule-definitions";
    backend = "nix-build-sandbox";
    executionEvidence = false;
    inherit source system runId sourceDigest selected definitions;
    hostNamespaces = namespaces;
    supportOutPath = toString support;
  };
  # Inspect a context-free COPY only; publish the ORIGINAL contextful payload.
  decoded = b.fromJSON (plain payload);
  expectedPayloadContext = b.foldl' (acc: name:
    acc // b.getContext definitions.${name}.drvPath)
    (b.getContext source // b.getContext (toString support)) selected;
  shapeOK = b.all (name:
    b.isAttrs decoded.definitions.${name}
    && b.attrNames decoded.definitions.${name} == [ "drvPath" "expectedOutputPath" "outputName" ]
    && decoded.definitions.${name}.drvPath == plain definitions.${name}.drvPath
    && decoded.definitions.${name}.expectedOutputPath == definitions.${name}.expectedOutputPath
    && decoded.definitions.${name}.outputName == "out") selected;
  pkgs = import flake.inputs.nixpkgs { inherit system; };
  manifest =
    assert b ? unsafeDiscardOutputDependency;
    assert inputsOK;
    assert b.getContext payload == expectedPayloadContext;
    assert shapeOK;
    pkgs.runCommand "brabbler-browser-definition-manifest" {
      inherit runId;
      preferLocalBuild = true;
      allowSubstitutes = false;
      inherit payload;
      passAsFile = [ "payload" ];
    } ''
      set -euo pipefail
      umask 077
      test -d ${support}
      mkdir -m 700 "$out"
      cp "$payloadPath" "$out/manifest.json"
    '';
in
if definitionGroups != "" then manifest
else if group == "" then support
else flake.lib.browserCapsule.${system} {
  inherit group runId sourceDigest;
  hostNamespaces = b.fromJSON hostNamespaces;
}
