"use strict";
/* Generated from public SDK 1.4.0 dist bytes; no SDK source vendoring. */
module.exports = {
  "schemaVersion": 1,
  "patchId": "brabbler-sdk-command-env-1.4.0-v2",
  "packageName": "@earendil-works/pi-coding-agent",
  "packageVersion": "1.4.0",
  "packageJsonSha256": "df6883685382d6a914e5797232744c26579fe7db5576ea0e9c859d018ca2d54e",
  "scope": "Twelve pinned modular SDK targets, including clipboard/browser helpers and RpcClient launch; excludes interactive-UI-only direct spawns, CLI/RPC bundles and arbitrary extension Node.js.",
  "helper": {
    "path": "dist/utils/brabbler-command-env.js",
    "content": "/** Brabbler child-command environment policy, pinned to SDK 1.4.0.\n * Install-time downstream patch; never imported from the application runtime.\n * This is hygiene, not an extension sandbox. Filter only the final child copy:\n * explicit empty environments stay empty, and SSH/account/session values survive.\n */\nexport function sdkCommandEnvironment(source = process.env, platform = process.platform) {\n    const environment = { ...source };\n    for (const key of Object.keys(environment)) {\n        const name = platform === \"win32\" ? key.toUpperCase() : key;\n        if (name === \"BRABBLER_PASSWORD\" || name === \"BRABBLER_SSH_RUNTIME\") delete environment[key];\n    }\n    return environment;\n}\n",
    "sha256": "b85618b186802e1c09327d0a52f61cb440ab2b753a25d9833aad170681d863b6"
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
      "originalSha256": "6aed92abe5273445a9bddcd92d4178264d0a23890b54b175a0efc73b20cdf53f",
      "patchedSha256": "30a18779d578dc38487b1f037883d41f1215a9de008c8a6cb399f068baadc427",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "            shell: false,\n",
          "after": "            shell: false,\n            env: sdkCommandEnvironment(),\n"
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
      "originalSha256": "f32e87a42f66276b2eafaaf0848babf52523d37ab0fd448439586376747f03c4",
      "patchedSha256": "2f1395ecfc49ee6ccd1623437b20cdf8738a054e0be220c15d18145b09110cfa",
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
      "originalSha256": "3ebc39e878898a348542d8b308944896af9c68439a975343ba4158d87cb20344",
      "patchedSha256": "a96c20d099fe5cfc59ce50e407e18899a19eaed75ade670a4fc1c9dc1c713219",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/brabbler-command-env.js\";\n"
        },
        {
          "before": "const child = spawn(rgPath, args, { stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
          "after": "const child = spawn(rgPath, args, { env: sdkCommandEnvironment(), stdio: [\"ignore\", \"pipe\", \"pipe\"] });"
        }
      ]
    },
    {
      "path": "dist/core/tools/find.js",
      "originalSha256": "cbb5e3a76e962899f833452ff26670c1fdbf333e7efdecb9953b07f6ebd14ed7",
      "patchedSha256": "a3426f0f3d573a9238fd67dc02c63e7143441fda304e889bc330517adf4bb451",
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
      "originalSha256": "f1e61708c725a337882bb08abac995bafc7a42883558ea1c46cc1917aff5d778",
      "patchedSha256": "f901811b46544f52f525ccea0ceeef87788f2f09ee973f93025dfd7d9b34953d",
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
      "originalSha256": "4a8c8fc56b88dc306d10f476f6dfed2469dbd8d812251f40cc20f3e97b6928ec",
      "patchedSha256": "d9d7fbfe9ddf7e8defc1e08c9e21496d65b169bc16aa982c84949dd771f76428",
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
      "originalSha256": "10e41ba8b85eab8b19a162e8255ee214eb359af2c06645fbae53d0493a4e6e51",
      "patchedSha256": "1d3959a188c9a2f704b8ccce9331fe9ffb53b83bf9d6d4198725f59e57818b20",
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
      "originalSha256": "1268b4e07acbeff18bc8f7e4b39dbf19acd5be4f67f061fd5c17cac29646dfc2",
      "patchedSha256": "aba3cde1bfebf285819d0dc8a3ed63e337ce0153db7a8cd2a14f1b591007d746",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./brabbler-command-env.js\";\n"
        },
        {
          "before": "spawn(cmd, args, { stdio: \"ignore\", detached: true })",
          "after": "spawn(cmd, args, { env: sdkCommandEnvironment(), stdio: \"ignore\", detached: true })"
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
