// External frame transport only; no copied renderer/controller or parent Mermaid.
export function renderMermaid(input, signal) {
  return globalThis[Symbol.for('brabbler:test-mermaid-frame-transport')].render(input, signal);
}
