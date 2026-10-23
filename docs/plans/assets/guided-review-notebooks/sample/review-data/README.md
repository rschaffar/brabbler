# Review-data boundary specimen

**No live review records are stored in this folder.** Exact sidecar filenames,
schemas and safe update protocols remain design tasks in the active plan.

The proposed separation is:

- **Reviewer-owned:** resume position, explicit step states, versioned authored
  question responses, questions/findings/guide issues, and resolution events.
- **Agent-authored:** item-by-item replies to explicitly handed-off feedback
  versions, with investigated evidence identity and proposals.
- **Frozen handoff context:** selected feedback item IDs/versions, relevant guide
  and evidence identities, destination and the request actually confirmed.

Opening the sample does not create or update these files. Future Enable review
recording must disclose the resolved local destination and obtain applicable
write authorization. Normal reading and historical references do not grant it.
Nothing is automatically staged, committed or published.

Changing a question/evidence version preserves previous answers and replies,
flagging affected review state. File conflicts preserve both the local draft and
the external version for inspection; agent replies never overwrite reviewer
resolution. Filesystem write access is not cryptographic reviewer provenance.
