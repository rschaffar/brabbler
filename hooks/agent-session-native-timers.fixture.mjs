// Passive host-native registration/clear witness. Never delivers a callback,
// changes a delay, replaces Date/React/JSDOM time, or claims elapsed-60s proof.
// Install before sessionFixture so production import is also observed.
export function nativeTimerWitness(t, owner = () => null) {
  const originalSet = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
  const originalClear = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout");
  const registrations = [], clears = [];
  // Register restoration before either descriptor installation. Native timer
  // ownership/cancellation remains entirely in production and the shared realm.
  t.after(() => {
    try { Object.defineProperty(globalThis, "setTimeout", originalSet); }
    finally { Object.defineProperty(globalThis, "clearTimeout", originalClear); }
  });
  Object.defineProperty(globalThis, "setTimeout", { ...originalSet, value: function (...args) {
    const handle = Reflect.apply(originalSet.value, this, args);
    registrations.push({ callback: args[0], ms: args[1], handle, owner: owner(),
      registeredAt: process.hrtime.bigint() });
    return handle;
  } });
  Object.defineProperty(globalThis, "clearTimeout", { ...originalClear, value: function (handle) {
    clears.push(handle);
    return Reflect.apply(originalClear.value, this, [handle]);
  } });
  return { registrations, clears, at: ms => registrations.filter(entry => entry.ms === ms),
    cleared: entry => clears.includes(entry.handle) };
}
