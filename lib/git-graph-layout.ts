// Adapted from binaryplease/git-graph shared/graphLayout.ts (MIT), copyright
// (c) 2026 Enrico Scherlies. See git-graph-layout.LICENSE.
// Active-lane sweep over git log --topo-order; parents outside the loaded page
// have no visible edge until older commits are loaded.
export interface GraphCommit { oid: string; parents: string[] }
export interface GraphLink { childRow: number; childLane: number; parentRow: number; parentLane: number }
export interface GraphLayout { lanes: number[]; links: GraphLink[]; laneCount: number }

export function layoutGitGraph(commits: readonly GraphCommit[]): GraphLayout {
  const rows = new Map(commits.map((commit, row) => [commit.oid, row]));
  const awaiting: Array<string | null> = [];
  const lanes: number[] = [];
  const links: GraphLink[] = [];
  let laneCount = 0;
  const free = () => {
    const slot = awaiting.indexOf(null);
    if (slot >= 0) return slot;
    awaiting.push(null);
    return awaiting.length - 1;
  };
  commits.forEach((commit, row) => {
    let lane = -1;
    for (let i = 0; i < awaiting.length; i++) {
      if (awaiting[i] !== commit.oid) continue;
      if (lane < 0) lane = i;
      else awaiting[i] = null;
    }
    if (lane < 0) lane = free();
    awaiting[lane] = null;
    lanes.push(lane);
    laneCount = Math.max(laneCount, lane + 1);
    commit.parents.filter((parent) => rows.has(parent)).forEach((parent, ordinal) => {
      let parentLane = awaiting.indexOf(parent);
      if (parentLane < 0) {
        parentLane = ordinal === 0 ? lane : free();
        awaiting[parentLane] = parent;
      }
      laneCount = Math.max(laneCount, parentLane + 1);
      links.push({ childRow: row, childLane: lane, parentRow: rows.get(parent)!, parentLane });
    });
  });
  return { lanes, links, laneCount };
}
