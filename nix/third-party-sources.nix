{ lib, runCommand, fetchurl, python3, version }:
let
  seed = ./third-party/elkjs-0.12.1;
  manifest = builtins.fromJSON (builtins.readFile (seed + "/MANIFEST.json"));
  filename = "brabbler-${version}-third-party-sources.tar.gz";
  inputPath = input:
    let local = seed + "/${input.file}";
    in if builtins.pathExists local then "${local}" else fetchurl {
      name = builtins.baseNameOf input.file;
      url = input.url;
      sha256 = input.sha256;
    };
  sourceInfo = builtins.toJSON {
    schemaVersion = 1;
    applicationVersion = version;
    archive = filename;
    url = "https://github.com/rschaffar/brabbler/releases/download/v${version}/${filename}";
    sourceBasis = manifest.source_basis;
    traceabilityLimitation = manifest.traceability_limitation;
    components = manifest.components;
  };
in runCommand "brabbler-${version}-third-party-sources" {
  nativeBuildInputs = [ python3 ];
} ''
  mkdir -p seed/originals "$out"
  cp -R ${seed}/. seed/
  chmod -R u+w seed
  ${lib.concatMapStringsSep "\n" (input: ''
    cp ${lib.escapeShellArg (toString (inputPath input))} ${lib.escapeShellArg "seed/${input.file}"}
  '') manifest.inputs}
  python3 seed/assemble.py --output assembled --archive "$out/${filename}" > "$out/assembly.json"
  # Consumers get an exact checksum/locator, never a build-host filesystem path.
  python3 - "$out" <<'PY'
  import hashlib, json, pathlib, sys
  output = pathlib.Path(sys.argv[1])
  info = json.loads(${builtins.toJSON sourceInfo})
  archive = output / info['archive']
  info['sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
  (output / 'SOURCE-AVAILABILITY.json').write_text(json.dumps(info, indent=2) + '\n')
  (output / 'SHA256SUMS').write_text(info['sha256'] + '  ' + info['archive'] + '\n')
  PY
''
