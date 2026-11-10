import { setInterval, clearInterval } from 'node:timers';

// jsdom 31's host rendering/focus cadence is not an application clock port.
export function ownJsdomRenderingIntervals({ start = setInterval, stop = clearInterval } = {}) {
  const handles = new Set();
  let closed = false;
  return {
    start(callback, ...args) {
      if (closed) throw new Error('Rendering interval owner is closed');
      const handle = start(callback, 1000 / 60, ...args);
      handles.add(handle);
      return handle;
    },
    clear(handle) {
      // Do not coerce numeric application IDs or cancel an unknown native timer.
      if (!handles.has(handle)) return false;
      stop(handle);
      handles.delete(handle);
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      const remaining = [...handles];
      const errors = remaining.length ? [new Error('Rendering intervals survived jsdom realm close')] : [];
      for (const handle of remaining) {
        try { stop(handle); handles.delete(handle); } catch (error) { errors.push(error); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Rendering interval cleanup failed');
    },
  };
}
