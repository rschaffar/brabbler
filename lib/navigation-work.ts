"use client";

import { createContext, useContext } from "react";

/** Callers observe complete workflow promises; only an explicit owner joins them. */
export interface NavigationWorkObserver {
  observe<T>(work: Promise<T>): Promise<T>;
}

/** Observation only: no admission/cancellation/retry/error/publication policy.
 * Call settle only after the caller has stopped the actual UI/event admission.
 * Strict effect release is not terminal disposal. Tasks include their existing
 * catch/finally callbacks; response/body gates alone are not completion owners.
 */
export class NavigationWork {
  private pending = new Set<Promise<unknown>>();
  private failures: unknown[] = [];
  observe<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(() => { this.pending.delete(work); }, error => {
      this.failures.push(error);
      this.pending.delete(work);
    });
    return work;
  }
  async settle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    if (this.failures.length) throw new AggregateError([...this.failures], "Navigation work failed");
  }
}

// Ordinary production calls preserve the original promise AND rejection policy:
// no handler attachment, local task owner, reporting, or lifecycle is introduced.
const unobservedWork: NavigationWorkObserver = { observe: work => work };

export const NavigationWorkContext = createContext<NavigationWork | null>(null);
export function useNavigationWork(): NavigationWorkObserver {
  return useContext(NavigationWorkContext) ?? unobservedWork;
}
