# Prebuilt application archive (without Nix)

Brabbler 0.1.0 is being prepared; no release artifact is published merely because
these instructions exist. [Release status](release.md) owns tested candidates,
platform evidence and remaining gates.

## Requirements

- Node.js 24 or newer and npm; the tested baseline is Node 24.21.0.
- Git, `tar`, and a Unix shell on Linux/macOS.
- Internet access to install the locked npm dependencies. Native dependencies may
  need Python and a compiler if a compatible prebuilt binary is unavailable;
  macOS may need Apple's command-line developer tools.

The archive already contains the production UI/server. **No Next.js application
build or Nix installation is needed on the user's machine.** npm installs runtime
libraries and platform-specific native modules, not a new application bundle.
Support is limited to the actual OS/architectures listed in the release evidence.

## Install into its own directory

Obtain the archive and its SHA-256 from the approved release. Verify the checksum
before extraction (`sha256sum` on Linux, `shasum -a 256` on macOS).

```sh
mkdir brabbler-0.1.0
# Use an empty directory; do not overwrite a running installation.
tar -xzf brabbler-0.1.0.tgz -C brabbler-0.1.0 --strip-components=1
cd brabbler-0.1.0
npm ci --omit=dev
./bin/brabbler.js auth setup
./bin/brabbler.js
```

Run `npm ci` **inside the extracted application directory**, not another npm
project. This preserves Brabbler's lock/overrides and exclusive ownership of its
dependency tree. The archive is a standalone prebuilt application, not a package
intended for installation as a dependency. Do not omit lifecycle scripts: they
apply and verify the pinned SDK policy. Startup checks read-only and refuses an
unknown/unpatched installation instead of repairing it.

Open `http://127.0.0.1:30141`. Authentication is required by default; password
setup is local, hidden and confirmed. See [authentication and remote access](../README.md#local-password-setup)
for storage, replacement, explicit no-auth mode and HTTPS requirements.

This Brabbler-owned SDK installation deliberately excludes the standalone Pi CLI
and bundled RPC entry points. The embedded modular SDK remains available. A
separate Pi CLI installation is unaffected. Do not share this dependency directory
with other applications or use it as their SDK/CLI installation.

## Update and recovery

Extract a new verified release into a new directory, install its locked runtime
dependencies, stop the old owned launcher and start the new one. Sessions,
credentials and preferences remain in the separately configured agent directory;
back them up privately before an upgrade. Never remove agent data to update the
application or to bypass a damaged installation.

If dependency installation is interrupted, preserve diagnostics and start with a
fresh application directory. The exact-byte SDK policy refuses unknown or partial
exclusion states; it never guesses which shared dependency files are disposable.
Native-module failures need diagnosis for that OS/Node combination, not a copy of
another machine's `node_modules`.

## Additional artifact verification

Maintainers build the archive only in an isolated Nix builder via
`brabbler-tarball`, then run `node nix/portable-smoke.mjs ARCHIVE SHA256` from the
source checkout on ordinary Linux/macOS Node. The script extracts a fresh copy,
uses isolated synthetic state, runs the same root `npm ci`, and verifies setup,
login, terminal I/O, restart, rotation and explicit bypass boundaries. It does not
replace full Nix acceptance, build the application, or use operator credentials.
The manual-only hosted workflow performs no deployment or publication. Remote
execution needs its own approval; do not upload unsanitized history to enable CI.
