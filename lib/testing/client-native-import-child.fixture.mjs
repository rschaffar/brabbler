// One ordinary Node child: no --test orchestrator spawning a second child.
import './client-native-import-snapshot.fixture.mjs';
import './client-native-boundary.fixture.mjs';
import './client-native-import-after.fixture.mjs';
import './client-native-import-tla-failure.fixture.mjs';
// This entry body must not run: the last static dependency rejects at TLA.
throw new Error('CNB_FAILED_DEPENDENCY_WAS_NOT_EVALUATED');
