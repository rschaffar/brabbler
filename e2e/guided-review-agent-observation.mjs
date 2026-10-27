import assert from 'node:assert/strict';

/** Retain every observed agent HTTP request as diagnostics, including ordinary
 * GETs. This is a command-transport assertion, not a universal process-idle proof. */
export function observeGuidedReviewAgentRequest(request) {
  const url = new URL(request.url());
  if (!/^\/api\/agent(?:\/|$)/.test(url.pathname)) return null;
  return { method: request.method(), path: url.pathname + url.search, body: request.postData() };
}

/** Normal UI focus/open can request the existing session's tool catalogue. That
 * one exact known non-prompt wire tuple is permitted. Every other non-GET agent
 * request (new session, prompt, steer, Bash, extra fields, other sessions, etc.)
 * fails. GET observations remain in the original array; no action resets it. */
export function assertNoGuidedReviewAgentExecution(observations, sessionId) {
  for (const request of observations) {
    if (request.method === 'GET') continue;
    assert.deepEqual(request, {
      method: 'POST', path: `/api/agent/${encodeURIComponent(sessionId)}`, body: '{"type":"get_tools"}',
    }, 'guided review may read the exact existing-session tool catalogue, but must not submit a model turn or agent-execution command');
  }
}
