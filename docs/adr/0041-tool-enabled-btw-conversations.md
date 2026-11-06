# BTW is a presentation relationship, not a chat-only capability policy

## Decision

BTW side conversations use ordinary session tool/resource policy. They may read files, execute shell commands, edit/write, use skills and trusted extensions/plugins, delegate work and select native MCP/Code-mode resources. New BTW sessions copy the source's built-in/native selections once. Existing selections, including Chat only, remain authoritative and independently editable.

Use additive BTW guidance with normal SDK/project instructions rather than a special tool-denying exact prompt. Explicit Chat only retains ordinary context-file loading and adds the relationship guidance without loading skills/extensions/native resources.

## Preserved boundaries

Source references remain inert historical text, not task delegation, source-card response capabilities or copied approvals. Additional source history is available through a bounded, reference-anchored read tool. Opening BTW starts no model turn, and answering there sends nothing to the source automatically. Account/trust/plugin permissions remain ordinary session-local or project-owned decisions; attachment does not copy source-session overrides. BTW stays distinct from subagent orchestration and completion reports.

## Consequences

This supersedes the original chat-only BTW implementation choice. Older saved BTW chats can deliberately enable tools through normal controls without losing their identity or history. A separate conversation is not an OS or filesystem sandbox: source and BTW share a working directory, so writers must coordinate and follow worktree rules. Tool capabilities do not authorize remote operations, deployment, source approvals or automatic execution of quoted history.

Mechanisms and user controls are maintained in the session, feature and native-tool guides.
