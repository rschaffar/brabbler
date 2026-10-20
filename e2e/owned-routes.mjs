/** Join owned callbacks through their terminal operation before context shutdown. */
export function createOwnedRoutes(handle, handleClosing) {
  const pending = new Set(), failures = [];
  let disposing = false;
  const handler = (route) => {
    const work = (async () => (disposing ? handleClosing : handle)(route))();
    pending.add(work);
    void work.then(() => pending.delete(work), (error) => {
      failures.push(error);
      pending.delete(work);
    });
    return work;
  };
  const drain = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };
  return {
    handler,
    beginDisposal() { disposing = true; },
    async dispose(unregister) {
      disposing = true;
      await drain();
      try { await unregister(handler); } catch (error) { failures.push(error); }
      await drain();
      if (failures.length) throw new AggregateError(failures, "Owned route callbacks failed");
    },
  };
}
