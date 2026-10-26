import { createDiffReview, type DiffReviewModel } from "./git-diff-review";

export type NotebookReadingMode = "source" | "diff" | "commit";
export interface NotebookTargetState {
  mode?: NotebookReadingMode | null;
  review: (path: string, patch: string, incarnation?: string) => DiffReviewModel;
}
export interface NotebookStepState { primary: string; secondary: string }

/** One explicit guided activation owns lightweight navigation and the last 32 immutable
 * file reading models. No authority, transport, mutable assets, storage or hidden readers.
 * Re-entry still reauthorizes and reloads each patch before reusing its matching model. */
export class GuidedReaderState {
  private readonly targets = new Map<string, NotebookTargetState>();
  private readonly steps = new Map<string, NotebookStepState>();
  private readonly reviews = new Map<string, DiffReviewModel>();
  step(identity: string, firstTarget: string): NotebookStepState {
    let state = this.steps.get(identity);
    if (!state) { state = { primary: firstTarget, secondary: "" }; this.steps.set(identity, state); }
    return state;
  }
  target(identity: string): NotebookTargetState {
    let state = this.targets.get(identity);
    if (!state) {
      state = { review: (path, patch, incarnation = "") => {
        const key = JSON.stringify([identity, path, incarnation]);
        const old = this.reviews.get(key);
        const model = old?.patch === patch ? old : createDiffReview(patch, key);
        this.reviews.delete(key); this.reviews.set(key, model);
        if (this.reviews.size > 32) this.reviews.delete(this.reviews.keys().next().value!);
        return model;
      } };
      this.targets.set(identity, state);
    }
    return state;
  }
}
