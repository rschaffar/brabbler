# Browser SSH removed

Browser-backed signing and browser-controlled SSH agent selection have been
removed; [ADR 0039](adr/0039-remove-browser-ssh.md) supersedes the historical
implementation records that link here.

Use ordinary [native SSH agents and forwarding](terminal.md#ssh-and-agent-forwarding).
Existing saved browser-key metadata and authenticator credentials are not deleted
or converted, and remote key authorizations are not revoked by this removal.
