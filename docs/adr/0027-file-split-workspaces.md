# File split workspaces and authorized edit ownership

## Decision

Files gains an opt-in, nested split workspace, not an IDE/docking framework or a second chat. A document view may route subsequent cross-file links to one explicitly selected pane. Ordinary links never create panes. One-shot link actions do not change the document's route; closed destinations require a new explicit choice.

Each pane has retained tabs and at most one replaceable routed preview. Keep open preserves a tab, while a split preserves simultaneous visibility. Move/join/reset retain view identities rather than silently coalescing duplicates; explicit closure alone removes a view. New chapters start without a route. Native accessible selects/menus and stable pane numbers suffice for the first delivery; a separate graphical layout map and dragging are not prerequisites.

## Ownership and lifetime

`FileWorkspace` owns file navigation/layout outside `AppShell`; the shell retains chat/session integration and outer expansion. Pure transitions distinguish read-resource context, view identity, groups and open intents. Scroll/mode/history and navigation generations belong to views; paths alone are neither view IDs nor React keys.

The binary split tree computes geometry. File content lives in stable sibling hosts, so moving a view, reshaping splits, projection and focus do not reparent a live viewer. Inactive clean views can unmount after recording reading state; dirty/save owners remain alive. Scroll restoration and jumps wait for a measurable viewport. Terminal hosts remain outside file geometry under their existing lifetime owner; a file split cannot create or restore a PTY.

Explicit navigation updates existing readers rather than changing their host key. Native PDF state is opaque: a repeated page command reloads only the PDF embed, not the file-view host or another renderer's interactive state.

## Authorization and edits

Every read resource captures its originating cwd/source-session. Workspace selection and cached metadata are not authorization, and neither layout changes nor duplicate views union permissions. Keep the centralized path boundary and the reference-only probe restrictions in [ADR 0026](0026-request-and-file-reference-boundaries.md).

A browser-local edit registry permits one owner for each server-derived writable-path identity. This identity names the resolved canonical write destination, not an inode or a content revision: atomic replacement must not change the lock's meaning. It is advisory coordination, not a capability. Read-only occurrences do not inherit a draft or editing permission. Saves still reauthorize and check both the revision and expected writable-path identity, including alias retargeting. Typing during Save remains a draft against the newly saved baseline.

A foreign parked owner opens in Files **without changing the current chat**, as explicitly chosen by the user. A visible context banner and Return to current session Files control distinguish that workspace. Unsaved editors are also reachable directly, without depending on an admissible duplicate or the original session still existing. Reopening does not bypass current file-access checks. Mentions use the receiving chat's context rather than silently changing the composer/session.

## Consequences and scope

Workspaces are parked in browser memory by originating session/cwd; narrow screens project, rather than destroy, the tree. Existing reload warnings and terminal restoration remain, but file layouts/drafts gain no new reload persistence. No content cache, layout dependency, concurrent writers, terminal splits, account-binding changes or Git snapshot semantics are introduced.

Stable-host, source-link, focus, save-race, reference-only and terminal-lifetime browser evidence is necessary; reducer tests alone are insufficient. [Feature contracts](../feature-internals.md) own current behavior, [Architecture](../architecture.md) owns the source map, and [Testing](../testing.md) owns complete Nix acceptance. Integration, host activation and publication remain separate operations.
