// Delegate actual Document methods; retain exact listener + capture identities.
// React's document-level selection listener is an explicit post-mount baseline.
export function selectionListeners(document, install) {
  const add = document.addEventListener, remove = document.removeEventListener;
  const records = [];
  let baseline = new Set();
  const capture = options => typeof options === 'boolean' ? options : options?.capture === true;
  const find = (listener, options) => records.find(record => record.listener === listener && record.capture === capture(options));
  install(document, 'addEventListener', function (type, listener, options) {
    const result = add.call(this, type, listener, options);
    if (this === document && type === 'selectionchange') {
      let record = find(listener, options);
      if (!record) { record = { listener, capture: capture(options), active: false, adds: 0, removes: 0 }; records.push(record); }
      record.active = true; record.adds++;
    }
    return result;
  });
  install(document, 'removeEventListener', function (type, listener, options) {
    const result = remove.call(this, type, listener, options);
    if (this === document && type === 'selectionchange') {
      const record = find(listener, options);
      if (record) { record.active = false; record.removes++; }
    }
    return result;
  });
  return {
    markBaseline() { baseline = new Set(records.filter(record => record.active)); },
    get pending() { return records.filter(record => record.active && !baseline.has(record)).length; },
    get added() { return records.filter(record => !baseline.has(record)).reduce((n, record) => n + record.adds, 0); },
    get removed() { return records.filter(record => !baseline.has(record)).reduce((n, record) => n + record.removes, 0); },
  };
}
