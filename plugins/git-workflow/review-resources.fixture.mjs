// Complete supplied metadata only; no capture/validation implementation or effects.
export function cleanupReviewSnapshot(paths) {
  return { identity: "a".repeat(64), repositoryIdentity: "b".repeat(64), fingerprint: "c".repeat(64),
    cwd: "/repo", path: "/feature", target: "main",
    artifacts: paths.map(path => ({ path, entries: 1, bytes: 10, digest: "d".repeat(64) })),
    unapprovedArtifacts: [...paths], artifactParents: [""],
    artifactParentMetadata: [{ path: "", digest: "e".repeat(64) }],
    artifactParentIdentities: [{ path: "", identity: ["1", "2", "16877"] }],
    lossEvidence: { state: "integrated", comparisonTarget: { branch: "main", tip: "1".repeat(40) } },
    verifiedComparison: { branch: "main", tip: "2".repeat(40) } };
}
