import assert from "node:assert/strict";

export async function assertCompactChatRestored(page) {
  const showChat = page.getByRole("button", { name: "Show chat panel", exact: true });
  // Viewport acknowledgment can precede the responsive React commit. Reuse the
  // page's existing locator timeout; keep the original strict assertion below.
  await showChat.waitFor({ state: "detached" });
  assert.equal(await showChat.count(), 0, "compact layout restores chat and retains its existing Files overlay");
}
