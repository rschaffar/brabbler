import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getHelpText, parseLaunchOptions } = require("../bin/brabbler-options.js");
const cliPath = fileURLToPath(new URL("../bin/brabbler.js", import.meta.url));

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    help: false,
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
    noAuth: false,
  });
});

test("supports --help and -h without starting the server", () => {
  assert.deepEqual(parseLaunchOptions(["--help"], {}), { help: true });
  assert.deepEqual(parseLaunchOptions(["-h"], {}), { help: true });
  assert.match(getHelpText(), /Usage: brabbler/);
  assert.match(getHelpText(), /--port/);
  assert.match(getHelpText(), /--hostname/);
  assert.match(getHelpText(), /--no-open/);
  assert.match(getHelpText(), /BRABBLER_SKIP_VERSION_CHECK/);
  assert.match(getHelpText(), /BRABBLER_IDLE_TIMEOUT_MS/);
});

test("rejects unknown options with a help hint", () => {
  assert.throws(
    () => parseLaunchOptions(["--unknown-flag"], {}),
    /Use --help to see available options/,
  );
});

test("rejects unexpected positional arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["start"], {}),
    /Unexpected argument/,
  );
});

test("CLI writes help and parse errors before exiting", () => {
  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: brabbler/);

  const invalid = spawnSync(process.execPath, [cliPath, "--unknown-flag"], {
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Use --help to see available options/);
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("no-auth is an explicit option and policy defaults to protection", () => {
  const { getWebAuthPolicy } = require('../bin/web-auth-policy.js');
  assert.equal(parseLaunchOptions(['--no-auth', '-H', '0.0.0.0'], {}).noAuth, true);
  assert.match(getHelpText(), /--no-auth/);
  for (const value of [undefined, '', '0', '1']) {
    assert.equal(getWebAuthPolicy(value === undefined ? {} : { BRABBLER_REQUIRE_AUTH: value }), 'required');
  }
  assert.equal(getWebAuthPolicy({ BRABBLER_NO_AUTH: '1' }), 'disabled');
  assert.equal(getWebAuthPolicy({ BRABBLER_NO_AUTH: '1', BRABBLER_REQUIRE_AUTH: '1' }), 'invalid');
  for (const key of ['BRABBLER_NO_AUTH', 'BRABBLER_REQUIRE_AUTH']) {
    assert.equal(getWebAuthPolicy({ [key]: 'unexpected' }), 'invalid');
  }
});

test("supports truthy BRABBLER_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { BRABBLER_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false BRABBLER_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { BRABBLER_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}),
    {
      help: false,
      port: "8080",
      hostname: "0.0.0.0",
      openBrowser: true,
      noAuth: false,
    },
  );
});

test("rejects port values that could inject cmd arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["-p", "30141&whoami"], {}),
    /Port must be a non-negative integer/,
  );
  assert.throws(
    () => parseLaunchOptions([], { PORT: "30141&whoami" }),
    /Port must be a non-negative integer/,
  );
});

test("supports BRABBLER_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { BRABBLER_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});
