import path from "node:path";
import { loadTsModule } from "../../../lib/sse-stream.fixture.mjs";

// Only the three route fixtures use this port. Load the WHOLE real module with
// their existing fs capability, never a second byte/Range/Response algorithm.
export function fileBodyModuleFixture(fsCapability, { allowReads = true, failures = [] } = {}) {
  const streams = [];
  const nativeCreateReadStream = fsCapability.createReadStream;
  let evaluating = false, finishing = false, certain = true, finishPromise;
  const refuse = (message) => {
    const failure = new Error(message);
    failures.push(failure); // Route catches cannot erase an admission violation.
    throw failure;
  };
  const bodyFs = {
    ...fsCapability,
    createReadStream(...args) {
      if (evaluating) return refuse("file-body module evaluation attempted a native read");
      if (!allowReads) return refuse("upload/watch route unexpectedly requested a finite file-body read");
      if (finishing) return refuse("file-body read attempted after fixture finish began");
      let stream;
      try {
        // Preserve the original capability receiver, arguments and native return.
        stream = Reflect.apply(nativeCreateReadStream, fsCapability, args);
      } catch (failure) {
        certain = false; // No returned stream means no provable close ownership.
        failures.push(failure);
        throw failure;
      }
      const owned = { stream, closed: false, close: null };
      streams.push(owned);
      // Attach at acquisition, before the real body producer receives the stream.
      owned.close = new Promise(resolve => stream.once("close", () => {
        owned.closed = true;
        resolve();
      }));
      stream.on("error", failure => failures.push(failure));
      return stream;
    },
  };
  return {
    load(globals = {}) {
      evaluating = true;
      try {
        return loadTsModule(new URL("../../../lib/file-body-stream.ts", import.meta.url),
          { fs: bodyFs, path }, { ...globals, Buffer }).exports;
      } finally {
        evaluating = false;
      }
    },
    finish() {
      if (finishPromise) return finishPromise;
      finishing = true;
      // Release ALL known native producers before awaiting ANY close. This also
      // runs when setup, response construction, body consumption or assertions fail.
      for (const owned of streams) {
        try {
          if (!owned.closed) owned.stream.destroy();
        } catch (failure) {
          failures.push(failure);
        }
      }
      // EOF/body settlement/cancel ACK is deliberately not a descriptor receipt.
      finishPromise = Promise.allSettled(streams.map(owned => owned.close)).then(results => {
        for (const result of results) {
          if (result.status === "rejected") failures.push(result.reason);
        }
        return {
          closed: certain && results.every(result => result.status === "fulfilled")
            && streams.every(owned => owned.closed && owned.stream.closed === true && owned.stream.fd === null),
          errors: [...failures],
        };
      });
      return finishPromise;
    },
  };
}
