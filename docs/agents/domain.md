# Domain docs

## Before exploring

This is a single-context repository:

- Read root `GLOSSARY.md` for domain vocabulary.
- Read ADRs in `docs/adr/` relevant to the area being explored.
- Read the applicable implementation guide linked from `AGENTS.md`.

If a domain file is absent, proceed silently. Domain-modeling creates
missing domain documentation when terms or decisions are resolved;
setup does not require placeholder files.

## Use the glossary's vocabulary

Use defined terms in issues, proposals, hypotheses, and test names.
Avoid synonyms the glossary explicitly rejects. Reconsider invented
terms; note genuine vocabulary gaps for domain-modeling.

## Flag ADR conflicts

Explicitly identify any proposal that contradicts an existing ADR
and explain why the decision may need reopening.
