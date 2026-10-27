"use strict";
/* Generated from public SDK 1.4.0 dist bytes; no SDK source vendoring. */
module.exports = {
  "schemaVersion": 1,
  "patchId": "pi-desk-sdk-command-env-1.4.0-v2",
  "packageName": "@earendil-works/pi-coding-agent",
  "packageVersion": "1.4.0",
  "packageJsonSha256": "df6883685382d6a914e5797232744c26579fe7db5576ea0e9c859d018ca2d54e",
  "scope": "Twelve pinned modular SDK targets, including clipboard/browser helpers and RpcClient launch; excludes interactive-UI-only direct spawns, CLI/RPC bundles and arbitrary extension Node.js.",
  "helper": {
    "path": "dist/utils/pi-desk-command-env.js",
    "content": "/** Pi Desk child-command environment policy, pinned to SDK 1.4.0.\n * Install-time downstream patch; never imported from the application runtime.\n * This is hygiene, not an extension sandbox. Filter only the final child copy:\n * explicit empty environments stay empty, and SSH/account/session values survive.\n */\nexport function sdkCommandEnvironment(source = process.env, platform = process.platform) {\n    const environment = { ...source };\n    for (const key of Object.keys(environment)) {\n        const name = platform === \"win32\" ? key.toUpperCase() : key;\n        if (name === \"PI_WEB_PASSWORD\" || name === \"PI_DESK_SSH_RUNTIME\") delete environment[key];\n    }\n    return environment;\n}\n",
    "sha256": "e24862eeed0fae9945a340ad483bc1329312028c78a715f3c96e8e06c5cec808"
  },
  "files": [
    {
      "path": "dist/utils/child-process.js",
      "originalSha256": "cfc7b3361e42b61ee75aecc2b436ff7462f7e4431b4b646da7166f3c5706c9b8",
      "patchedSha256": "95d38e3e330662f18a597c9b01eb15a1257343df9efa62199325ac5f46627857",
      "replacements": [
        {
          "before": "import crossSpawn from \"cross-spawn\";\n",
          "after": "import crossSpawn from \"cross-spawn\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
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
      "patchedSha256": "b05562837e5a192b9e779642617f89121f664e8384d073c6f49382cd2afd5ccf",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../utils/pi-desk-command-env.js\";\n"
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
      "patchedSha256": "e1f3b7239cf635482bf29e02acba90d69d7143fef13ef314a3ac47f688c22e30",
      "replacements": [
        {
          "before": "import { execSync, spawnSync } from \"child_process\";\n",
          "after": "import { execSync, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../utils/pi-desk-command-env.js\";\n"
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
      "patchedSha256": "f6652d1baafe67dbcf156ea6b467a150a70458c4a845ed343cab61941493206d",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
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
      "patchedSha256": "0a3bae181451ee81f8b2355bc4be85235efbf34daa613dfeaa3fcef365cf6084",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
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
      "patchedSha256": "3263e09df80773d98647909a7c81a749c180a705ca4f844b8d952c25a59257a5",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
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
      "patchedSha256": "3b8841edb7a097f5322658bdb524dfe233b17d690d459ef8a98eb7c7ccc9caf6",
      "replacements": [
        {
          "before": "import { execFile, spawnSync } from \"child_process\";\n",
          "after": "import { execFile, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../utils/pi-desk-command-env.js\";\n"
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
      "patchedSha256": "2ee99fc6be2a43a6e1efeb05db33b3ce8b2148426cea6b851e3e3a7c0e8bc364",
      "replacements": [
        {
          "before": "import { spawn, spawnSync } from \"child_process\";\n",
          "after": "import { spawn, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
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
      "patchedSha256": "8d83fac70e84fd8ec643fe0ec219afa9fd1c3c7399a754adeaa9b1487fb98735",
      "replacements": [
        {
          "before": "import { spawnSync } from \"child_process\";\n",
          "after": "import { spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
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
      "patchedSha256": "3afdec0b1f45b35909f3fd8f7876f86391a398521c74ae89b142e75f9d1d94e5",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
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
      "patchedSha256": "8808c63df0018be0a5c54c1d304252a86ed81c95deaed69248896c5b33ab84a1",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
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
      "patchedSha256": "e91587140b258baa554850b4061ec9c2538b0bf4fb04622ec592fa16d17d49fe",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "            env: { ...process.env, ...this.options.env },\n",
          "after": "            env: sdkCommandEnvironment({ ...process.env, ...this.options.env }),\n"
        }
      ]
    }
  ]
};
