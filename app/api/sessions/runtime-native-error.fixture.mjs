// Native-control error boundaries only; no product promise/timing changes.
import { deferred } from '../../../lib/testing/async.fixture.mjs';

// Accept the complete ordered identity list, including multiplicity. On any
// unknown/missing/duplicate cause, propagate the ORIGINAL aggregate untouched.
export async function expectNativeFailures(work, expected) {
  try {
    await work;
  } catch (error) {
    if (error instanceof AggregateError && error.errors.length === expected.length
      && error.errors.every((cause, index) => cause === expected[index])) return;
    throw error;
  }
  throw new Error('Expected native ownership failure was not reported');
}

// Used by the actual fs.close forwarder. Capturing a native result, completing
// this delivery attempt, successful callback return and stream close differ.
export function createNativeCallbackDelivery() {
  const returned = deferred();
  void returned.promise.catch(() => {});
  let deliveryFinished = false;
  return {
    callbackReturned: returned.promise,
    get deliveryFinished() { return deliveryFinished; },
    reject: error => returned.reject(error),
    deliver(callback, receiver, values) {
      try {
        const result = Reflect.apply(callback, receiver, values);
        returned.resolve(); // only after an actual successful synchronous return
        return result;
      } catch (error) {
        returned.reject(error); // original identity, before ANY fulfillment
      } finally {
        deliveryFinished = true; // an attempt finished, not success/native close
      }
    },
  };
}
