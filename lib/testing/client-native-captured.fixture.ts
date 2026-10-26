// Actual Jiti-loaded module: capture native references at module evaluation,
// AFTER the entry's first ESM bootstrap, not after a later fixture install.
import { writeFileSync } from 'node:fs';
import { connect, Socket } from 'node:net';
import { spawnSync } from 'node:child_process';

const capturedWrite = writeFileSync;
const capturedConnect = connect;
const capturedSocketConnect: (this: Socket, port: number) => Socket = Socket.prototype.connect;
const capturedSpawn = spawnSync;
export function capturedWriteProbe(path: string) { capturedWrite(path, 'private negative control\n'); }
export function capturedConnectProbe() { return capturedConnect(-1); }
export function capturedSocketProbe() {
  const socket = new Socket();
  try { return capturedSocketConnect.call(socket, -1); }
  finally { socket.destroy(); }
}
export function capturedSpawnProbe(executable: string) { return capturedSpawn(executable, [], { timeout: 1000 }); }
