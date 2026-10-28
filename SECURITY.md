# Security reports

Brabbler is a single-operator coding workspace with access to the server user's
files, commands and configured providers. It is not a multi-tenant service or a
sandbox against trusted extensions or a compromised host. Keep the default
loopback listener unless deliberately configuring authenticated, encrypted remote
access. Explicit no-auth mode intentionally removes web login protection.

## Reporting a vulnerability privately

For the public `rschaffar/brabbler` repository, use **Security → Report a
vulnerability** once GitHub private vulnerability reporting is enabled. This opens
a private advisory discussion with repository maintainers, rather than a public
issue. Public disclosure/advisory publication is a separate coordinated decision.

Enabling and verifying that feature is a release prerequisite, not a claim that a
repository setting has already been changed. If the private reporting control is
unavailable, do not put vulnerability details, credentials or private data into a
public issue; request a private contact channel without disclosing the details.

Include the Brabbler version/commit, Node/OS version, affected entry point,
expected versus observed behavior and a minimal **synthetic** reproduction.
Redact API keys, passwords, cookies, session histories, internal hosts and private
project data. Do not send a complete agent-data directory or unredacted logs.

## Supported scope

Security review and fixes target the current Brabbler candidate/release and its
maintained launchers. Consult [release status](docs/release.md) and
[dependency dispositions](docs/dependencies.md) for exact tested inputs and known
issues; neither an npm audit nor this policy promises absence of vulnerabilities.
There is no separate upstream Pi Web support commitment or fixed response-time
promise for this independently maintained personal project.
