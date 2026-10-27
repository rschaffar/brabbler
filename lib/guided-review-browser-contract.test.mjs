import assert from 'node:assert/strict';
import test from 'node:test';
import { observeGuidedReviewAgentRequest, assertNoGuidedReviewAgentExecution } from '../e2e/guided-review-agent-observation.mjs';

const session = 'e2e-review-notebook';
const record = (method, path, body = null) => observeGuidedReviewAgentRequest({ url: () => `http://localhost${path}`, method: () => method, postData: () => body });

test('browser review command observer retains structured requests and permits only the exact existing-session get_tools command', () => {
  const observations = [record('GET', '/api/agent/running'), record('GET', `/api/agent/${session}/events`), record('POST', `/api/agent/${session}`, '{"type":"get_tools"}')];
  assert.deepEqual(observations[2], { method: 'POST', path: `/api/agent/${session}`, body: '{"type":"get_tools"}' });
  const original = structuredClone(observations);
  assertNoGuidedReviewAgentExecution(observations, session);
  assert.deepEqual(observations, original, 'read observations are preserved, not reset or removed after an action');
  assert.equal(record('POST', '/api/review-data', '{}'), null, 'only the agent namespace belongs to this observer');
  assert.equal(record('POST', '/api/agent-other', '{}'), null, 'a sibling namespace is not an agent endpoint');
});

test('browser review observer rejects every execution/new-session/other-session/extra-field or malformed command tuple', () => {
  const forbidden = [
    record('POST', `/api/agent/${session}`, '{"type":"prompt","message":"run this"}'),
    record('POST', `/api/agent/${session}`, '{"type":"steer","message":"change this"}'),
    record('POST', `/api/agent/${session}`, '{"type":"bash","command":"true"}'),
    record('POST', '/api/agent/new', '{"cwd":"/fixture"}'),
    record('POST', '/api/agent/e2e-file-line-links', '{"type":"get_tools"}'),
    record('POST', `/api/agent/${session}?type=prompt`, '{"type":"get_tools"}'),
    record('POST', `/api/agent/${session}`, '{"type":"get_state"}'),
    record('POST', `/api/agent/${session}`, '{"type":"get_tools","message":"hidden prompt"}'),
    record('POST', `/api/agent/${session}`, '{"type":"get_tools","type":"prompt"}'),
    record('POST', `/api/agent/${session}`, '{malformed'),
    record('POST', `/api/agent/${session}`, null),
    record('PATCH', `/api/agent/${session}`, '{"type":"get_tools"}'),
  ];
  for (const request of forbidden) assert.throws(() => assertNoGuidedReviewAgentExecution([record('POST', `/api/agent/${session}`, '{"type":"get_tools"}'), request], session), /must not submit a model turn or agent-execution command/);
});
