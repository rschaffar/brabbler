// Public xterm/fit boundary only. React, appearance stores and extra-key controls
// remain the application modules. The symbol is installed before graph import.
const port = () => {
  const value = globalThis[Symbol.for('brabbler:test-terminal-port')];
  if (!value) throw new Error('xterm admitted outside its owned client fixture');
  value.admit();
  return value;
};
export class Terminal {
  constructor(options) {
    this.port = port(); this.options = { ...options };
    this.cols = 80; this.rows = 24; this.disposed = false;
    this.dataListeners = new Set(); this.resizeListeners = new Set();
    this.modes = { applicationCursorKeysMode: false }; this.output = [];
    this.port.terminals.push(this);
  }
  loadAddon(addon) { addon.terminal = this; }
  open(host) { this.host = host; this.port.checked(() => { if (!host.isConnected) throw new Error('xterm host is not mounted'); }); }
  attachCustomKeyEventHandler(callback) { this.keyHandler = callback; }
  hasSelection() { return false; }
  focus() { this.port.checked(() => { if (this.disposed) throw new Error('focus after disposal'); }); }
  reset() { this.port.checked(() => { if (this.disposed) throw new Error('reset after disposal'); }); this.output = []; }
  write(data) { this.port.checked(() => { if (this.disposed) throw new Error('write after disposal'); }); this.output.push(data); }
  onData(callback) { this.dataListeners.add(callback); return { dispose: () => this.dataListeners.delete(callback) }; }
  onResize(callback) { this.resizeListeners.add(callback); return { dispose: () => this.resizeListeners.delete(callback) }; }
  input(data, userInput) {
    this.port.checked(() => { if (userInput !== true) throw new Error('extra key must use xterm input'); });
    this.emitData(data);
  }
  emitData(data) { for (const callback of this.dataListeners) callback(data); }
  emitResize(cols, rows) { for (const callback of this.resizeListeners) callback({ cols, rows }); }
  dispose() { this.disposed = true; }
}
export class FitAddon {
  constructor() { port(); }
  fit() {
    const terminal = this.terminal;
    terminal.port.checked(() => { if (terminal.disposed) throw new Error('fit after disposal'); });
    terminal.port.fits++;
  }
}
