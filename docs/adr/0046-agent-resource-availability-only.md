# Agent resources control availability, not package management

Status: Accepted; supersedes the package-action rehoming obligation in the scoped skills and extensions plan.

Brabbler's Skills & extensions feature owns scoped availability, resource metadata, independently admitted skill inspection and explicit application to a conversation. Pi or Nix owns installing, searching for, updating and removing packages and their registration; Brabbler does not restore those management controls in this change. This keeps the feature focused on the verified selection flow rather than adding remote package-source support and coordinating installed-content mutations across live runtimes.

## Consequences

- Show package/source ownership and external-management guidance instead of install/search/update/remove controls.
- Retire obsolete Brabbler package/skill installation and update mutation endpoints with actionable errors; hiding buttons alone is not the ownership boundary.
- Nix-managed contents and declarations remain untouched. Native prompt/theme handling and built-in feature permissions remain independent of skill/extension availability.
- Supported installed local sources use the existing inert catalog and native admission. Unsupported native source arrangements refuse actionably; this decision does not authorize a copied discovery implementation, alternate catalog or SDK patch.
- The former external Plugins surface remains removed. Its bundled permission controls are presented as Built-in features.
