// External chunk capability only. Reject each import's promise assimilation:
// a top-level throw leaves Jiti's partially evaluated CJS namespace cached, so a
// second demand can otherwise appear successful without loading any grammar.
// React, production loader/dedup/retry and selection policy are not replaced.
export function then(_resolve, reject) {
  reject(new Error('controlled external Prism chunk rejection'));
}
