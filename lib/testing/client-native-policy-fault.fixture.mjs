// OPT-IN EXPECTED-RED entry for Parent, not a scheduled .test owner.
// All network contrasts use invalid port -1, even with the boundary removed.
import './client-native-boundary.fixture.mjs';
import test from 'node:test';
import net from 'node:net';
import { expectNativeDenial } from './client-native-boundary.fixture.mjs';
const mode = process.env.PI_CLIENT_NATIVE_BOUNDARY_FAULT;
const caughtAttempt = () => { try { net.connect(-1); } catch {} };
test(`client-native-policy expected RED: ${mode}`, t => {
  switch (mode) {
    case 'swallowed':
      caughtAttempt(); // Body passes; independent root collector MUST fail.
      break;
    case 'extra-attempt':
      expectNativeDenial('net.connect', () => {
        let first;
        try { net.connect(-1); } catch (error) { first = error; }
        caughtAttempt(); // Cannot be laundered by the one expected marker.
        throw first;
      });
      break;
    case 'wrong-port':
      expectNativeDenial('fs.writeFileSync', () => net.connect(-1));
      break;
    case 'swallowed-expected':
      expectNativeDenial('net.connect', caughtAttempt);
      break;
    case 'teardown':
      t.after(caughtAttempt); // Live through actual test-level teardown.
      break;
    case 'restore-failure':
      // Isolated child's real descriptor cannot restore. Early root must still
      // attempt ALL other actual descriptors and report the independent failure.
      t.after(() => Object.defineProperty(net, 'connect', {
        value: net.connect, writable: false, configurable: false, enumerable: true,
      }));
      break;
    default:
      throw new Error('Parent must select one explicit native-boundary fault');
  }
});
