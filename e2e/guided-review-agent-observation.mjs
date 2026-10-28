import assert from 'node:assert/strict';

/** Retain every observed agent HTTP request as diagnostics, including ordinary
 * GETs. This is a command-transport assertion, not a universal process-idle proof. */
export function observeGuidedReviewAgentRequest(request) {
  const url = new URL(request.url());
  if (!/^\/api\/agent(?:\/|$)/.test(url.pathname)) return null;
  return { method: request.method(), path: url.pathname + url.search, body: request.postData() };
}

/** Normal UI focus/open can read the existing session's catalogue and renew its
 * bodyless SSE lease. Only those exact non-executing wire tuples are permitted;
 * every other non-GET (new session, prompt, steer, Bash, extra fields, other
 * sessions, etc.) fails. Observations are retained; no action resets the array. */
export function assertNoGuidedReviewAgentExecution(observations, sessionId) {
  for (const request of observations) {
    if (request.method === 'GET') continue;
    const agentPath = `/api/agent/${encodeURIComponent(sessionId)}`;
    const expected = request.path === `${agentPath}/lease`
      ? { method: 'POST', path: `${agentPath}/lease`, body: null }
      : { method: 'POST', path: agentPath, body: '{"type":"get_tools"}' };
    assert.deepEqual(request, expected, 'guided review may use only the exact existing-session catalogue or bodyless lease renewal, but must not submit a model turn or agent-execution command');
  }
}
