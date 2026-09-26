import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-title-model-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, PUT } = await jiti.import("./route.ts");
const { readTitleLanguage, writeTitleLanguage } = await jiti.import("../../../../lib/title-language.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function request(model, contentType = "application/json") {
  return new Request("http://localhost/api/sessions/title-model", {
    method: "PUT", headers: { "Content-Type": contentType, Host: "localhost" }, body: JSON.stringify({ model }),
  });
}

test("title model defaults to session model; saves exact provider/id and preserves language", async () => {
  assert.deepEqual(await (await GET()).json(), { model: null });
  writeTitleLanguage("de");
  const model = { provider: "openrouter", modelId: "vendor/cheap-model" };
  assert.deepEqual(await (await PUT(request(model))).json(), { model });
  assert.deepEqual(await (await GET()).json(), { model });
  assert.equal(readTitleLanguage(), "de");
  writeTitleLanguage("en");
  assert.deepEqual(await (await GET()).json(), { model });
  assert.deepEqual(JSON.parse(await readFile(join(testAgentDir, "pi-web", "title-settings.json"), "utf8")), { language: "en", model });
  assert.deepEqual(await (await PUT(request(null))).json(), { model: null });
  assert.deepEqual(await (await GET()).json(), { model: null });
});

test("does not replace damaged server settings", async () => {
  const path = join(testAgentDir, "pi-web", "title-settings.json");
  await writeFile(path, '{"language":"en","model":{"provider":"bad"}}');
  assert.equal((await GET()).status, 500);
  assert.equal((await PUT(request(null))).status, 500);
  assert.equal(await readFile(path, "utf8"), '{"language":"en","model":{"provider":"bad"}}');
  await writeFile(path, '{"language":"auto"}');
});

test("rejects invalid selections without replacing the saved setting", async () => {
  for (const model of ["cheap", {}, { provider: "", modelId: "model" }, { provider: "test", modelId: " " }]) {
    assert.equal((await PUT(request(model))).status, 400);
  }
  assert.equal((await PUT(request(null, "text/plain"))).status, 415);
  assert.deepEqual(await (await GET()).json(), { model: null });
});
