# Brabbler: breaking rename and later cutover

Brabbler is still based on Pi. Pi SDK/CLI packages, native session storage,
`.pi/` directories, `PI_CODING_AGENT_DIR`, and Pi's own settings/models/auth
interfaces have not been renamed. Brabbler's separate [robot mascot](branding.md)
replaces the inherited application icon; it does not rename native Pi resources.

The application has a clean new identity, without legacy aliases or fallback
readers. Do not activate it over existing data until the separate one-time
migration is prepared, backed up, reviewed and explicitly authorized.

## Current names

| Surface | Previous application name | Brabbler name |
| --- | --- | --- |
| npm package | `@agegr/pi-web` | `brabbler` (private/unpublished) |
| Launcher / Nix package and app | `pi-web` | `brabbler` |
| Home Manager option / user unit | `services.pi-web` / `pi-web.service` | `services.brabbler` / `brabbler.service` |
| Application environment | `PI_WEB_*`, `PI_DESK_SSH_RUNTIME` | `BRABBLER_*`, `BRABBLER_SSH_RUNTIME` |
| Source inspection tool | `pi_web_source` | `brabbler_source` |
| Application state directory | `.pi/agent/pi-web/` | `.pi/agent/brabbler/` |
| Application files beside that directory | `pi-web-accounts.json`, `pi-web-session-index.json`, etc. | `brabbler-accounts.json`, `brabbler-session-index.json`, etc. |
| Git trust/native-resource identity markers | `.git/pi-web-*` | `.git/brabbler-*` |
| Session metadata and structured harness contracts | `pi-web:*` | `brabbler:*` |
| Browser preference/event/cache namespaces | `pi-web*` and application-owned `pi-*` keys | `brabbler*` |
| Authored review/notebook fences | `pi-review`, `pi-notebook`, `pi-step`, `pi-question`, `pi-evidence` | Corresponding `brabbler-*` fences |
| Inline question preferences | `PI_ASK_USER_*` | `BRABBLER_ASK_USER_*` |
| Newly generated scratch workspaces | `~/pi-cwd-<date>` | `~/brabbler-cwd-<date>` (existing directories are not moved) |

The account file contains credentials: never include its contents in logs, issue
reports, source commits or ordinary documentation. Existing native Pi session
files still load, but their application-specific metadata needs deliberate
migration to retain archive/account/policy/interaction behavior.

## Separate one-time migration

The migration is intentionally **not a maintained feature or a tool committed to
this repository**. A disposable script/worktree can be prepared later against an
explicit frozen inventory. This source rename neither implements nor executes it.

The cutover must account for:

- Application-owned settings/account/state files and nested stores, preserving
  file permissions and references to application-owned stored artifacts.
- Pi session custom metadata, typed interaction/operation receipts, subagent
  relations and saved policies. Translate recognized application-owned schema
  fields only; preserve user/assistant text, opaque tool output, project cwd/path
  identities, credential values and historical evidence.
- Repository-local trust/native-resource markers, without inventing or widening
  permissions or replacing a different repository's identity.
- Browser-local/session storage on the existing origin, including drafts and
  browser-SSH enrollment/recovery hints. Server filesystem migration cannot
  access these browser stores; handle each browser separately. Do not change the
  WebAuthn origin/RP identity merely to rename labels.
- Consuming service configuration, environment files, package paths and global
  agent instructions recognizing the new `brabbler:git-policy/v1` contract.
- Old installed PWA/service-worker caches and any old service identity, with a
  deliberate cutover rather than two processes writing the same state.

Stop relevant writers before the migration, keep complete private backups, refuse
ambiguous collisions/partial destinations, and verify the resulting account
bindings, saved policies, session relations and browser state before activation.
Never perform a generic textual replacement over credentials or JSONL histories.
Rollback means restoring the matching old application and its backed-up state;
do not run both identities concurrently or pretend unknown partial effects were
rolled back.

The existing deployment URL `https://deployment.example.invalid` is
unchanged. DNS, TLS, origin and the separate NixOS consumer configuration will be
adapted in later explicitly scoped work. The rename itself changes none of them.

## Publication and provenance

No canonical Brabbler repository URL is configured yet. The package is private,
inherited publication/update targeting is disabled, and Web Push requires an
operator-supplied `BRABBLER_PUSH_SUBJECT` contact URL. Pi Web links remain where
they credit the original project, not as Brabbler release destinations.

Secret/source-export denylists deliberately continue rejecting old sensitive filenames and generated private directories. This is a security exclusion, not a legacy data reader or migration feature.

Historical plans, decision records, captured screenshots, immutable source/store
identities and acceptance receipts retain their original names. They are not
new Brabbler acceptance evidence. Current maintained guides and test inventories
use the new application interfaces; this guide records the deliberate break.
