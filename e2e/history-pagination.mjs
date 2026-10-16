// A late initial context response is not the older page requested by scrolling.
export function historyPageResponse(response, sessionId, before) {
  const url = new URL(response.url());
  return url.pathname === `/api/sessions/${sessionId}/context`
    && url.searchParams.get("before") === before;
}
