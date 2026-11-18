# Triage labels

For triage, use these strings in each issue's `Status:` line.
[Issue tracker](issue-tracker.md) defines completion and reopening.

| Canonical role | Local status | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation needed |
| `needs-info` | `needs-info` | Waiting for reporter information |
| `ready-for-agent` | `ready-for-agent` | Fully specified for agent implementation |
| `ready-for-human` | `ready-for-human` | Human implementation required |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill requests a triage label, update the local status instead
of calling a remote tracker. Edit this mapping to change the vocabulary.
