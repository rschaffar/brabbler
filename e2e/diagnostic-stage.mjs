import { performance } from "node:perf_hooks";

/** Diagnostic only: never emits coverage receipts or converts failures to success. */
export function createDiagnosticStages(group, emit = line => console.log(line)) {
  let sequence = 0;
  const open = new Set();
  const start = name => {
    const id = ++sequence;
    const started = performance.now();
    emit(`E2E_STAGE ${JSON.stringify({ group, id, name, phase: "start" })}`);
    const end = (succeeded = true) => {
      if (!open.delete(end)) return;
      emit(`E2E_STAGE ${JSON.stringify({ group, id, name, phase: "end", succeeded, elapsedMs: performance.now() - started })}`);
    };
    open.add(end);
    return end;
  };
  const stage = async (name, work) => {
    const end = start(name);
    let succeeded = false;
    try {
      const result = await work();
      succeeded = true;
      return result;
    } finally { end(succeeded); }
  };
  stage.start = start;
  stage.finishOpen = () => { for (const end of [...open].reverse()) end(false); };
  return stage;
}
