// Test-only ownership primitives. They observe promises; they do not invent
// cancellation, native closure or authority for work owned by another service.
export function deferred() {
  const gate = Promise.withResolvers();
  // Keep the original rejecting promise observable by its eventual owner.
  void gate.promise.catch(() => {});
  return gate;
}

export function createTaskOwner() {
  const pending = new Set();
  const failures = [];
  let joining;
  let closed = false;
  return {
    track(label, work) {
      if (closed) throw new Error(`Task owner is closed: ${label}`);
      const result = Promise.resolve(work);
      const observed = result.then(
        () => { pending.delete(observed); },
        (error) => { failures.push(error); pending.delete(observed); },
      );
      pending.add(observed);
      return result;
    },
    join() {
      if (!joining) {
        closed = true;
        joining = (async () => {
          await Promise.all(pending);
          if (failures.length) throw new AggregateError(failures, 'Owned work failed');
        })();
        // Observe immediately even when a fixture fails before awaiting teardown.
        void joining.catch(() => {});
      }
      return joining;
    },
  };
}
