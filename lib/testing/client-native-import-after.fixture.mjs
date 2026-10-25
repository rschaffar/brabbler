import { after } from 'node:test';
import net from 'node:net';
import { clientNativeBoundaryStatus } from './client-native-boundary.fixture.mjs';
import { recordRootAfter, recordFatalMonitor } from './client-native-import-snapshot.fixture.mjs';
// Evaluates AFTER the early bootstrap and its monitor, BEFORE failure/admission.
const get = Object.getOwnPropertyDescriptor;
const fencedConnect = get(net, 'connect');
const observeFatal = error => {
  const current = get(net, 'connect');
  const guarded = Boolean(current && fencedConnect && current.value === fencedConnect.value);
  if (error?.message === 'CNB_TOP_LEVEL_IMPORT_FAILURE') {
    recordFatalMonitor(clientNativeBoundaryStatus(), guarded, 'pre-root');
  } else if (error?.message === 'CNB_POST_ROOT_UNCAUGHT_CONTROL') {
    recordFatalMonitor(clientNativeBoundaryStatus(), guarded, 'post-root');
  }
};
process.on('uncaughtExceptionMonitor', observeFatal);
after(() => {
  recordRootAfter(clientNativeBoundaryStatus());
  process.off('uncaughtExceptionMonitor', observeFatal);
});
