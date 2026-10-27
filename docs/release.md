# Brabbler release status

Brabbler is an independently maintained, Pi-based application derived from
[Pi Web](https://github.com/agegr/pi-web). This checkout is not an upstream Pi Web
release and must not publish to upstream's npm package or GitHub repository.

## Current distribution

- Application/package/CLI name: `brabbler`.
- The npm manifest is deliberately `private: true`; no publication destination
  or canonical Brabbler repository URL has been selected.
- The inherited publication script has been removed. Brabbler does not discover
  updates from upstream npm or advertise upstream releases as its own.
- Build the production package only inside an isolated Nix builder. See
  [Testing](testing.md) and the README's Nix installation instructions.
- Package builds, acceptance, local Git integration and service activation are
  different operations. None authorizes publication, a push, a new repository,
  or activation of the installed service.

## Before any future release

Choose and verify the real repository and distribution ownership first. Update
metadata and release/update configuration deliberately, retain original licenses
and attribution, and obtain explicit authorization for each exact remote action.
Do not substitute an assumed URL or reuse upstream publishing credentials.

Verify the exact candidate with full Nix-native core, browser/terminal and genuine
Home Manager deployment acceptance. Inspect the isolated production artifact's
packed inventory: built assets and first-party source must be present; private
state, credentials, tests and writable dependencies must not be packed.

Existing installations need the separately authorized one-time cutover described
in [the breaking rename guide](brabbler-rename.md). No migration, activation or
publication has occurred merely because this source change exists.
