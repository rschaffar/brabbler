import { clientNativeBoundaryStatus } from "../lib/testing/client-native-boundary.fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { sessionFixture, command } from "./agent-session-mounted.fixture.mjs";

// Contained shared-fixture fault control, not model/default/native authority.
// Use the actual context's mock object, the existing after-capture recipe and
// actual registered disposers. No replacement hook, runner or cleanup seam.
test("shared session cleanup retains exact original causes after a held System body and independently completes restoration", { timeout: 10000 }, async t => {
  const originalCause = new Error("cleanup control original cause");
  const structuredLeaf = new Error("cleanup control structured leaf");
  const originalMarker = new AggregateError([structuredLeaf], "cleanup control original marker", { cause: originalCause });
  const originalErrors = originalMarker.errors;
  const followingMarker = new Error("cleanup control following independent marker");
  const callbacks = [], order = [];
  let disposal, invoked = 0, fixture, realm, held, originalWork, observedWork;
  let admitted = false, bodyDelivered = false, publicFinished = false;
  const innerContext = {
    mock: t.mock,
    after(callback, options) { callbacks.push({ callback, options }); },
  };
  const fields = ["value", "writable", "get", "set", "enumerable", "configurable"];
  const hostKeys = ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "KeyboardEvent", "PointerEvent",
    "MutationObserver", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT", "fetch", "WebSocket", "XMLHttpRequest", "EventSource",
    "requestAnimationFrame", "cancelAnimationFrame"];
  const descriptors = hostKeys.map(key => ({ target: globalThis, key, before: Object.getOwnPropertyDescriptor(globalThis, key) }));
  for (const key of ["error", "warn"]) descriptors.push({ target: console, key, before: Object.getOwnPropertyDescriptor(console, key) });
  const listenerNames = ["unhandledRejection", "uncaughtExceptionMonitor"];
  const listeners = new Map(listenerNames.map(name => [name, process.listeners(name)]));

  // Register the REAL outer after before fixture import/setup/admission can fail.
  // A body assertion failure cannot bypass any captured callback or hide an
  // unrelated cleanup error behind the two explicitly injected markers.
  const disposeRegisteredOwners = () => {
    if (!disposal) {
      disposal = (async () => {
        const failures = [];
        for (let cursor = 0; cursor < callbacks.length; cursor++) {
          const { callback, options } = callbacks[cursor];
          // Current real fixture/mount callbacks have no options. Retain any
          // unexpected options and still invoke the callback; never silently
          // invent timeout/signal handling for a future after-hook contract.
          if (options !== undefined) failures.push(new Error("unexpected captured after options", { cause: options }));
          try { await Reflect.apply(callback, innerContext, [innerContext]); }
          catch (error) { failures.push(error); }
          finally { invoked++; }
        }
        // These are the captured ORIGINAL complete public work promises too;
        // a callback failure must not skip their independent terminal joins.
        for (const work of [originalWork, observedWork]) if (work) {
          try { await work; } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, "captured session cleanup callbacks failed");
      })();
      void disposal.catch(() => {});
    }
    return disposal;
  };
  const captureCleanup = async () => {
    try { await disposeRegisteredOwners(); }
    catch (error) { return error; }
    return undefined;
  };
  const ownNames = (value, names, label) => {
    assert.deepEqual(Object.getOwnPropertyNames(value).sort(), [...names].sort(), label);
    assert.equal(Object.getOwnPropertySymbols(value).length, 0, `${label}: no hidden extra causes`);
  };
  function exactBoundary(error) {
    assert.equal(error instanceof AggregateError, true, "captured aggregate exists");
    assert.equal(error.message, "captured session cleanup callbacks failed");
    ownNames(error, ["stack", "message", "errors"], "captured aggregate shape");
    assert.equal(error.errors.length, 1, "only the actual fixture after may fail");
    const actual = error.errors[0];
    assert.equal(actual instanceof AggregateError, true, "actual fixture teardown aggregate");
    assert.equal(actual.message.startsWith("Mounted session teardown failed:"), true);
    ownNames(actual, ["stack", "message", "errors"], "fixture aggregate shape");
    assert.equal(actual.errors.length, 2, "exactly the two injected finalizer failures, no unknown failure");
    const [first, following] = actual.errors;
    assert.equal(first.cause === originalMarker, true, "cleanup retains original marker by reference");
    assert.equal(following.cause === followingMarker, true, "cleanup retains following marker by reference");
    for (const contextual of [first, following]) {
      assert.equal(Object.getPrototypeOf(contextual) === Error.prototype, true);
      ownNames(contextual, ["stack", "message", "cause"], "known stage context only");
      assert.equal(contextual.message.startsWith("passive observation finalizer: "), true);
    }
    // Reference checks, never deep-equality/inspection of Error/DOM graphs.
    assert.equal(originalMarker.errors === originalErrors, true, "structured errors array is not replaced");
    assert.equal(originalErrors.length, 1);
    assert.equal(originalErrors[0] === structuredLeaf, true);
    assert.equal(originalMarker.cause === originalCause, true);
    ownNames(originalMarker, ["stack", "message", "errors", "cause"], "known original marker graph");
    ownNames(structuredLeaf, ["stack", "message"], "known structured leaf");
    ownNames(originalCause, ["stack", "message"], "known original cause");
    ownNames(followingMarker, ["stack", "message"], "known following marker");
  }
  function restored() {
    const failures = [];
    const check = action => { try { action(); } catch (error) { failures.push(error); } };
    check(() => assert.deepEqual(order, ["original", "following"], "failure cannot skip the following finalizer"));
    check(() => assert.equal(invoked, callbacks.length, "every actual registered after callback was attempted"));
    check(() => assert.equal(callbacks.length, 2, "current fixture after plus real React mount disposer"));
    check(() => assert.equal(bodyDelivered, true, "fixture disposal released the admitted peer body"));
    check(() => assert.equal(publicFinished, true, "full original System public catch/finally finished"));
    check(() => assert.equal(held?.done, true));
    check(() => assert.equal(realm !== undefined, true, "actual realm was mounted"));
    if (realm) check(() => assert.equal(realm.document === undefined, true, "actual JSDOM window.close completed"));
    for (const { target, key, before } of descriptors) check(() => {
      const actual = Object.getOwnPropertyDescriptor(target, key);
      assert.equal(actual === undefined, before === undefined, `restore ${key} descriptor presence`);
      for (const field of fields) {
        assert.equal(Object.hasOwn(actual ?? {}, field), Object.hasOwn(before ?? {}, field), `restore ${key}.${field} presence`);
        assert.equal(Object.is(actual?.[field], before?.[field]), true, `restore ${key}.${field} identity`);
      }
    });
    for (const name of listenerNames) check(() => {
      const actual = process.listeners(name), before = listeners.get(name);
      assert.equal(actual.length, before.length, `restore ${name} listener count`);
      for (let index = 0; index < before.length; index++) assert.equal(actual[index] === before[index], true, `restore ${name} listener identity`);
    });
    check(() => assert.equal(clientNativeBoundaryStatus().phase, "active", "fixture cannot prematurely unfence the root"));
    if (failures.length) throw new AggregateError(failures, "cleanup control restoration assertions failed");
  }
  function inspectCleanup(error) {
    const failures = [];
    // Attempt identity and restoration oracles independently. On a failed
    // assertion retain the whole original cleanup aggregate, not a scalar or
    // permissive contains(marker) match that would hide unrelated causes.
    try { exactBoundary(error); } catch (failure) { failures.push(failure); }
    try { restored(); } catch (failure) { failures.push(failure); }
    if (failures.length) {
      // Display only bounded primitive oracle messages; retain the complete
      // original cleanup aggregate and every oracle failure by reference.
      const preview = failures.slice(0, 4).map(failure => failure instanceof Error
        ? failure.message.slice(0, 700) : typeof failure).join(" | ").slice(0, 900);
      throw new AggregateError(error === undefined ? failures : [error, ...failures], `unexpected shared-fixture cleanup boundary; oracles: ${preview}`);
    }
  }
  t.after(async () => { inspectCleanup(await captureCleanup()); });

  assert.equal(innerContext.mock === t.mock, true, "real test mock context is forwarded unchanged");
  fixture = await sessionFixture(innerContext, { observeProduction({ afterSettlement }) {
    // Existing finalizers execute in reverse registration order. Register the
    // independent following marker first so it must run AFTER the first throws.
    afterSettlement(() => {
      order.push("following");
      assert.equal(publicFinished, true);
      assert.equal(globalThis.document === realm.document, true, "following finalizer still has its live realm");
      throw followingMarker;
    });
    afterSettlement(() => {
      order.push("original");
      assert.equal(admitted, true, "actual System get_state body entered before the injected cleanup fault");
      assert.equal(bodyDelivered, true, "release before wait completed the peer body");
      assert.equal(publicFinished, true, "existing domain join finished original public work before finalizers");
      assert.equal(globalThis.document === realm.document, true, "finalizer precedes realm close/global restore");
      throw originalMarker;
    });
  } });
  await fixture.mountReady(fixture.existingOptions());
  realm = fixture.view.window;
  held = fixture.hold(command("get_state"), { stage: "body", abort: "ignore", beforeJson() { bodyDelivered = true; } });
  const operation = await fixture.start("actual held System full public operation for cleanup control", () => fixture.loader());
  originalWork = operation.promise;
  observedWork = originalWork.then(() => { publicFinished = true; });
  void observedWork.catch(() => {}); // independent original/observer joins above retain any rejection
  await held.entered.promise;
  admitted = true;
  assert.equal(held.request.path, `/api/agent/${fixture.savedId}`);
  assert.deepEqual(held.request.body, { type: "get_state" });
  assert.equal(held.done, false);
  assert.equal(bodyDelivered, false); assert.equal(publicFinished, false);
  // Do not manually resolve the gate: actual fixture disposal must release it
  // before its public/maintenance/body waits, despite the later finalizer fault.
  inspectCleanup(await captureCleanup());
});

// Real root-after, registered after the FIRST dependency's real root fence.
// A contained expected finalizer fault is not permission to hide root denials,
// descriptor failures or other unexpected errors. No grant/restore API is used.
after(() => {
  const status = clientNativeBoundaryStatus();
  assert.equal(status.phase, "restored");
  assert.equal(status.restorationMode, "normal-after");
  assert.equal(status.installed > 0, true);
  assert.equal(status.restored, status.installed);
  assert.equal(status.unexpectedCount, 0);
  assert.equal(status.totalDenials, 0);
  assert.equal(status.restorationFailures, 0);
  assert.equal(status.preRootFatalCount, 0);
});
