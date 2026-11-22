"use strict";
/* Generated from public SDK 1.6.0 dist bytes; no SDK source vendoring. */
module.exports = {
  "schemaVersion": 1,
  "patchId": "brabbler-sdk-command-env-1.6.0-v2",
  "packageName": "@earendil-works/pi-coding-agent",
  "packageVersion": "1.6.0",
  "packageJsonSha256": "ea92c5541390fa391ed7157f153a44e931b4aef52f811ebf25cfb0bbafcdb9bb",
  "scope": "Twelve pinned modular SDK targets, including clipboard/browser helpers and RpcClient launch; excludes interactive-UI-only direct spawns, CLI/RPC bundles and arbitrary extension Node.js.",
  "helper": {
    "path": "dist/utils/brabbler-command-env.js",
    "content": "/** Brabbler child-command environment policy, pinned to SDK 1.6.0.\n * Install-time downstream patch; never imported from the application runtime.\n * This is hygiene, not an extension sandbox. Filter only the final child copy:\n * explicit empty environments stay empty, and SSH/account/session values survive.\n */\nexport function sdkCommandEnvironment(source = process.env, platform = process.platform) {\n    const environment = { ...source };\n    for (const key of Object.keys(environment)) {\n        const name = platform === \"win32\" ? key.toUpperCase() : key;\n        if (name === \"BRABBLER_PASSWORD\" || name === \"BRABBLER_SSH_RUNTIME\") delete environment[key];\n    }\n    return environment;\n}\n",
    "sha256": "b6d409897699c8a2a31e29e9a780583d7378d7a4f0b6c167ab698aeb4f828646"
  },
  "files": [
    {
      "path": "dist/utils/child-process.js",
      "originalSha256": "cfc7b3361e42b61ee75aecc2b436ff7462f7e4431b4b646da7166f3c5706c9b8",
      "patchedSha256": "6bb28a69acbdc206463335a8f705c2777baa27a70605c276624ae80ebfe7b143",
      "replacements": [
        {
          "before": "import crossSpawn from \"cross-spawn\";\n",
          "after": "import crossSpawn from \"cross-spawn\";\nimport { sdkCommandEnvironment } from \"./brabbler-command-env.js\";\n"
        },
        {
          "before": "export function spawnProcess(command, args, options) {\n",
          "after": "export function spawnProcess(command, args, options) {\n    options = { ...options, env: sdkCommandEnvironment(options?.env ?? process.env) };\n"
        },
        {
          "before": "export function spawnProcessSync(command, args, options) {\n",
          "after": "export function spawnProcessSync(command, args, options) {\n    options = { ...options, env: sdkCommandEnvironment(options?.env ?? process.env) };\n"
        }
      ]
    },
    {
      "path": "dist/core/exec.js",
      "originalSha256": "7301c1656cc47bcadc9211c757cec2268940d9f250e51e50935795835469646b",
      "patchedSha256": "c5155e437160339e801adbf3c1d0aa2739413f9b2730686607d5b1b3fc8728d4",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "        shell: false,\n",
          "after": "        shell: false,\n        env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/core/resolve-config-value.js",
      "originalSha256": "01fdb1673990635bb419c7418eefa298b6a1c6fbb3c6193d3b05a4902e51992d",
      "patchedSha256": "6a75070a001bd9649b2c155d13b51db39b04a52d0eb53d002980f50a2b6f6a98",
      "replacements": [
        {
          "before": "import { execSync, spawnSync } from \"child_process\";\n",
          "after": "import { execSync, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "        const result = spawnSync(shell, commandFromStdin ? args : [...args, command], {\n",
          "after": "        const result = spawnSync(shell, commandFromStdin ? args : [...args, command], {\n            env: sdkCommandEnvironment(),\n"
        },
        {
          "before": "        const output = execSync(command, {\n",
          "after": "        const output = execSync(command, {\n            env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/core/tools/bash.js",
      "originalSha256": "afc4f829b3da2e7d8cc31296ccceb26bbc8e35018eb3f352791b651866cc2040",
      "patchedSha256": "b03b125f0c1ccfc9f42a53ced15c27782a7e85266de057ed6eaeb7c244277fff",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "                env: env ?? getShellEnv(),\n",
          "after": "                env: sdkCommandEnvironment(env ?? getShellEnv()),\n"
        }
      ]
    },
    {
      "path": "dist/core/tools/grep.js",
      "originalSha256": "99187a58f9aeae86c70889f7beeb0e8a516d831c87fe7068def84dc068ead922",
      "patchedSha256": "5411a6a7f92c264d423dee0379525fc5b7f6fa4bd30ea235c0d59a636b20e138",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "const child = spawn(rgPath, args, {\n",
          "after": "const child = spawn(rgPath, args, {\n                            env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/core/tools/find.js",
      "originalSha256": "97dd507d15d0cb6b789ff1edfa792a672213015af3ebf56b9e7cc6fc39571190",
      "patchedSha256": "b235ffb6956a16969114c91545609f6bdc44d4943de3a740e920bf5403271b11",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "const child = spawn(fdPath, args, { stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
          "after": "const child = spawn(fdPath, args, { env: sdkCommandEnvironment(), stdio: [\"ignore\", \"pipe\", \"pipe\"] });"
        }
      ]
    },
    {
      "path": "dist/core/footer-data-provider.js",
      "originalSha256": "cb31fe6973228249ad0b02d4ec79509a1f7c7e63c2c15df35bb5d5100685f2ac",
      "patchedSha256": "2a44ae3ea34fd1f155b35a3a8b7ce0530b647137f0607b683a1153a728682bc4",
      "replacements": [
        {
          "before": "import { execFile, spawnSync } from \"child_process\";\n",
          "after": "import { execFile, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "        cwd: repoDir,\n        encoding: \"utf8\",",
          "after": "        cwd: repoDir,\n        env: sdkCommandEnvironment(),\n        encoding: \"utf8\","
        },
        {
          "before": "            cwd: repoDir,\n            encoding: \"utf8\",",
          "after": "            cwd: repoDir,\n            env: sdkCommandEnvironment(),\n            encoding: \"utf8\","
        }
      ]
    },
    {
      "path": "dist/utils/shell.js",
      "originalSha256": "57dd12450505faaf713b7cfeddff43ce8bd6238b3cfb755f87bdc83ee6134fc2",
      "patchedSha256": "a119f9c4bfbe5f189e6c3ec4be0d57e129e0763d6e3f8c99f3218f4d4a63d426",
      "replacements": [
        {
          "before": "import { spawn, spawnSync } from \"child_process\";\n",
          "after": "import { spawn, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"./brabbler-command-env.js\";\n"
        },
        {
          "before": "            const result = spawnSync(\"where\", [executable], {\n",
          "after": "            const result = spawnSync(\"where\", [executable], {\n                env: sdkCommandEnvironment(),\n"
        },
        {
          "before": "spawnSync(\"which\", [executable], { encoding: \"utf-8\", timeout: 5000 })",
          "after": "spawnSync(\"which\", [executable], { env: sdkCommandEnvironment(), encoding: \"utf-8\", timeout: 5000 })"
        },
        {
          "before": "[\"/F\", \"/T\", \"/PID\", String(pid)], {\n",
          "after": "[\"/F\", \"/T\", \"/PID\", String(pid)], {\n                env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/utils/tools-manager.js",
      "originalSha256": "969ef1a6018c1e773b3c0a4be42642c7cf10cb07687f74004f458fb2262d9595",
      "patchedSha256": "f53b203f9777da6bfb9dbb2f1002ccbde86543b69f8cdbe19e18d7696426287d",
      "replacements": [
        {
          "before": "import { spawnSync } from \"child_process\";\n",
          "after": "import { spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"./brabbler-command-env.js\";\n"
        },
        {
          "before": "spawnSync(cmd, [\"--version\"], { stdio: \"pipe\" })",
          "after": "spawnSync(cmd, [\"--version\"], { env: sdkCommandEnvironment(), stdio: \"pipe\" })"
        },
        {
          "before": "spawnSync(command, args, { stdio: \"pipe\" })",
          "after": "spawnSync(command, args, { env: sdkCommandEnvironment(), stdio: \"pipe\" })"
        }
      ]
    },
    {
      "path": "dist/utils/clipboard-command.js",
      "originalSha256": "0217e7833c895a814f714b50b82482603168f27fe46424d67f6b57aecbf38114",
      "patchedSha256": "ba4b904568726f6db2441ec24fa693247e1939f3dce63917d1ea55bc1c977601",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./brabbler-command-env.js\";\n"
        },
        {
          "before": "        const child = spawn(command, args, {\n",
          "after": "        const child = spawn(command, args, {\n            env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/utils/open-browser.js",
      "originalSha256": "32ad205bc422b5fce56ddaaa2bbc4d853e613ef9bfee9fa2f53bb2d38ab41a62",
      "patchedSha256": "5acffa330be4533f319d3b9f296d07ac5e34962db8ec1d195b573246d411b381",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./brabbler-command-env.js\";\n"
        },
        {
          "before": "spawn(cmd, args, { stdio: \"ignore\", detached: true, cwd: \"/\" })",
          "after": "spawn(cmd, args, { env: sdkCommandEnvironment(), stdio: \"ignore\", detached: true, cwd: \"/\" })"
        }
      ]
    },
    {
      "path": "dist/modes/rpc/rpc-client.js",
      "originalSha256": "6cbb7d183db13468af61af733013a97ee6f5547ccd44edb1f85647f8bd6f218c",
      "patchedSha256": "a852260d0c4357ac1ce2ccef05b542c9cb3a011e1bef24cb1cd3b2a8bf7f4668",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "            env: { ...process.env, ...this.options.env },\n",
          "after": "            env: sdkCommandEnvironment({ ...process.env, ...this.options.env }),\n"
        }
      ]
    }
  ]
};
