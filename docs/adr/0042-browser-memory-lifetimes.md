# Browser-owned memory lifetimes

## Decision

Browser retention follows useful ownership rather than the lifetime of the tab. Persisted transcripts, authorized edits and terminal processes keep their existing durable owners. A browser cache or saved layout does not confer access or require keeping every renderer alive.

### Reader-aware transcript retention

At the live end, retain a soft recent-history window, preserving unresolved work and complete call/result dependencies. Older data remains reloadable through stable exclusive history cursors. Deliberately loaded scrollback and messages arriving while the user reads it remain in memory until the reader returns to the live end; there is no separate Older/Newer paging interface. Canonical recovery must fill missed output without replacing that reader window or duplicating concurrent additions.

This trades a hard tab-memory bound for reader continuity. An indivisible payload/dependency group or unresolved work may exceed the targets. Releasing older browser objects never deletes persisted history or moves their bodies to another unbounded client cache. Current targets, projections and recovery rules belong to [Session contracts](../session-internals.md).

### Separate reading/edit ownership from preview execution

Preserve [ADR 0027](0027-file-split-workspaces.md)'s stable view identities, navigation state and dirty/saving edit owners. A draft that returns to its authoritative baseline is clean and must not pin an inactive reader. A stale baseline or ambiguous Save outcome remains dirty until authoritative resolution or explicit discard, even when its bytes equal an earlier baseline.

Hidden or document-backgrounded image/audio/video/PDF execution and decoding resources may be disposed independently of the selected file reader. Hidden HTML execution frames are destroyed while the text-reader and navigation owner remain. Revealing recreates native previews; in-preview script/form state and opaque native playback/view state are not retained. Visible layout changes still preserve the execution instance. This narrows interactive-state preservation to visible previews; it does not discard unsaved text edits. Standalone HTML keeps its opaque `sandbox="allow-scripts"` boundary. Terminal ownership is unchanged.

### Dispose Mermaid's library realm

Render each Mermaid job in a fresh trusted same-origin frame, then dispose its frame, message ports, handlers and timers before settling the job. Bound admission, retained source bytes, output and active lifetime. Diagram text is MessageChannel data, not interpolated document markup. Keep strict Mermaid sanitization, image-consent checks/rechecks and CSP. Build the child-only script and styles from pinned dependencies in the isolated Nix package builder and development shell; generated assets are not source inputs.

Same-origin execution preserves authorized local-image behavior without a proxy or new file grant. It has the same library trust as the former parent-realm renderer: this is not a security or browser-process sandbox. Disposal removes application roots but does not guarantee immediate garbage collection, hard CPU preemption or a fixed heap/RSS ceiling.

Do not mutate undocumented Mermaid caches. A worker alone cannot provide its DOM measurement/rendering contract; an opaque frame would change authenticated resource behavior. Keep the library out of the parent application's import graph instead. Current transport budgets and preview behavior belong to [Feature contracts](../feature-internals.md), and the build/source map belongs to [Architecture](../architecture.md).

## Evidence and limits

Policy and mounted-owner regressions must cover reader continuity, recoverable eviction, stale publication and edit preservation. Default frame transport tests and installed-browser repeated-use checks must exercise actual resource destruction; controller-only promises are insufficient. Retained synthetic DOM/frame/heap samples are workload-specific evidence, not attribution of an unobserved user-browser peak or a universal memory ceiling. [Testing](../testing.md) owns complete acceptance.
