import assert from "node:assert/strict";
import test from "node:test";
import { safeAuthorizationUrl } from "./oauth-url.ts";

test("only HTTP(S) authorization URLs may be opened or rendered as links", () => {
  assert.equal(safeAuthorizationUrl("https://github.com/login/device"), "https://github.com/login/device");
  assert.equal(safeAuthorizationUrl("http://localhost:1455/auth/callback"), "http://localhost:1455/auth/callback");
  assert.equal(safeAuthorizationUrl("http://127.0.0.1:1455/auth/callback"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(safeAuthorizationUrl("http://[::1]:1455/auth/callback"), "http://[::1]:1455/auth/callback");
  for (const value of ["http://example.com/verify", "http://192.168.1.2/verify", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "/relative", "not-a-url", "", undefined, null]) {
    assert.equal(safeAuthorizationUrl(value), null, String(value));
  }
});
